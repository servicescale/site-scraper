const { bostonos_runtime_api_yellow_rice_fbef_workers_dev__jit_plugin } = require('../utils/bostonos'); // adjust path if needed

module.exports = async function handler(req, res) {
  const startUrl = req.query.url;

  const responseData = {
    site: startUrl || null,
    pages: [],
    menu_links: [],
    social_links: {},
    abn_lookup: null,
    primary_colors: { text: [], background: [], accents: [] },
    errors: [],
    saved_to: null
  };

  if (!startUrl || !/^https?:\/\//i.test(startUrl)) {
    responseData.errors.push({ stage: 'input_validation', message: 'Invalid or missing URL' });
    return res.status(400).json(responseData);
  }

  const scrapeEndpoint = `${req.headers.host.startsWith('localhost') ? 'http' : 'https'}://${req.headers.host}/api/scrape`;
  const abnEndpoint = `${req.headers.host.startsWith('localhost') ? 'http' : 'https'}://${req.headers.host}/api/lookup-abn`;

  // Safe fetch helper
  const safeFetchJSON = async (url) => {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (err) {
      responseData.errors.push({ stage: 'fetch', target: url, message: err.message });
      return null;
    }
  };

  // ---- Stage 1: Homepage scrape ----
  const root = await safeFetchJSON(`${scrapeEndpoint}?url=${encodeURIComponent(startUrl)}`);
  if (root?.page) responseData.pages.push(root.page);
  if (root?.social_links) responseData.social_links = root.social_links;
  if (Array.isArray(root?.menu_links)) {
    responseData.menu_links = root.menu_links.filter(link => typeof link === 'string' && link.startsWith(startUrl));
  }

  // ---- Stage 2: ABN detection & lookup ----
  try {
    let guess = root?.page?.title || root?.page?.headings?.[0] || null;
    const abnMatch = (root?.html && typeof root.html === 'string') ? root.html.match(/\b\d{2}[ ]?\d{3}[ ]?\d{3}[ ]?\d{3}\b/) : null;
    if (abnMatch) guess = abnMatch[0].replace(/\s+/g, '');
    if (guess) {
      const abnData = await safeFetchJSON(`${abnEndpoint}?search=${encodeURIComponent(guess)}`);
      if (abnData) responseData.abn_lookup = abnData.abn_lookup || abnData.result || null;
    }
  } catch (err) {
    responseData.errors.push({ stage: 'abn_lookup', message: err.message });
  }

  // ---- Stage 3: CSS extraction & color processing ----
  try {
    const cssSources = await extractCSSLinksAndInline(startUrl, responseData.errors);
    const aggregated = { text: {}, background: {}, accents: {} };

    for (const source of cssSources) {
      let cssText = '';
      if (source.startsWith('http')) {
        try {
          const r = await fetch(source);
          if (r.ok) cssText = await r.text();
        } catch (err) {
          responseData.errors.push({ stage: 'fetch_css', target: source, message: err.message });
        }
      } else {
        cssText = source; // inline CSS
      }
      if (cssText) fetchCSSColorsFromText(cssText, aggregated);
    }

    responseData.primary_colors = {
      text: Object.keys(aggregated.text).sort((a, b) => aggregated.text[b] - aggregated.text[a]).slice(0, 3),
      background: Object.keys(aggregated.background).sort((a, b) => aggregated.background[b] - aggregated.background[a]).slice(0, 3),
      accents: Object.keys(aggregated.accents).sort((a, b) => aggregated.accents[b] - aggregated.accents[a]).slice(0, 3)
    };
  } catch (err) {
    responseData.errors.push({ stage: 'color_extraction', message: err.message });
  }

  // ---- Stage 4: Menu pages ----
  for (const link of responseData.menu_links) {
    const pageData = await safeFetchJSON(`${scrapeEndpoint}?url=${encodeURIComponent(link)}`);
    if (pageData?.page) responseData.pages.push(pageData.page);
    if (pageData?.social_links) {
      responseData.social_links = { ...responseData.social_links, ...pageData.social_links };
    }
  }

  // ---- Stage 5: Save to BostonOS Runtime ----
  try {
    const domain = new URL(startUrl).hostname;
    const clientname = domain.split('.')[0];
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').split('.')[0];
    const fileKey = `mk4/capsules/profile_generator/data/${clientname}_raw_${timestamp}.json`;

    await bostonos_runtime_api_yellow_rice_fbef_workers_dev__jit_plugin.writeFile({
      bucket: 'tradecard',
      key: fileKey,
      content: JSON.stringify(responseData, null, 2)
    });

    responseData.saved_to = `tradecard:/${fileKey}`;
  } catch (err) {
    responseData.errors.push({ stage: 'bostonos_save', message: err.message });
  }

  return res.status(200).json(responseData);
};

// ---- Helpers ----
async function extractCSSLinksAndInline(url, errors) {
  const cssLinks = [];
  try {
    const r = await fetch(url);
    if (!r.ok) return cssLinks;
    const html = await r.text();
    const linkMatches = html.match(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi) || [];
    for (const tag of linkMatches) {
      const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
      if (hrefMatch) {
        try {
          cssLinks.push(new URL(hrefMatch[1], url).href);
        } catch {}
      }
    }
    const styleMatches = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [];
    if (styleMatches.length > 0) {
      cssLinks.push(...styleMatches.map(s => s.replace(/<\/?style[^>]*>/gi, '')));
    }
  } catch (err) {
    errors.push({ stage: 'extract_css_links', message: err.message });
  }
  return cssLinks;
}

function fetchCSSColorsFromText(cssText, aggregated) {
  const skipColors = ['#000000', '#ffffff', '#111111', '#222222', '#333333'];
  const colorVarMap = {};
  const varMatches = cssText.match(/--[\w-]+:\s*([^;]+)/gi) || [];

  // Store CSS variables
  for (const match of varMatches) {
    const [name, value] = match.split(/:\s*/);
    if (name && value) colorVarMap[name.trim()] = value.trim();
  }

  const lines = cssText.split(/;|\n/);
  for (const line of lines) {
    let colorMatch = line.match(/(#[a-f0-9]{3,6}|rgba?\([^)]+\)|hsla?\([^)]+\)|var\([^)]+\))/i);
    if (!colorMatch) continue;
    let color = colorMatch[0].toLowerCase();

    if (color.startsWith('var(')) {
      const varName = color.replace(/var\(|\)/g, '').trim();
      if (colorVarMap[varName]) color = colorVarMap[varName];
    }
    const nestedVarMatch = color.match(/var\(([^)]+)\)/);
    if (nestedVarMatch && colorVarMap[nestedVarMatch[1]]) {
      color = color.replace(/var\([^)]+\)/, colorVarMap[nestedVarMatch[1]]);
    }

    color = convertColorToHex(color);
    if (skipColors.includes(color)) continue;

    if (/color:/i.test(line) && !/background/i.test(line)) aggregated.text[color] = (aggregated.text[color] || 0) + 1;
    else if (/background/i.test(line)) aggregated.background[color] = (aggregated.background[color] || 0) + 1;
    else if (/border|outline/i.test(line)) aggregated.accents[color] = (aggregated.accents[color] || 0) + 1;
  }
}

function convertColorToHex(color) {
  // Already hex
  if (/^#([a-f0-9]{3}|[a-f0-9]{6})$/i.test(color)) return color;

  // rgb/rgba
  const rgbMatch = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    return "#" + rgbMatch.slice(1).map(x => {
      const hex = parseInt(x, 10).toString(16);
      return hex.length === 1 ? "0" + hex : hex;
    }).join('');
  }

  // hsl/hsla
  const hslMatch = color.match(/^hsla?\((\d+),\s*(\d+)%?,\s*(\d+)%?/);
  if (hslMatch) {
    let [_, h, s, l] = hslMatch.map(Number);
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n)-3, Math.min(9-k(n), 1)))));
    return "#" + [f(0), f(8), f(4)].map(x => x.toString(16).padStart(2, "0")).join('');
  }

  return color;
}
