import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";

dotenv.config();

const getRandomUserAgent = () => {
  const agents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64)...", // trim for brevity
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...",
    "Mozilla/5.0 (X11; Linux x86_64)...",
  ];
  return agents[Math.floor(Math.random() * agents.length)];
};

const getHeaders = () => ({
  "User-Agent": getRandomUserAgent(),
  "Accept-Language": "en-IN,en;q=0.9",
  "Referer": "https://www.amazon.in/",
});

const BACKEND_API = `${process.env.BACKEND_URL}/product/add-product`;
const MAX_RETRIES = 3;
const PAGE_LIMIT = 3;
const globalProcessedASINs = new Set();

const delay = (ms) => new Promise((res) => setTimeout(res, ms));


const categories = [
  { name: "Electronics", url: "https://www.amazon.in/s?rh=n:976419031,p_n_deal_type:26921224031" },
  { name: "Mobile Phones", url: "https://www.amazon.in/s?rh=n:1389401031,p_n_deal_type:26921224031" },
  { name: "Books", url: "https://www.amazon.in/s?rh=n:976389031,p_n_deal_type:26921224031" },
  { name: "Home & Kitchen", url: "https://www.amazon.in/s?rh=n:976442031,p_n_deal_type:26921224031" },
  { name: "Fashion", url: "https://www.amazon.in/s?rh=n:1968024031,p_n_deal_type:26921224031" },
  { name: "Beauty", url: "https://www.amazon.in/s?rh=n:1355016031,p_n_deal_type:26921224031" },
  { name: "Toys", url: "https://www.amazon.in/s?rh=n:1350380031,p_n_deal_type:26921224031" },
  { name: "Sports", url: "https://www.amazon.in/s?rh=n:1984443031,p_n_deal_type:26921224031" },
  { name: "Computers", url: "https://www.amazon.in/s?rh=n:976392031,p_n_deal_type:26921224031" },
  { name: "Baby", url: "https://www.amazon.in/s?rh=n:1571274031,p_n_deal_type:26921224031" },
  { name: "Grocery", url: "https://www.amazon.in/s?rh=n:2454178031,p_n_deal_type:26921224031" },
  { name: "Gaming Laptops", url: "https://www.amazon.in/s?rh=n:1375424031,p_n_deal_type:26921224031" },
  { name: "Gaming Consoles", url: "https://www.amazon.in/s?rh=n:40910948031,p_n_deal_type:26921224031" },
  { name: "Headphones & Earphones", url: "https://www.amazon.in/s?rh=n:1389432031,p_n_deal_type:26921224031" },
  { name: "PC Accessories", url: "https://www.amazon.in/s?rh=n:1375345031,p_n_deal_type:26921224031" },
  { name: "Mobile Accessories", url: "https://www.amazon.in/s?rh=n:1805560031,p_n_deal_type:26921224031" },
  { name: "Cameras", url: "https://www.amazon.in/s?rh=n:1389396031,p_n_deal_type:26921224031" },
  { name: "Smart Watches", url: "https://www.amazon.in/s?rh=n:1571271031,p_n_deal_type:26921224031" },
  { name: "Televisions", url: "https://www.amazon.in/s?rh=n:1389396031,p_n_deal_type:26921224031" },
  { name: "External Storage", url: "https://www.amazon.in/s?rh=n:1375342031,p_n_deal_type:26921224031" },
  { name: "Gaming Accessories", url: "https://www.amazon.in/s?rh=n:40910948031,p_n_deal_type:26921224031" },
  { name: "Bluetooth Speakers", url: "https://www.amazon.in/s?rh=n:1389401031,p_n_deal_type:26921224031" },
  { name: "Smart Home Devices", url: "https://www.amazon.in/s?rh=n:14644992031,p_n_deal_type:26921224031" },
  { name: "Kitchen Appliances", url: "https://www.amazon.in/s?rh=n:1380365031,p_n_deal_type:26921224031" },
  { name: "Office Furniture", url: "https://www.amazon.in/s?rh=n:3591666031,p_n_deal_type:26921224031" },
];



const isSupportedProduct = (url) => ![
  /\/ebook\//i, /-Kindle/i, /\/digital\//i, /\/video\//i, /\/music\//i,
  /\/app\//i, /\/subscription\//i, /\/streaming\//i
].some((pattern) => pattern.test(url));

const extractASIN = (url) => {
  const match = url.match(/(?:[/dp/]|$)([A-Z0-9]{10})/);
  return match?.[1] || null;
};

const retryRequest = async (fn, maxTries = MAX_RETRIES) => {
  for (let i = 0; i < maxTries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxTries - 1) throw err;
      await delay(1000 * (i + 1));
    }
  }
};

const sendProductToBackend = async (url) => {
  try {
    const res = await retryRequest(() =>
      axios.post(BACKEND_API, { url }, { timeout: 10000 })
    );
    const title = res.data?.data?.title || "Unknown";
    const status = res.status === 201 ? "✅ Saved" : "ℹ️ Exists";
    console.log(`${status}: ${title}`);
  } catch (err) {
    console.warn(`❌ Failed: ${url}`, err.response?.data || err.message);
  }
};

const parseProductsFromHTML = ($) => {
  const productUrls = [];
  $("div[data-component-type='s-search-result']").each((_, el) => {
    const href = $(el).find("a.a-link-normal.s-no-outline").attr("href");
    if (href?.startsWith("/")) {
      const url = `https://www.amazon.in${href.split("?")[0]}`;
      if (isSupportedProduct(url)) productUrls.push(url);
    }
  });
  return productUrls;
};

const scrapeCategoryPage = async (url, categoryName, pageNum) => {
  console.log(`📝 Scraping ${categoryName} - Page ${pageNum}`);
  const res = await retryRequest(() =>
    axios.get(`${url}&page=${pageNum}`, { headers: getHeaders() })
  );
  const $ = cheerio.load(res.data);
  const urls = parseProductsFromHTML($);
  const newUrls = urls
    .map((url) => ({ url, asin: extractASIN(url) }))
    .filter(({ asin }) => asin && !globalProcessedASINs.has(asin));

  for (const { asin } of newUrls) globalProcessedASINs.add(asin);
  return newUrls.map(({ url }) => url);
};

const fetchAmazonDealsByCategory = async () => {
  console.log("🚀 Scraper started...");

  for (const { name, url } of categories) {
    console.log(`📂 Category: ${name}`);
    for (let page = 1; page <= PAGE_LIMIT; page++) {
      try {
        const productUrls = await scrapeCategoryPage(url, name, page);
        const tasks = productUrls.slice(0, 10).map((url) =>
          sendProductToBackend(url).then(() => delay(1000))
        );
        await Promise.allSettled(tasks);

        await delay(3000);
      } catch (err) {
        console.warn(`❌ Skipped ${name} page ${page}:`, err.message);
        break;
      }
    }
  }

  console.log("🎉 Scraping completed.");
  console.log(`📊 Total unique products sent: ${globalProcessedASINs.size}`);
};

export default fetchAmazonDealsByCategory;
