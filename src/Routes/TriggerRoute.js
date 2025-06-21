import express from "express";
import axios from "axios"; 
import dotenv from 'dotenv';
import fetchAmazonDealsByCategory from "./OfferFetch.js";
import { fetchAllProducts, deleteOldProducts } from "./TeleBot.js";
dotenv.config();

const router = express.Router();

router.get('/trigger-fetch', async (req, res) => {
  const chatId = req.query.chatId;

  const sendProgress = async (msg) => {
    if (!chatId) return;
    try {
      await axios.post(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: msg,
      });
    } catch (err) {
      console.error('❌ Failed to send progress update:', err.message);
    }
  };

  try {
    console.log(`\n🚀 Fetch started at ${new Date().toLocaleString()}`);
    await sendProgress("🚀 Starting fetch process...");

    await sendProgress("📦 Step 1/3: Fetching Amazon deals...");
    await fetchAmazonDealsByCategory();
    await sendProgress("✅ Step 1 completed.");

    await sendProgress("📤 Step 2/3: Sending products to Telegram...");
    const products = await fetchAllProducts();
    await sendProgress(`✅ Step 2 completed. ${products.length} products shared.`);

    await sendProgress("🧹 Step 3/3: Deleting old products...");
    const result = await deleteOldProducts();
    await sendProgress(`✅ Step 3 completed. Deleted ${result.deletedCount} old products.`);

    await sendProgress("🎉 All steps completed successfully!");
    res.status(200).send('✅ Fetch completed.');
  } catch (error) {
    console.error('❌ Fetch failed:', error);
    await sendProgress(`❌ Fetch failed: ${error.message}`);
    res.status(500).send(`❌ Fetch failed: ${error.message}`);
  }
});

export default router;
