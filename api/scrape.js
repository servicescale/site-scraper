const cheerio = require('cheerio');

export default async function handler(req, res) {
  const url = req.query.url;

  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    const html = await fetch(url).then(r => r.text());
    const base = new URL(url);
    const $ = cheerio.load(html);
    const images = new Set();

    $('img').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      if (src) {
        try {
          images.add(new URL(src, base).href);
        } catch {}
      }
    });

    $('[style*="background-image"]').each((_, el) => {
      const style = $(el).attr('style') || '';
      const match = /url\(['"]?([^"')]+)['"]?\)/i.exec(style);
      if (match && match[1]) {
        try {
          images.add(new URL(match[1], base).href);
        } catch {}
      }
    });

    $('meta[property="og:image"]').each((_, el) => {
      const content = $(el).attr('content');
      if (content) {
        try {
          images.add(new URL(content, base).href);
        } catch {}
      }
    });

    res.status(200).json({
      url,
      images: Array.from(images)
    });

  } catch (err) {
    res.status(500).json({ error: err.message || 'Scrape failed' });
  }
}
