import axios from 'axios';
import Product from '../Schemas/Product.js';
import dotenv from 'dotenv';
dotenv.config();


const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

function escapeMarkdown(text) {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}



async function sendProductToTelegram(product) {
  const caption = `🔥 *${escapeMarkdown(product.title)}*\n` +
                  `💰 Price: ₹${product.price}\n` +
                  (product.discount > 0 ? `🎯 Discount: ${product.discount}% off\n` : '');

  try {
    const res = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
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
    console.log('Product sent:', product.title);
    await Product.findByIdAndUpdate(product._id, { shareStatus: 'shared' });
    console.log('Product sent and status updated:', product.title);
  } catch (error) {
    const retryAfter = error.response?.data?.parameters?.retry_after;
    if (retryAfter) {
      console.warn(`⏳ Rate limit hit. Retrying after ${retryAfter} seconds...`);
      await new Promise(resolve => setTimeout(resolve, (retryAfter + 1) * 1000));
      return sendProductToTelegram(product); // Retry after wait
    }
    console.error('Failed to send product:', error.response?.data || error.message);
  }
}


async function sendProductDetails(products) {
  for (const product of products) {
    console.log('Sending product:', product.title);
    await sendProductToTelegram(product);
    await new Promise(resolve => setTimeout(resolve, 4000)); // 4 seconds delay
  }
}


async function fetchAllProducts() {
  try {
    const products = await Product.find({ shareStatus: 'pending' }).sort({ addedAt: -1 }); // latest pending products
    await sendProductDetails(products);
    return products;
  } catch (error) {
    console.error('❌ Error fetching products:', error.message);
    throw new Error('Failed to fetch products from database');
  }
}

export default fetchAllProducts;
