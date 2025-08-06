import express from 'express';
import parseProfile from '../utils/parseProfile.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const { url } = req.query;

  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'Invalid or missing URL' });
  }

  try {
    const result = await parseProfile(url);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to scrape' });
  }
});

export default router;
