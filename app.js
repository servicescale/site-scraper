import express from 'express';
import scrapeRouter from './routes/scrape.js';

const app = express();
const port = process.env.PORT || 3000;

app.use('/scrape', scrapeRouter);

app.listen(port, () => {
  console.log(`Site Scraper running at http://localhost:${port}`);
});
