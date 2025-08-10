const { JSDOM } = require('jsdom');

const scrapePage = async (url, scrapeEndpoint) => {
  const res = await fetch(`${scrapeEndpoint}?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`Scrape failed: ${url}`);
  return res.json();
};

const extractCSSLinksAndInline = async (url) => {
  const cssLinks = [];
  try {
    const res = await fetch(url);
    if (!res.ok) return cssLinks;
    const html = await res.text();
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
  } catch {}
  return cssLinks;
};

const normalizeToHex = (color) => {
  try {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    const canvas = dom.window.document.createElement('canvas');
    if (!canvas || !canvas.getContext) {
      console.warn('Canvas API not available, skipping color normalization');
      return color;
    }
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    return ctx.fillStyle;
  } catch (err) {
    console.warn('normalizeToHex failed:', err.message);
    return color;
  }
};

const fetchCSSColorsFromText = (cssText, aggregated) => {
  const skipColors = ['#000000', '#ffffff', '#111111', '#222222', '#333333'];
  const colorVarMap = {};
  const varMatches = cssText.match(/--[\w-]+:\s*([^;]+)/gi) || [];
  for (const match of varMatches) {
    const [name, value] = match.split(/:\s*/);
    if (name && value) {
      colorVarMap[name.trim()] = value.trim();
    }
  }
  const lines = cssText.split(/;|\n/);
  for (const line of lines) {
    let colorMatch = line.match(/(#[a-f0-9]{3,6}|rgba?\([^\)]+\)|hsla?\([^\)]+\)|var\([^\)]+\))/i);
    if (!colorMatch) continue;
    let color = colorMatch[0].toLowerCase();
    if (color.startsWith('var(')) {
      const varName = color.replace(/var\(|\)/g, '').trim();
      if (colorVarMap[varName]) {
        color = colorVarMap[varName];
      }
    }
    const nestedVarMatch = color.match(/var\(([^\)]+)\)/);
    if (nestedVarMatch && colorVarMap[nestedVarMatch[1]]) {
      color = color.replace(/var\([^\)]+\)/, colorVarMap[nestedVarMatch[1]]);
    }
    color = normalizeToHex(color);
    if (skipColors.includes(color)) continue;
    if (/color:/i.test(line) && !/background/i.test(line)) {
      aggregated.text[color] = (aggregated.text[color] || 0) + 1;
    } else if (/background/i.test(line)) {
      aggregated.background[color] = (aggregated.background[color] || 0) + 1;
    } else if (/border|outline/i.test(line)) {
      aggregated.accents[color] = (aggregated.accents[color] || 0) + 1;
    }
  }
};

module.exports = async function handler(req, res) {
  const startUrl = req.query.url;
  if (!startUrl || !/^https?:\/\//i.test(startUrl)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const scrapeEndpoint = `${req.headers.host.startsWith('localhost') ? 'http' : 'https'}://${req.headers.host}/api/scrape`;
  const abnEndpoint = `${req.headers.host.startsWith('localhost') ? 'http' : 'https'}://${req.headers.host}/api/lookup-abn`;

  const visited = new Set();
  const pages = [];
  let social_links = {};
  let menu_links = [];
  let abn_lookup = null;
  let primary_colors = { text: [], background: [], accents: [] };

  try {
    const root = await scrapePage(startUrl, scrapeEndpoint);
    visited.add(root.page.url);
    pages.push(root.page);
    social_links = { ...social_links, ...root.social_links };
    menu_links = root.menu_links.filter(link => link.startsWith(startUrl));

    let guess = root.page.title || root.page.headings?.[0] || null;
    try {
      const abnMatch = (root.html && typeof root.html === 'string') ? root.html.match(/\b\d{2}[ ]?\d{3}[ ]?\d{3}[ ]?\d{3}\b/) : null;
      if (abnMatch) {
        guess = abnMatch[0].replace(/\s+/g, '');
      }
    } catch (err) {
      console.warn('ABN pattern match failed:', err.message);
    }

    if (guess) {
      try {
        const abnRes = await fetch(`${abnEndpoint}?search=${encodeURIComponent(guess)}`);
        if (abnRes.ok) {
          const abnData = await abnRes.json();
          abn_lookup = abnData.abn_lookup || abnData.result || null;
        }
      } catch (err) {
        console.warn('ABN lookup failed:', err.message);
      }
    }

    const aggregated = { text: {}, background: {}, accents: {} };
    const cssSources = await extractCSSLinksAndInline(startUrl);

    for (const source of cssSources) {
      if (source.trim().startsWith('http')) {
        try {
          const cssRes = await fetch(source);
          if (cssRes.ok) {
            const cssText = await cssRes.text();
            fetchCSSColorsFromText(cssText, aggregated);
          }
        } catch {}
      } else {
        fetchCSSColorsFromText(source, aggregated);
      }
    }

    primary_colors = {
      text: Object.keys(aggregated.text).sort((a, b) => aggregated.text[b] - aggregated.text[a]).slice(0, 3),
      background: Object.keys(aggregated.background).sort((a, b) => aggregated.background[b] - aggregated.background[a]).slice(0, 3),
      accents: Object.keys(aggregated.accents).sort((a, b) => aggregated.accents[b] - aggregated.accents[a]).slice(0, 3)
    };

    for (const link of menu_links) {
      if (visited.has(link)) continue;
      try {
        const pageData = await scrapePage(link, scrapeEndpoint);
        pages.push(pageData.page);
        visited.add(pageData.page.url);
        social_links = { ...social_links, ...pageData.social_links };
      } catch (err) {
        console.warn(`⚠️ Failed to scrape ${link}:`, err.message);
      }
    }

    res.status(200).json({ site: startUrl, pages, menu_links, social_links, abn_lookup, primary_colors });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Crawl failed' });
  }
};
