
// BostonOS API details — token must be set in Vercel Environment Variables
const BOSTONOS_API_URL = 'https://bostonos-runtime-api.yellow-rice-fbef.workers.dev/writeFile';
const BOSTONOS_API_TOKEN = process.env.BOSTONOS_API_TOKEN; // Set in Vercel → Settings → Environment Variables

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

  const visited = new Set();
  const pages = [];
  let social_links = {};
  let menu_links = [];
  let abn_lookup = null;

  try {
    const root = await scrapePage(startUrl);
    visited.add(root.page.url);
    pages.push(root.page);
    social_links = { ...social_links, ...root.social_links };
    menu_links = root.menu_links.filter(link => link.startsWith(startUrl));

    // ✅ ABN lookup
    let guess = root.page.title || root.page.headings?.[0] || null;
    try {
      const abnMatch = (root.html && typeof root.html === 'string')
        ? root.html.match(/\b\d{2}[ ]?\d{3}[ ]?\d{3}[ ]?\d{3}\b/)
        : null;
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

    const crawlResult = {
      site: startUrl,
      pages,
      menu_links,
      social_links,
      abn_lookup
    };

    // 📌 Save to BostonOS
    if (!BOSTONOS_API_TOKEN) {
      return res.status(500).json({ error: 'Missing BOSTONOS_API_TOKEN' });
    }

    const slug = new URL(startUrl)
      .hostname
      .replace(/^www\./, '')
      .replace(/\./g, '')
      .toLowerCase();

    const bostonosPath = `mk4/capsules/profile_generator/data/profiles/${slug}_raw.json`;

    const saveRes = await fetch(BOSTONOS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BOSTONOS_API_TOKEN}`
      },
      body: JSON.stringify({
        bucket: 'tradecard',
        key: bostonosPath,
        content: JSON.stringify(crawlResult)
      })
    });

    if (!saveRes.ok) {
      return res.status(500).json({ error: `Failed to save to BostonOS: ${await saveRes.text()}` });
    }

    console.log(`✅ Saved raw crawl to BostonOS as ${bostonosPath}`);

    // Return ONLY the BostonOS storage path
    return res.status(200).json({ saved_to_bostonos: bostonosPath });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Crawl failed' });
  }
};
