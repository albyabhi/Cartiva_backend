import express from "express";
import fetchAmazonDeals from "./OfferFetch.js"; // Adjust path as needed
import { fetchAllProducts, deleteOldProducts } from "./TeleBot.js"; // Adjust path as needed

const router = express.Router();

router.get('/trigger-fetch', async (req, res) => {
  try {
    console.log(`\n🚀 Manual fetch triggered at ${new Date().toLocaleString()}`);
    await fetchAmazonDeals();     
    await fetchAllProducts();   
    await deleteOldProducts();  
    res.status(200).send('✅ Fetch completed.');
  } catch (error) {
    console.error('❌ Error in /trigger-fetch:', error.message);
    res.status(500).send('❌ Fetch failed.');
  }
});

export default router;
