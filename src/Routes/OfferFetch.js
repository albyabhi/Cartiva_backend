import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
dotenv.config();

const headers = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Accept-Language": "en-IN,en;q=0.9",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  Connection: "keep-alive",
};

const BACKEND_API = `${process.env.BACKEND_URL}/product/add-product`;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const categoryQueries = [
  "amazon gaming and proffesional laptop deals",
  "amazon mobile deals",
  "amazon electronic home appliances deals",
  "amazon headphone deals",
  "amazon electronics deals",
  "amazon home and kitchen deals",
  "amazon fashion deals",
  "amazon menswear deals",
  "amazon ladies wear deals",
  "amazon beauty and personal care deals",
  "amazon toys and games deals",
  "amazon sports and outdoors deals",
  "amazon computers and accessories deals",
  "amazon baby products deals",
  "amazon grocery and gourmet food deals",
];

// 🔍 Get Amazon Deals URL from Bing Search
async function getAmazonDealsUrlFromBing(query) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;

  try {
    const response = await axios.get(url, { headers });

    // Load and scope Cheerio parser locally
    const $ = cheerio.load(response.data);
    let validAmazonLink = null;

    $("li.b_algo").each((index, element) => {
      const anchor = $(element).find("a[href]").first();
      const link = anchor.attr("href")?.trim();
      if (!link || !link.includes("amazon.")) return;

      try {
        const parsed = new URL(link);
        const hostname = parsed.hostname.toLowerCase();

        if (hostname.includes("amazon.co.uk") || hostname.endsWith(".uk")) return;
        if (/\/(dp|gp\/product|gp\/offer-listing)\//.test(link)) return;

        if (
          /amazon\.[a-z.]+\/.*(deals|offers|todays-deals|b\?|s\?)/i.test(link)
        ) {
          validAmazonLink = link;
          return false; // break out of .each
        }
      } catch {
        return;
      }
    });

    // 💡 Manually discard Cheerio data
    $("body").empty();
    $.root().empty();

    return validAmazonLink || null;
  } catch (err) {
    console.error(`❌ Bing search failed for "${query}":`, err.message);
    return null;
  }
}


async function fetchAmazonDealsByCategory() {
  for (const query of categoryQueries) {
    console.log(`🔍 Searching for deals: ${query}`);
    const amazonUrl = await getAmazonDealsUrlFromBing(query);

    if (!amazonUrl) {
      console.error(`❌ Could not find a suitable Amazon link for "${query}"`);
      continue;
    }

    console.log(`🌐 Found deal page for "${query}": ${amazonUrl}`);

    const productLinksSet = new Set();
    let successfulCount = 0;
    const maxProducts = 10;
    const maxPages = 3;

    for (let page = 1; page <= maxPages; page++) {
      if (successfulCount >= maxProducts) break;

      const separator = amazonUrl.includes("?") ? "&" : "?";
      const pageUrl = `${amazonUrl}${separator}page=${page}`;
      console.log(`📝 Fetching page ${page}: ${pageUrl}`);

      try {
        const response = await axios.get(pageUrl, { headers });
        if (response.status !== 200) {
          console.error(`❌ Non-200 status: ${response.status} for ${pageUrl}`);
          break;
        }
        const $ = cheerio.load(response.data);

        const links = [];
        $("a.a-link-normal.s-no-outline").each((_, el) => {
          const href = $(el).attr("href");
          if (href && href.includes("/dp/")) {
            const productUrl = `https://www.amazon.in${href.split("?")[0]}`;
            if (!productLinksSet.has(productUrl)) {
              links.push(productUrl);
            }
          }
        });

        console.log(`🔗 Found ${links.length} product URLs on page ${page}`);

        if (links.length === 0) {
          console.warn(
            `⚠️ No product links found on page ${page}, stopping pagination.`
          );
          break; // No products found, exit pagination loop
        }

        for (const productUrl of links) {
          if (successfulCount >= maxProducts) break;

          try {
            await axios.post(BACKEND_API, { url: productUrl });
            productLinksSet.add(productUrl);
            successfulCount++;
            console.log(`✅ [${successfulCount}] Added: ${productUrl}`);
          } catch (postErr) {
            console.error(
              `❌ Failed POST: ${productUrl}`,
              postErr.response?.data || postErr.message
            );
          }

          await delay(4000); // Delay between POSTs to avoid throttling
        }
      } catch (err) {
        console.error(`❌ Error scraping page ${page}:`, err.message);
        break; // Exit pagination on error
      }

      await delay(4000); // Delay between pages
    }

    console.log(
      `✅ Done with "${query}" — ${successfulCount} products added.\n`
    );
  }

  console.log("🎉 All categories processed.");
}

export default fetchAmazonDealsByCategory;
