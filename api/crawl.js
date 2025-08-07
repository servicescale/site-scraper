const fetch = require('node-fetch');

export default async function handler(req, res) {
  const startUrl = req.query.url;
  if (!startUrl || !/^https?:\/\//i.test(startUrl)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const scrapeEndpoint = `${req.headers.host.startsWith('localhost') ? 'http' : 'https'}://${req.headers.host}/api/scrape`;

  async function scrapePage(url) {
    const res = await fetch(`${scrapeEndpoint}?url=${encodeURIComponent(url)}`);
    if (!res.ok) throw new Error(`Scrape failed: ${url}`);
    return res.json();
  }

  const visited = new Set();
  const pages = [];
  let social_links = {};
  let menu_links = [];

  try {
    const root = await scrapePage(startUrl);
    visited.add(root.page.url);
    pages.push(root.page);
    social_links = { ...social_links, ...root.social_links };
    menu_links = root.menu_links.filter(link => link.startsWith(startUrl));

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
      social_links
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Crawl failed' });
  }
}
