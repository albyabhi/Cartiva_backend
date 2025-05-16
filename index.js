import dotenv from 'dotenv';
import cron from 'node-cron';
import express from 'express';
import cors from 'cors';
import connectDB from './src/config/db.js';

import Product from './src/Routes/Product.js';
import fetchAllProducts from './src/Routes/TeleBot.js';
import fetchAmazonDeals from './src/Routes/OfferFetch.js';

dotenv.config();

connectDB();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/product', Product);

cron.schedule('0 1,6,9,12,15,18,21 * * *', async () => {
  console.log('\n⏰ Scheduled fetch started...');
  try {
    await fetchAmazonDeals();
    console.log('✅ Fetch complete.');
    await fetchAllProducts();
  } catch (error) {
    console.error('❌ Error during scheduled fetch:', error.message);
  }
});


(async () => {
  try {
    await fetchAmazonDeals();
    await fetchAllProducts();
  } catch (error) {
    console.error('❌ Error during startup fetch:', error.message);
  }
})();

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
