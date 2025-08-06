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
    const links = new Set();
    const cssTokens = new Set();
    const text = [];
    const socialLinks = {};

    const SOCIAL_DOMAINS = {
      facebook: 'facebook.com',
      instagram: 'instagram.com',
      linkedin: 'linkedin.com',
      youtube: 'youtube.com',
      tiktok: 'tiktok.com',
      twitter: 'twitter.com',
      x: 'x.com'
    };

    // Raw HTML
    const rawHtml = $.html();

    // Text blocks
    $('h1,h2,h3,h4,h5,h6,p,li').each((_, el) => {
      const tag = el.tagName;
      const content = $(el).text().trim();
      if (content.length > 0) {
        text.push({ tag, text: content });
      }
    });

    // Images from tags
    $('img, source').each((_, el) => {
      const candidates = [
        $(el).attr('src'),
        $(el).attr('data-src'),
        $(el).attr('data-srcset'),
        $(el).attr('srcset')
      ];
      candidates.forEach(raw => {
        if (!raw) return;
        raw.split(',').forEach(s => {
          const path = s.trim().split(' ')[0];
          try {
            if (path && /\.(jpe?g|png|webp|svg|gif)/i.test(path)) {
              images.add(new URL(path, base).href);
            }
          } catch {}
        });
      });
    });

    // Background images from inline style
    $('[style*="background"]').each((_, el) => {
      const style = $(el).attr('style') || '';
      const match = /url\(['"]?([^"')]+)['"]?\)/i.exec(style);
      if (match && match[1]) {
        try {
          const url = match[1].trim();
          if (/\.(jpe?g|png|webp|svg|gif)/i.test(url)) {
            images.add(new URL(url, base).href);
          }
        } catch {}
      }
    });

    // All links
    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        try {
          const full = new URL(href, base).href;
          links.add(full);
          for (const [platform, domain] of Object.entries(SOCIAL_DOMAINS)) {
            if (full.includes(domain)) {
              socialLinks[platform] = full;
            }
          }
        } catch {}
      }
    });

    // Inline CSS color tokens
    $('[style]').each((_, el) => {
      const style = $(el).attr('style') || '';
      for (const match of style.matchAll(/#[a-f0-9]{3,6}/gi)) {
        cssTokens.add(match[0].toLowerCase());
      }
    });

    // Linked stylesheets
    const cssPromises = [];
    $('link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        try {
          const cssUrl = new URL(href, base).href;
          cssPromises.push(fetch(cssUrl).then(r => r.text()));
        } catch {}
      }
    });

    const cssContents = await Promise.all(cssPromises);
    cssContents.forEach(css => {
      for (const match of css.matchAll(/#[a-f0-9]{3,6}/gi)) {
        cssTokens.add(match[0].toLowerCase());
      }
    });

    res.status(200).json({
      html: rawHtml,
      images: Array.from(images),
      links: Array.from(links),
      text,
      css_tokens: Array.from(cssTokens).slice(0, 10),
      social_links: socialLinks
    });

  } catch (err) {
    res.status(500).json({ error: err.message || 'Scrape failed' });
  }
}
