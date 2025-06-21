import express from "express";
import fetchAmazonDeals from "./src/Routes/OfferFetch.js";
import { fetchAllProducts, deleteOldProducts } from "./src/Routes/TeleBot.js";

const router = express.Router();

router.get('/trigger-fetch', async (req, res) => {
  try {
    console.log(`\n🚀 Fetch started at ${new Date().toLocaleString()}`);
    
    // Run all tasks sequentially
    await fetchAmazonDeals();
    await fetchAllProducts();
    await deleteOldProducts();
    
    console.log('✅ All tasks completed');
    res.status(200).send('✅ Fetch completed.');
  } catch (error) {
    console.error('❌ Fetch failed:', error);
    res.status(500).send(`❌ Fetch failed: ${error.message}`);
  }
});

export default router;