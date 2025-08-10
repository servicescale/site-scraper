module.exports = async function handler(req, res) {
  const startUrl = req.query.url;
  if (!startUrl || !/^https?:\/\//i.test(startUrl)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const scrapeEndpoint = `${req.headers.host.startsWith('localhost') ? 'http' : 'https'}://${req.headers.host}/api/scrape`;
  const abnEndpoint = `${req.headers.host.startsWith('localhost') ? 'http' : 'https'}://${req.headers.host}/api/lookup-abn`;

  async function scrapePage(url) {
    const res = await fetch(`${scrapeEndpoint}?url=${encodeURIComponent(url)}`);
    if (!res.ok) throw new Error(`Scrape failed: ${url}`);
    return res.json();
  }

  async function fetchCSSColors(url) {
    const categories = { text: {}, background: {}, accents: {} };
    const skipColors = ['#000', '#000000', '#fff', '#ffffff', '#111', '#222', '#333'];
    try {
      const cssRes = await fetch(url);
      if (!cssRes.ok) return categories;
      const cssText = await cssRes.text();

      const lines = cssText.split(/;|\n/);
      for (const line of lines) {
        const colorMatch = line.match(/#[a-f0-9]{3,6}/i);
        if (!colorMatch) continue;
        const color = colorMatch[0].toLowerCase();
        if (skipColors.includes(color)) continue;

        if (/color:/i.test(line) && !/background/i.test(line)) {
          categories.text[color] = (categories.text[color] || 0) + 1;
        } else if (/background/i.test(line)) {
          categories.background[color] = (categories.background[color] || 0) + 1;
        } else if (/border|outline/i.test(line)) {
          categories.accents[color] = (categories.accents[color] || 0) + 1;
        }
      }
    } catch {
      return categories;
    }
    return categories;
  }

  const visited = new Set();
  const pages = [];
  let social_links = {};
  let menu_links = [];
  let abn_lookup = null;
  let primary_colors = { text: [], background: [], accents: [] };

  try {
    const root = await scrapePage(startUrl);
    visited.add(root.page.url);
    pages.push(root.page);
    social_links = { ...social_links, ...root.social_links };
    menu_links = root.menu_links.filter(link => link.startsWith(startUrl));

    // ✅ Safe ABN lookup
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

    // ✅ Fetch CSS colors from linked stylesheets and categorize
    if (root.page.links) {
      const cssLinks = root.page.links.filter(l => l.endsWith('.css'));
      const aggregated = { text: {}, background: {}, accents: {} };
      for (const cssUrl of cssLinks) {
        const categories = await fetchCSSColors(cssUrl);
        for (const cat of Object.keys(categories)) {
          for (const color in categories[cat]) {
            aggregated[cat][color] = (aggregated[cat][color] || 0) + categories[cat][color];
          }
        }
      }
      primary_colors = {
        text: Object.keys(aggregated.text).sort((a, b) => aggregated.text[b] - aggregated.text[a]).slice(0, 3),
        background: Object.keys(aggregated.background).sort((a, b) => aggregated.background[b] - aggregated.background[a]).slice(0, 3),
        accents: Object.keys(aggregated.accents).sort((a, b) => aggregated.accents[b] - aggregated.accents[a]).slice(0, 3)
      };
    }

    for (const link of menu_links) {
      if (visited.has(link)) continue;
      try {
        const pageData = await scrapePage(link);
        pages.push(pageData.page);
        visited.add(pageData.page.url);
        social_links = { ...social_links, ...pageData.social_links };
      } catch (err) {
        console.warn(`⚠️ Failed to scrape ${link}:`, err.message);
      }
    }

    res.status(200).json({
      site: startUrl,
      pages,
      menu_links,
      social_links,
      abn_lookup,
      primary_colors
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Crawl failed' });
  }
};
