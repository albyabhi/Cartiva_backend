import express from "express";
import axios from "axios"; 
import dotenv from 'dotenv';
import fetchAmazonDealsByCategory from "./OfferFetch.js";
import { fetchAllProducts, deleteOldProducts } from "./TeleBot.js";
dotenv.config();

const router = express.Router();

router.get('/trigger-fetch', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (msg) => {
    res.write(`data: ${msg}\n\n`);
  };

  const sendAndLog = async (msg) => {
    console.log(msg);
    send(msg);
  };

  try {
    sendAndLog("🚀 Starting fetch process...");

    await sendAndLog("📦 Step 1/3: Fetching Amazon deals...");
    await fetchAmazonDealsByCategory();
    await sendAndLog("✅ Step 1 completed.");

    await sendAndLog("📤 Step 2/3: Sending products to Telegram...");
    const products = await fetchAllProducts();
    await sendAndLog(`✅ Step 2 completed. ${products.length} products shared.`);

    await sendAndLog("🧹 Step 3/3: Deleting old products...");
    const result = await deleteOldProducts();
    await sendAndLog(`✅ Step 3 completed. Deleted ${result.deletedCount} old products.`);

    await sendAndLog("🎉 All steps completed successfully!");
    res.end(); // Done
  } catch (error) {
    send(`❌ Error: ${error.message}`);
    res.end(); // Close stream on error
  }
});

export default router;
