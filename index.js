import dotenv from "dotenv";
import cron from "node-cron";
import express from "express";
import cors from "cors";
import connectDB from "./src/config/db.js";

import Product from "./src/Routes/Product.js";
import { fetchAllProducts, deleteOldProducts } from "./src/Routes/TeleBot.js";
import fetchAmazonDeals from "./src/Routes/OfferFetch.js";

import TriggerRoutes from "./src/Routes/TriggerRoute.js"

dotenv.config();
connectDB();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/product", Product);
app.use("/",TriggerRoutes)

let nextFetchTime = null;
const FOUR_HOURS = 4 * 60 * 60 * 1000;

cron.schedule('0 */4 * * *', async () => {
  const now = new Date();
  console.log(`\n⏰ Scheduled fetch started at ${now.toLocaleString()}`);

  try {
    await fetchAllProducts();
    console.log('Deleting old products...');
    await deleteOldProducts();
    console.log('✅ Scheduled tasks completed.');
  } catch (error) {
    console.error('❌ Error during scheduled fetch:', error.message);
  }

  // Update next fetch time
  nextFetchTime = new Date(Date.now() + FOUR_HOURS);
});

(async () => {
  try {
    await fetchAmazonDeals();
    await fetchAllProducts();
    await deleteOldProducts();
    console.log('✅ Startup tasks completed.');
  } catch (error) {
    console.error('❌ Error during startup fetch:', error.message);
  }

  // Set next fetch time after startup
  nextFetchTime = new Date(Date.now() + FOUR_HOURS);
})();

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

setInterval(() => {
  if (!nextFetchTime) return;

  const now = new Date();
  const diffMs = nextFetchTime - now;

  if (diffMs > 0) {
    const diffMinutes = Math.ceil(diffMs / (1000 * 60));
    console.log(`${diffMinutes} minutes to next fetch`);
  } else {
    console.log('Next fetch is about to start...');
  }
}, 60 * 1000); 
