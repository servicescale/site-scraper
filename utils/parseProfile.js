import * as cheerio from 'cheerio';
import fetch from 'node-fetch';

export default async function parseProfile(url) {
  const html = await fetch(url).then(res => res.text());
  const base = new URL(url);
  const $ = cheerio.load(html);

  const images = new Set();
  const brandColors = {};
  const textBlocks = [];
  const socialLinks = {};
  const emails = new Set();
  const phones = new Set();
  const meta = {};

  // 1. IMAGES
$('img').each((_, el) => {
  const src = $(el).attr('src') || $(el).attr('data-src');
  if (src) {
    console.log('Found img:', src);  // ✅ add this line
    try {
      images.add(new URL(src, base).href);
    } catch (err) {
      console.error('Image URL parse failed:', src);
    }
  }
});

  $('[style*="background-image"]').each((_, el) => {
    const style = $(el).attr('style');
    const match = /url\\(['"]?([^"')]+)['"]?\\)/i.exec(style);
    if (match && match[1]) {
      try {
        images.add(new URL(match[1], base).href);
      } catch {}
    }
  });

  // 2. META
  $('meta[property^="og:"], meta[name]').each((_, el) => {
    const name = $(el).attr('name') || $(el).attr('property');
    const content = $(el).attr('content');
    if (name && content) meta[name] = content;
    if (name === 'og:image') {
      try {
        images.add(new URL(content, base).href);
      } catch {}
    }
  });

  // 3. BRAND COLORS from <style>
  $('style').each((_, el) => {
    const css = $(el).html();
    if (!css) return;
    for (const match of css.matchAll(/#[a-f0-9]{3,6}/gi)) {
      const color = match[0].toLowerCase();
      brandColors[color] = (brandColors[color] || 0) + 1;
    }
  });

  // 4. SOCIAL LINKS
  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (/facebook\\.com/i.test(href)) socialLinks.facebook = href;
    if (/instagram\\.com/i.test(href)) socialLinks.instagram = href;
    if (/twitter\\.com|x\\.com/i.test(href)) socialLinks.twitter = href;
    if (/linkedin\\.com/i.test(href)) socialLinks.linkedin = href;
    if (/tiktok\\.com/i.test(href)) socialLinks.tiktok = href;
    if (/youtube\\.com/i.test(href)) socialLinks.youtube = href;
  });

  // 5. EMAILS + PHONES
  const rawText = $.text();
  for (const match of rawText.matchAll(/[\\w.-]+@[\\w.-]+\\.[a-z]{2,}/gi)) {
    emails.add(match[0]);
  }
  for (const match of rawText.matchAll(/(?:\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4})/g)) {
    phones.add(match[0]);
  }

  // 6. TEXT BLOCKS
  $('h1,h2,h3,p,li,section,article,div').each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > 40) textBlocks.push(text);
  });

  // 7. Final Output
  return {
    url,
    title: $('title').text().trim(),
    description: meta.description || meta['og:description'],
    logo: Array.from(images).find(src => /logo/i.test(src)) || null,
    favicon: $('link[rel="icon"]').attr('href') || null,
    brand_colors: Object.entries(brandColors)
      .sort((a, b) => b[1] - a[1])
      .map(([color]) => color)
      .slice(0, 5),
    images: Array.from(images),
    text_blocks: textBlocks,
    social_links: socialLinks,
    contact_info: {
      emails: Array.from(emails),
      phones: Array.from(phones)
    },
    meta
  };
}
