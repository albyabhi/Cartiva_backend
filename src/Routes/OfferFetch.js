import puppeteer from 'puppeteer-core'; 
import chromium from '@sparticuz/chromium';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

// Configure Chromium
chromium.setHeadlessMode = true;
chromium.setGraphicsMode = false;

const getRandomUserAgent = () => {
  const agents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36"
  ];
  return agents[Math.floor(Math.random() * agents.length)];
};

// Backend configuration
const BACKEND_API = `${process.env.BACKEND_URL}/product/add-product`;
const MAX_RETRIES = 3;
const PAGE_LIMIT = 3;
const globalProcessedASINs = new Set();

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

const launchBrowser = async () => {
  return puppeteer.launch({
    args: chromium.args,
    executablePath: process.env.CHROMIUM_PATH || await chromium.executablePath(),
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
  });
};

const categories = [
  { name: "Electronics", url: "https://www.amazon.in/s?rh=n:976419031,p_n_deal_type:26921224031" },
  { name: "Mobile Phones", url: "https://www.amazon.in/s?rh=n:1389401031,p_n_deal_type:26921224031" },
  { name: "Books", url: "https://www.amazon.in/s?rh=n:976389031,p_n_deal_type:26921224031" },
  { name: "Home & Kitchen", url: "https://www.amazon.in/s?rh=n:976442031,p_n_deal_type:26921224031" },
  // ... (rest of your categories)
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
  throw new Error('Max retries exceeded');
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



const scrapeCategoryPage = async (url, categoryName, pageNum, browser) => {
  console.log(`📝 Scraping ${categoryName} - Page ${pageNum}`);
  const page = await browser.newPage();
  
  try {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.setUserAgent(getRandomUserAgent());
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-IN,en;q=0.9',
      'Referer': 'https://www.amazon.in/',
    });

    await page.goto(`${url}&page=${pageNum}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Check for captcha
    if (await page.$('#captchacharacters')) {
      throw new Error('CAPTCHA encountered');
    }

    const productUrls = await page.$$eval(
      "div[data-component-type='s-search-result'] a.a-link-normal.s-no-outline",
      (links) => links.map((link) => link.href)
    );

    return productUrls
      .map((url) => ({ url, asin: extractASIN(url) }))
      .filter(({ url, asin }) => 
        asin && 
        !globalProcessedASINs.has(asin) && 
        isSupportedProduct(url)
      );

  } finally {
    await page.close();
  }
};

const fetchAmazonDealsByCategory = async () => {
 console.log("🚀 Scraper started with Chromium configuration...");
  const browser = await launchBrowser();

  try {
    for (const { name, url } of categories) {
      console.log(`📂 Category: ${name}`);
      
      for (let page = 1; page <= PAGE_LIMIT; page++) {
        try {
          const products = await retryRequest(() =>
            scrapeCategoryPage(url, name, page, browser)
          );

          for (const { asin } of products) {
            globalProcessedASINs.add(asin);
          }

          for (const { url } of products.slice(0, 10)) {
            await sendProductToBackend(url);
            await delay(1000);
          }

          await delay(3000);
        } catch (err) {
          console.warn(`❌ Skipped ${name} page ${page}:`, err.message);
          break;
        }
      }
    }
  } finally {
    await browser.close();
    console.log("🎉 Scraping completed.");
    console.log(`📊 Total unique products sent: ${globalProcessedASINs.size}`);
  }
};

export default fetchAmazonDealsByCategory;