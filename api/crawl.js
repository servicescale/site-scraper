module.exports = async function handler(req, res) {
  const startUrl = req.query.url;

  const response = {
    site: startUrl || null,
    pages: [],
    menu_links: [],
    social_links: {},
    abn_lookup: null,
    primary_colors: { text: [], background: [], accents: [] },
    errors: []
  };

  if (!startUrl || !/^https?:\/\//i.test(startUrl)) {
    response.errors.push({ stage: 'input_validation', message: 'Invalid or missing URL' });
    return res.status(400).json(response);
  }

  const scrapeEndpoint = `${req.headers.host.startsWith('localhost') ? 'http' : 'https'}://${req.headers.host}/api/scrape`;
  const abnEndpoint = `${req.headers.host.startsWith('localhost') ? 'http' : 'https'}://${req.headers.host}/api/lookup-abn`;

  // Safe fetch wrapper
  const safeFetchJSON = async (url) => {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (err) {
      response.errors.push({ stage: 'fetch', target: url, message: err.message });
      return null;
    }
  };

  // Stage 1: Scrape homepage
  const root = await safeFetchJSON(`${scrapeEndpoint}?url=${encodeURIComponent(startUrl)}`);
  if (root?.page) response.pages.push(root.page);
  if (root?.social_links) response.social_links = root.social_links;
  if (Array.isArray(root?.menu_links)) {
    response.menu_links = root.menu_links.filter(link => typeof link === 'string' && link.startsWith(startUrl));
  }

  // Stage 2: ABN detection & lookup
  try {
    let guess = root?.page?.title || root?.page?.headings?.[0] || null;
    const abnMatch = (root?.html && typeof root.html === 'string') ? root.html.match(/\b\d{2}[ ]?\d{3}[ ]?\d{3}[ ]?\d{3}\b/) : null;
    if (abnMatch) guess = abnMatch[0].replace(/\s+/g, '');
    if (guess) {
      const abnData = await safeFetchJSON(`${abnEndpoint}?search=${encodeURIComponent(guess)}`);
      if (abnData) response.abn_lookup = abnData.abn_lookup || abnData.result || null;
    }
  } catch (err) {
    response.errors.push({ stage: 'abn_lookup', message: err.message });
  }

  // Stage 3: CSS extraction
  try {
    const cssSources = await extractCSSLinksAndInline(startUrl, response.errors);
    const aggregated = { text: {}, background: {}, accents: {} };
    for (const source of cssSources) {
      let cssText = '';
      if (source.startsWith('http')) {
        try {
          const r = await fetch(source);
          if (r.ok) cssText = await r.text();
        } catch (err) {
          response.errors.push({ stage: 'fetch_css', target: source, message: err.message });
        }
      } else {
        cssText = source; // inline
      }
      if (cssText) fetchCSSColorsFromText(cssText, aggregated);
    }
    response.primary_colors = {
      text: Object.keys(aggregated.text).sort((a, b) => aggregated.text[b] - aggregated.text[a]).slice(0, 3),
      background: Object.keys(aggregated.background).sort((a, b) => aggregated.background[b] - aggregated.background[a]).slice(0, 3),
      accents: Object.keys(aggregated.accents).sort((a, b) => aggregated.accents[b] - aggregated.accents[a]).slice(0, 3)
    };
  } catch (err) {
    response.errors.push({ stage: 'color_extraction', message: err.message });
  }

  // Stage 4: Scrape menu pages
  for (const link of response.menu_links) {
    const pageData = await safeFetchJSON(`${scrapeEndpoint}?url=${encodeURIComponent(link)}`);
    if (pageData?.page) response.pages.push(pageData.page);
    if (pageData?.social_links) {
      response.social_links = { ...response.social_links, ...pageData.social_links };
    }
  }

  return res.status(200).json(response);
};

// Helpers
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
  for (const match of varMatches) {
    const [name, value] = match.split(/:\s*/);
    if (name && value) colorVarMap[name.trim()] = value.trim();
  }
  const lines = cssText.split(/;|\n/);
  for (const line of lines) {
    let colorMatch = line.match(/(#[a-f0-9]{3,6}|rgba?\([^\)]+\)|hsla?\([^\)]+\)|var\([^\)]+\))/i);
    if (!colorMatch) continue;
    let color = colorMatch[0].toLowerCase();
    if (color.startsWith('var(')) {
      const varName = color.replace(/var\(|\)/g, '').trim();
      if (colorVarMap[varName]) color = colorVarMap[varName];
    }
    if (skipColors.includes(color)) continue;
    if (/color:/i.test(line) && !/background/i.test(line)) aggregated.text[color] = (aggregated.text[color] || 0) + 1;
    else if (/background/i.test(line)) aggregated.background[color] = (aggregated.background[color] || 0) + 1;
    else if (/border|outline/i.test(line)) aggregated.accents[color] = (aggregated.accents[color] || 0) + 1;
  }
}
