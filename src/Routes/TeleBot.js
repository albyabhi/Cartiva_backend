// src/Routes/TeleBot.js

import axios from 'axios';
import Product from '../Schemas/Product.js';
import dotenv from 'dotenv';
import TelegramBot from "node-telegram-bot-api";

dotenv.config();

const BACKEND_API = `${process.env.BACKEND_URL}/product/add-product`;
const SERVER_URL = process.env.SERVER_URL; // ✅ added this
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

function escapeMarkdown(text) {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

async function sendProductToTelegram(product) {
  const caption = `🔥 *${escapeMarkdown(product.title)}*\n` +
    `💰 Price: ₹${product.price}\n` +
    (product.discount > 0 ? `🎯 Discount: ${product.discount}% off\n` : '');

  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
      chat_id: CHAT_ID,
      photo: product.image,
      caption: caption,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🛒 Buy Now",
              url: product.affiliateLink
            }
          ]
        ]
      }
    });

    console.log('✅ Product sent:', product.title);
    await Product.findByIdAndUpdate(product._id, { shareStatus: 'shared' });
    console.log('🔄 Share status updated');
  } catch (error) {
    const retryAfter = error.response?.data?.parameters?.retry_after;
    if (retryAfter) {
      console.warn(`⏳ Rate limited. Retrying in ${retryAfter} seconds...`);
      await new Promise(resolve => setTimeout(resolve, (retryAfter + 1) * 1000));
      return sendProductToTelegram(product); // Retry
    }
    console.error('❌ Failed to send product:', error.response?.data || error.message);
  }
}

async function sendProductDetails(products) {
  for (const product of products) {
    console.log('📤 Sending product:', product.title);
    await sendProductToTelegram(product);
    await new Promise(resolve => setTimeout(resolve, 4000)); // Wait 4s to avoid spam
  }
}

async function fetchAllProducts() {
  try {
    const products = await Product.find({ shareStatus: 'pending' }).sort({ addedAt: -1 });
    await sendProductDetails(products);
    return products;
  } catch (error) {
    console.error('❌ Error fetching products:', error.message);
    throw new Error('Failed to fetch products from database');
  }
}

async function deleteOldProducts(days = 2) {
  try {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await Product.deleteMany({ addedAt: { $lt: cutoffDate } });
    console.log(`🗑️ Deleted ${result.deletedCount} products older than ${days} day(s).`);
    return result;
  } catch (error) {
    console.error('❌ Failed to delete old products:', error.message);
    throw new Error('Error deleting old products');
  }
}

bot.onText(/\/fetch/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    // Step 1: Notify fetch start
    await bot.sendMessage(chatId, '🚀 Fetching started...');

    // Step 2: Call backend API and stream progress
    let progressMessages = [
      '📦 Step 1/3: Fetching Amazon Deals...',
      '📡 Step 2/3: Sharing to Telegram...',
      '🧹 Step 3/3: Cleaning old products...'
    ];

    for (let i = 0; i < progressMessages.length; i++) {
      await bot.sendMessage(chatId, `${progressMessages[i]}\nProgress: ${Math.floor((i / 3) * 100)}%`);
      if (i === 0) await fetchAmazonDeals();
      if (i === 1) await fetchAllProducts();
      if (i === 2) await deleteOldProducts();
      await new Promise((res) => setTimeout(res, 1000)); // Just for visible delay
    }

    await bot.sendMessage(chatId, '✅ Fetch Completed! Progress: 100%');

  } catch (error) {
    console.error("❌ Error calling fetch route:", error.message);
    await bot.sendMessage(chatId, `❌ Fetch Failed: ${error.message}`);
  }
});


export {
  fetchAllProducts,
  deleteOldProducts
};
