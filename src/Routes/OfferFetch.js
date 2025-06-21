import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";

dotenv.config();

// Random User-Agent headers
const getRandomUserAgent = () => {
  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36 Edg/117.0.2045.60",
  ];
  return userAgents[Math.floor(Math.random() * userAgents.length)];
};

const getHeaders = () => ({
  "User-Agent": getRandomUserAgent(),
  "Accept-Language": "en-IN,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  Referer: "https://www.amazon.in/",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const BACKEND_API = `${process.env.BACKEND_URL}/product/add-product`;
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

const categories = [
  { name: "Electronics", url: "https://www.amazon.in/s?node=976419031&rh=p_n_deal_type:26921224031" },
  { name: "Mobile Phones", url: "https://www.amazon.in/s?node=1389401031&rh=p_n_deal_type:26921224031" },
  { name: "Books", url: "https://www.amazon.in/s?node=976389031&rh=p_n_deal_type:26921224031" },
  { name: "Home & Kitchen", url: "https://www.amazon.in/s?node=976442031&rh=p_n_deal_type:26921224031" },
  { name: "Fashion", url: "https://www.amazon.in/s?node=1968024031&rh=p_n_deal_type:26921224031" },
  { name: "Beauty", url: "https://www.amazon.in/s?node=1355016031&rh=p_n_deal_type:26921224031" },
  { name: "Toys", url: "https://www.amazon.in/s?node=1350380031&rh=p_n_deal_type:26921224031" },
  { name: "Sports", url: "https://www.amazon.in/s?node=1984443031&rh=p_n_deal_type:26921224031" },
  { name: "Computers", url: "https://www.amazon.in/s?node=976392031&rh=p_n_deal_type:26921224031" },
  { name: "Baby", url: "https://www.amazon.in/s?node=1571274031&rh=p_n_deal_type:26921224031" },
  { name: "Grocery", url: "https://www.amazon.in/s?node=2454178031&rh=p_n_deal_type:26921224031" },
  { name: "Gaming Laptops", url: "https://www.amazon.in/s?node=1375424031&rh=p_n_deal_type:26921224031" },
  { name: "Gaming Consoles", url: "https://www.amazon.in/s?node=40910948031&rh=p_n_deal_type:26921224031" },
  { name: "Headphones & Earphones", url: "https://www.amazon.in/s?node=1389432031&rh=p_n_deal_type:26921224031" },
  { name: "PC Accessories", url: "https://www.amazon.in/s?node=1375345031&rh=p_n_deal_type:26921224031" },
  { name: "Mobile Accessories", url: "https://www.amazon.in/s?node=1805560031&rh=p_n_deal_type:26921224031" },
  { name: "Cameras", url: "https://www.amazon.in/s?node=1389396031&rh=p_n_deal_type:26921224031" },
  { name: "Smart Watches", url: "https://www.amazon.in/s?node=1571271031&rh=p_n_deal_type:26921224031" },
  { name: "Televisions", url: "https://www.amazon.in/s?node=1389396031&rh=p_n_deal_type:26921224031" },
  { name: "External Storage", url: "https://www.amazon.in/s?node=1375342031&rh=p_n_deal_type:26921224031" },
  { name: "Gaming Accessories", url: "https://www.amazon.in/s?node=40910948031&rh=p_n_deal_type:26921224031" },
  { name: "Bluetooth Speakers", url: "https://www.amazon.in/s?node=1389401031&rh=p_n_deal_type:26921224031" },
  { name: "Smart Home Devices", url: "https://www.amazon.in/s?node=14644992031&rh=p_n_deal_type:26921224031" },
  { name: "Kitchen Appliances", url: "https://www.amazon.in/s?node=1380365031&rh=p_n_deal_type:26921224031" },
  { name: "Office Furniture", url: "https://www.amazon.in/s?node=3591666031&rh=p_n_deal_type:26921224031" },
];


const maxPagesPerCategory = 3;
const globalProcessedProducts = new Set();

const isSupportedProduct = (url) => {
  const unsupportedPatterns = [
    /\/ebook\//i,
    /\/dp\/B0[\w]+-Kindle/i,
    /\/digital\//i,
    /\/software\//i,
    /\/mp3\//i,
    /\/video\//i,
    /\/prime-video\//i,
    /\/music\//i,
    /\/app\//i,
    /\/subscription\//i,
    /\/streaming\//i,
    /\/dgtl\//i,
  ];
  return !unsupportedPatterns.some((pattern) => pattern.test(url));
};

// Retry request handler (no proxy)
async function fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      const config = {
        ...options,
        headers: { ...getHeaders(), ...(options.headers || {}) },
        timeout: 15000,
      };
      const response = await axios.get(url, config);
      return response;
    } catch (error) {
      if (i === retries - 1) throw error;
      console.log(`Retry ${i + 1}/${retries} for ${url}`);
      await delay(RETRY_DELAY * (i + 1));
    }
  }
}

const extractAsin = (url) => {
  const asinRegex = /(?:[/dp/]|$)([A-Z0-9]{10})/;
  const match = url.match(asinRegex);
  return match ? match[1] : null;
};

async function sendToBackend(url) {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const response = await axios.post(BACKEND_API, { url });

      // Check for success status and data
      if (response.status === 201 && response.data?.data) {
        console.log(`✅ Product saved: ${response.data.data.title}`);
        return true;
      }

      // Product already exists or updated
      if (response.status === 200 && response.data?.data) {
        console.log(
          `ℹ️ Product exists or updated: ${response.data.data.title}`
        );
        return true;
      }

      // Unexpected status
      console.warn(
        `⚠️ Unexpected response from server for ${url}:`,
        response.status,
        response.data
      );
      return false;
    } catch (error) {
      if (i === MAX_RETRIES - 1) {
        console.error(
          `❌ Final failure for ${url}:`,
          error.response?.data || error.message
        );
        return false;
      }
      console.log(`🔁 Retry ${i + 1} for ${url}`);
      await delay(3000 * (i + 1));
    }
  }
}

const getProductType = ($, element) => {
  const badgeText = $(element)
    .find(".s-title-instructions-style + div span:first-child")
    .text()
    .trim();
  const title = $(element).find("h2").text().trim().toLowerCase();
  if (badgeText) return badgeText;
  if (title.includes("kindle")) return "Kindle eBook";
  if (title.includes("subscription")) return "Subscription";
  if (title.includes("digital")) return "Digital Product";
  if (title.includes("prime video")) return "Video";
  return "Physical Product";
};

async function fetchAmazonDealsByCategory() {
  console.log("🚀 Starting scraping without proxy...");

  for (const [index, category] of categories.entries()) {
    console.log(
      `\n📂 [${index + 1}/${categories.length}] Scraping category: ${
        category.name
      }`
    );

    let hasNextPage = true;
    let page = 1;

    while (hasNextPage && page <= maxPagesPerCategory) {
      console.log(`📝 Page ${page} for ${category.name}...`);
      const pageUrl = `${category.url}&page=${page}`;

      try {
        const response = await fetchWithRetry(pageUrl);
        const $ = cheerio.load(response.data);

        const productLinks = new Set();
        $("div[data-component-type='s-search-result']").each((_, element) => {
          const linkElement = $(element).find("a.a-link-normal.s-no-outline");
          const href = linkElement.attr("href");

          if (href && href.startsWith("/")) {
            const fullUrl = `https://www.amazon.in${href.split("?")[0]}`;
            if (!isSupportedProduct(fullUrl)) {
              const productType = getProductType($, element);
              console.log(`⏩ Skipping ${productType}: ${fullUrl}`);
              return;
            }
            productLinks.add(fullUrl);
          }
        });

        let newProducts = 0;
        for (const productUrl of Array.from(productLinks)) {
          if (newProducts >= 10) break;

          const asin = extractAsin(productUrl);
          if (!asin || globalProcessedProducts.has(asin)) continue;

          globalProcessedProducts.add(asin);

          try {
            const response = await axios.post(BACKEND_API, { url: productUrl });

            if (response.status === 201 && response.data?.data) {
              console.log(`✅ Product saved: ${response.data.data.title}`);
              newProducts++;
            } else if (response.status === 200 && response.data?.data) {
              console.log(
                `ℹ️ Product exists or updated: ${response.data.data.title}`
              );
            } else {
              console.warn(
                `⚠️ Unexpected response from server for ${productUrl}:`,
                response.status,
                response.data
              );
            }
          } catch (error) {
            console.error(
              `❌ Failed to add product: ${productUrl}`,
              error.response?.data || error.message
            );
          }

          await delay(1500);
        }

        console.log(`✨ Added ${newProducts} new products from page ${page}`);

        hasNextPage =
          $(".s-pagination-next").length > 0 &&
          !$(".s-pagination-next").hasClass("s-pagination-disabled");
        page++;
      } catch (err) {
        console.error(`🚨 Failed to process page ${page}:`, err.message);
        break;
      }

      await delay(6000);
    }
  }

  console.log("\n🎉 All categories scraped successfully!");
  console.log(`📊 Total unique products: ${globalProcessedProducts.size}`);
}

export default fetchAmazonDealsByCategory;
