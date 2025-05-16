import axios from 'axios';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
dotenv.config();

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Accept-Language': 'en-IN,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
  'Referer': 'https://www.google.com/',
  'DNT': '1',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'no-cache',
};


function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const BACKEND_API = `${process.env.BACKEND_URL}/product/add-product`;

// List of categories with their Amazon URLs
const categories = [
  { name: 'Electronics', url: 'https://www.amazon.in/s?i=electronics' },
  { name: 'Mobile Phones & Accessories', url: 'https://www.amazon.in/s?i=mobile' },
  { name: 'Home & Kitchen', url: 'https://www.amazon.in/s?i=garden' },
  { name: 'Fashion', url: 'https://www.amazon.in/s?i=fashion' },
  { name: "Men's Wear", url: 'https://www.amazon.in/s?i=fashion&rh=n%3A1968024031' },
  { name: "Ladies' Wear", url: 'https://www.amazon.in/s?i=fashion&rh=n%3A1968023031' },
  { name: 'Beauty & Personal Care', url: 'https://www.amazon.in/s?i=beauty' },
  { name: 'Toys & Games', url: 'https://www.amazon.in/s?i=toys-and-games' },
  { name: 'Sports & Outdoors', url: 'https://www.amazon.in/s?i=sports' },
  { name: 'Computers & Accessories', url: 'https://www.amazon.in/s?i=computers' },
  { name: 'Baby Products', url: 'https://www.amazon.in/s?i=baby' },
  { name: 'Grocery & Gourmet Food', url: 'https://www.amazon.in/s?i=grocery' },
  { name: 'Industrial & Scientific', url: 'https://www.amazon.in/s?i=industrial' },
];



async function fetchAmazonDealsByCategory() {
  for (const category of categories) {
    console.log(`\n📂 Scraping category: ${category.name}`);

    const productLinksSet = new Set();
    let successfulCount = 0;
    const maxProducts = 10;
    const maxPages = 3; 

    for (let page = 1; page <= maxPages; page++) {
      if (successfulCount >= maxProducts) break;

      const pageUrl = `${category.url}&page=${page}`;
      console.log(`📝 Fetching page ${page} for ${category.name}...`);

      try {
        const response = await axios.get(pageUrl, { headers });
        const $ = cheerio.load(response.data);

        // Collect product links from this page
        const pageProductLinks = [];
        $('a.a-link-normal.s-no-outline').each((_, el) => {
          const href = $(el).attr('href');
          if (href && href.startsWith('/')) {
            const fullUrl = `https://www.amazon.in${href.split('?')[0]}`;
            if (!productLinksSet.has(fullUrl)) {
              pageProductLinks.push(fullUrl);
            }
          }
        });

        console.log(`🔗 Found ${pageProductLinks.length} new products on page ${page}`);

        for (const productUrl of pageProductLinks) {
          if (successfulCount >= maxProducts) break;

          try {
            await axios.post(BACKEND_API, { url: productUrl });
            productLinksSet.add(productUrl);
            successfulCount++;
            console.log(`✅ [${successfulCount}] Added product: ${productUrl}`);
          } catch (err) {
            console.error(`❌ Failed to add product: ${productUrl}`, err.response?.data || err.message);
          }

          await delay(4000); // delay between product POST requests
        }

      } catch (err) {
        console.error(`❌ Failed to fetch page ${page} of category ${category.name}:`, err.message);
      }

      await delay(4000); // delay between page requests
    }

    console.log(`✅ Finished category ${category.name} with ${successfulCount} products added.`);
  }
}


export default fetchAmazonDealsByCategory;
