import * as cheerio from 'cheerio';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  const url = req.query.url;
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    const html = await fetch(url).then(r => r.text());
    const base = new URL(url);
    const $ = cheerio.load(html);

    // ... rest of the logic (see previous message)
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
