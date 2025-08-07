import fetch from 'node-fetch';

const scrapeEndpoint = 'https://site-scraper-ten.vercel.app/api/scrape';

async function scrapePage(url) {
  const res = await fetch(`${scrapeEndpoint}?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`Failed to scrape ${url}`);
  return res.json();
}

async function crawlSite(startUrl) {
  const visited = new Set();
  const pages = [];
  let combinedSocialLinks = {};

  console.log(`🔍 Scraping root page: ${startUrl}`);
  const rootData = await scrapePage(startUrl);
  pages.push(rootData.page);
  visited.add(rootData.page.url);
  combinedSocialLinks = { ...combinedSocialLinks, ...rootData.social_links };

  const subpages = rootData.menu_links.filter(link => link.startsWith(startUrl));

  for (const link of subpages) {
    if (visited.has(link)) continue;
    try {
      console.log(`🔁 Scraping: ${link}`);
      const data = await scrapePage(link);
      pages.push(data.page);
      visited.add(data.page.url);
      combinedSocialLinks = { ...combinedSocialLinks, ...data.social_links };
    } catch (err) {
      console.warn(`⚠️ Failed to scrape ${link}:`, err.message);
    }
  }

  return {
    site: startUrl,
    pages,
    social_links: combinedSocialLinks
  };
}

// Entry point
const target = process.argv[2];
if (!target) {
  console.error('❌ Usage: node crawl.js https://example.com');
  process.exit(1);
}

crawlSite(target)
  .then(data => {
    console.log('\n✅ Crawl Complete:\n');
    console.log(JSON.stringify(data, null, 2));
  })
  .catch(err => {
    console.error('❌ Crawl failed:', err);
    process.exit(1);
  });
