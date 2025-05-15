import axios from 'axios';
import Product from '../Schemas/Product.js';

const BOT_TOKEN = '8063201137:AAHBhq2YQAcYAvRQDxQSg7_4jwI7rzrc_y0';
const CHAT_ID = -4973032930;

async function sendProductToTelegram(product) {
  const caption = `🔥 *${product.title}*\n` +
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
    console.error('Failed to send product:', error.response?.data || error.message);
  }
}

async function sendProductDetails(products) {
  // Loop over products sequentially to avoid flooding Telegram
  for (const product of products) {
    console.log('Sending product:', product.title);
    await sendProductToTelegram(product);
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
