import express from "express";
const router = express.Router();
import axios from "axios";

import * as cheerio from "cheerio";
import Product from "../Schemas/Product.js";

const AFFILIATE_TAG = "cartiva-21";

// Generate affiliate link with proper domain handling
function generateAffiliateLink(originalUrl) {
  try {
    const url = new URL(originalUrl);
    if (!url.hostname.includes("amazon.")) {
      throw new Error("Invalid domain");
    }

    if (url.searchParams.has("tag")) {
      url.searchParams.set("tag", AFFILIATE_TAG);
    } else {
      const domainParts = url.hostname.split(".");
      const tld = domainParts[domainParts.length - 1];
      url.searchParams.append("tag", `${AFFILIATE_TAG}-${tld}`);
    }

    return url.toString();
  } catch (error) {
    console.error("Affiliate link generation failed:", error);
    return originalUrl;
  }
}

// Request headers to mimic browser
const AMAZON_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  Referer: "https://www.google.com/",
  Connection: "keep-alive",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

// Robust price parsing
function parsePrice(priceStr) {
  if (!priceStr) return NaN;

  const cleaned = priceStr
    .replace(/[^\d.,-]/g, "")
    .replace(/,(\d{3})/g, "$1")
    .replace(",", ".");

  const price = parseFloat(cleaned);
  return isNaN(price) ? null : price;
}

// Comprehensive title extraction
function extractTitle($) {
  // Priority 1: Direct title selectors
  const titleSelectors = [
    "#productTitle",
    "#title",
    "h1#title",
    "span#productTitle",
    "h1.a-size-large",
    ".product-title-word-break",
    "h1.a-text-normal",
    "#ebooksProductTitle",
    "#gc-title",
  ];

  for (const selector of titleSelectors) {
    const element = $(selector).first();
    if (element.length) {
      const titleText = element.text().trim();
      if (titleText) return cleanTitle(titleText);
    }
  }

  // Priority 2: Meta tags
  const metaSelectors = [
    'meta[property="og:title"]',
    'meta[name="title"]',
    'meta[name="twitter:title"]',
    'meta[itemprop="name"]',
  ];

  for (const selector of metaSelectors) {
    const content = $(selector).attr("content");
    if (content) return cleanTitle(content);
  }

  // Priority 3: JSON-LD data
  const jsonLdScripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < jsonLdScripts.length; i++) {
    try {
      const scriptContent = $(jsonLdScripts[i]).html();
      const parsedData = JSON.parse(scriptContent.replace(/\\/g, ""));

      if (Array.isArray(parsedData)) {
        for (const item of parsedData) {
          if (
            (item["@type"] === "Product" ||
              item["@type"]?.includes("Product")) &&
            item.name
          ) {
            return cleanTitle(item.name);
          }
          if (item.title) return cleanTitle(item.title);
        }
      } else {
        if (
          (parsedData["@type"] === "Product" ||
            parsedData["@type"]?.includes("Product")) &&
          parsedData.name
        ) {
          return cleanTitle(parsedData.name);
        }
        if (parsedData.title) return cleanTitle(parsedData.title);
      }
    } catch (e) {
      console.log("JSON-LD parse error:", e.message);
    }
  }

  // Priority 4: Page title cleanup
  const pageTitle = $("title").text().trim();
  if (pageTitle) {
    const cleaned = cleanTitle(pageTitle);
    if (cleaned && !cleaned.toLowerCase().includes("page not found")) {
      return cleaned;
    }
  }

  return null;
}

// Advanced title cleaning
function cleanTitle(title) {
  if (!title) return null;

  return title
    .replace(
      /(Amazon\.(com|co\.uk|ca|de|fr|it|es|jp|in|com\.br|com\.mx|ae|sa|se|nl|com\.tr)| : |\s+-\s+Amazon\.).*/gi,
      ""
    )
    .replace(/\[[^\]]*\]|\([^)]*\)/g, "")
    .replace(/\b(?:Brand:|by\s+\w+|Visit\s+the\s+\w+\s+Store)\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Main product scraping endpoint
router.post("/add-product", async (req, res) => {
  const { url } = req.body;

  if (!url || !/https?:\/\/(www\.)?amazon\.[a-z.]+\//i.test(url)) {
    return res.status(400).json({ error: "❌ Invalid or non-Amazon URL" });
  }

  try {
    const response = await axios.get(url, {
      headers: AMAZON_HEADERS,
      timeout: 10000,
    });

    if (response.status !== 200) {
      return res.status(response.status).json({
        error: `❌ Amazon returned status ${response.status}`,
      });
    }

    const $ = cheerio.load(response.data);

    // Check for CAPTCHA or blocked access
    if (
      $("title").text().includes("Robot Check") ||
      $("#captchacharacters").length > 0 ||
      $("body").text().includes("Enter the characters you see below")
    ) {
      return res.status(403).json({
        error: "❌ Amazon blocked request (CAPTCHA required)",
      });
    }

    // --------- TITLE EXTRACTION ---------
    const title = extractTitle($);
    if (!title) {
      return res
        .status(400)
        .json({ error: "❌ Could not extract product title" });
    }

    // --------- PRICE EXTRACTION ---------
    let price = null;
    let originalPrice = null;

    // Price extraction strategies
    const priceSelectors = [
      'span.a-price[data-a-size="xl"] span.a-offscreen',
      ".priceToPay span.a-offscreen",
      "#priceblock_ourprice",
      "#priceblock_dealprice",
      "#priceblock_saleprice",
      ".a-price .a-offscreen",
      "span.aok-offscreen",
      '[data-a-color="price"] span',
      '.a-price[data-a-size="xl"] span',
    ];

    for (const selector of priceSelectors) {
      const priceElement = $(selector).first();
      if (priceElement.length) {
        const priceText = priceElement.text().trim();
        price = parsePrice(priceText);
        if (price) break;
      }
    }

    // Fallback to JSON-LD data
    if (!price) {
      const jsonLd = $('script[type="application/ld+json"]').html();
      if (jsonLd) {
        try {
          const parsedData = JSON.parse(jsonLd.replace(/\\/g, ""));
          const productData = Array.isArray(parsedData)
            ? parsedData.find((item) => item["@type"] === "Product")
            : parsedData;

          if (productData?.offers) {
            if (Array.isArray(productData.offers)) {
              price = parsePrice(productData.offers[0]?.price);
            } else {
              price = parsePrice(productData.offers.price);
            }
          }
        } catch (e) {
          console.log("JSON-LD price parse error:", e.message);
        }
      }
    }

    // Final fallback to data attributes
    if (!price) {
      const priceData = $("#corePriceDisplay_desktop_feature_div").data();
      if (priceData?.priceAmount) {
        price = parseFloat(priceData.priceAmount);
      }
    }

    if (!price) {
      return res
        .status(400)
        .json({ error: "❌ Could not extract product price" });
    }

    // --------- ORIGINAL PRICE EXTRACTION ---------
    const originalPriceSelectors = [
      ".basisPrice .a-text-price span",
      ".a-price.a-text-price span.a-offscreen",
      "#listPrice",
      "#priceblock_saleprice_row",
      '.a-text-price[data-a-strike="true"]',
      ".a-price.a-text-price .a-offscreen",
      ".wasPrice",
    ];

    for (const selector of originalPriceSelectors) {
      const originalPriceElement = $(selector).first();
      if (originalPriceElement.length) {
        const originalPriceText = originalPriceElement.text().trim();
        originalPrice = parsePrice(originalPriceText);
        if (originalPrice) break;
      }
    }

    // Calculate discount
    let discount = 0;
    if (originalPrice && originalPrice > price) {
      discount = Math.round(((originalPrice - price) / originalPrice) * 100);
    }

    // --------- IMAGE EXTRACTION ---------
    const imageSelectors = [
      "#landingImage",
      "#imgTagWrapperId img",
      "#main-image-container img",
      "#imageBlock img",
      "div.image-wrapper img",
      "img[data-old-hires]",
      'img[data-a-image-name="landingImage"]',
      "img[data-a-dynamic-image]",
    ];

    let image = "";
    for (const selector of imageSelectors) {
      const imgElement = $(selector).first();
      if (imgElement.length) {
        image =
          imgElement.attr("data-old-hires") ||
          imgElement.attr("src") ||
          imgElement.attr("data-src") ||
          imgElement.attr("data-a-dynamic-image")?.match(/"([^"]+)"/)?.[1] ||
          "";
        if (image) break;
      }
    }

    // Fallback to meta image
    if (!image) {
      image = $('meta[property="og:image"]').attr("content") || "";
    }

    // --------- RATING EXTRACTION ---------
    let rating = null;
    let reviewCount = 0;

    const ratingElement = $(
      "i.a-icon-star span.a-icon-alt, .reviewCountTextLinkedHistogram"
    ).first();
    const ratingText = ratingElement.text().trim();
    if (ratingText) {
      const ratingMatch = ratingText.match(/(\d+\.?\d*)/);
      if (ratingMatch) {
        rating = parseFloat(ratingMatch[1]);
      }
    }

    const reviewCountText = $("#acrCustomerReviewText, #acrCustomerReviewLink")
      .text()
      .trim();
    if (reviewCountText) {
      reviewCount = parseInt(reviewCountText.replace(/\D/g, "")) || 0;
    }

    // --------- CATEGORY EXTRACTION ---------
    let category = "Unknown";
    const categorySelectors = [
      "#wayfinding-breadcrumbs_container ul li:last-child span a",
      "#nav-subnav .nav-a-content",
      "#nav-breadcrumb a",
      ".a-breadcrumb li:last-child a",
      "#dp-title-widget-ays-title",
    ];

    for (const selector of categorySelectors) {
      const categoryElement = $(selector).first();
      if (categoryElement.length) {
        category = categoryElement.text().trim();
        if (category) break;
      }
    }

    // --------- FEATURES EXTRACTION ---------
    const features = [];
    $(
      "#feature-bullets li:not(.aok-hidden), #detailBullets_feature_div li"
    ).each((i, el) => {
      const text = $(el).text().trim();
      if (text) features.push(text);
    });

    // Fallback to technical details
    if (features.length === 0) {
      $("#prodDetails .a-spacing-small, .product-facts-detail").each(
        (i, el) => {
          const text = $(el).text().trim();
          if (text) features.push(text);
        }
      );
    }

    // --------- DESCRIPTION EXTRACTION ---------
    let description =
      $("#productDescription").text().trim() ||
      $("#feature-bullets").text().trim().substring(0, 500) ||
      $(".productDescriptionWrapper").text().trim().substring(0, 500) ||
      "";

    // Fallback to meta description
    if (!description) {
      description = $('meta[name="description"]').attr("content") || "";
    }

    // --------- ASIN EXTRACTION ---------
    let asin =
      $("#ASIN").val() ||
      new URL(url).pathname.split("/dp/")[1]?.split("/")[0] ||
      "";

    // Additional ASIN extraction methods
    if (!asin) {
      const asinElement = $('input[name="ASIN"], input[name="asin"]');
      if (asinElement.length) {
        asin = asinElement.val();
      }
    }

    // --------- PRODUCT DATA ASSEMBLY ---------
    const product = {
      title,
      price,
      originalPrice:
        originalPrice && originalPrice > price ? originalPrice : null,
      discount,
      image,
      rating,
      reviewCount,
      features: features.length > 0 ? features : ["No features listed"],
      description: description || "No description available",
      category,
      asin,
      source: "Amazon",
      addedAt: new Date(),
      url,
      affiliateLink: generateAffiliateLink(url),
    };

    // --------- DATABASE OPERATIONS ---------
    // Check for existing products by ASIN or title
    const existingProduct = await Product.findOne({
      $or: [{ asin }, { title }],
    });

    if (existingProduct) {
      const priceChanged = existingProduct.price !== price;
      const updatedProduct = priceChanged
        ? await Product.findByIdAndUpdate(
            existingProduct._id,
            {
              $set: {
                price,
                originalPrice:
                  originalPrice && originalPrice > price ? originalPrice : null,
                discount,
              },
              $push: { priceHistory: existingProduct.price },
            },
            { new: true }
          )
        : existingProduct;

      return res.status(200).json({
        message: priceChanged
          ? "🔄 Product price updated"
          : "ℹ️ Product already exists",
        data: updatedProduct,
      });
    }

    // Add price history for new products
    const newProductData = {
      ...product,
      priceHistory: [price],
    };

    const savedProduct = await Product.create(newProductData);
    res.status(201).json({
      message: "✅ Product saved successfully",
      data: savedProduct,
    });
  } catch (error) {
    console.error("❌ Scraping Error:", error.message);

    let status = 500;
    let message = "Scraping failed";

    if (error.response) {
      status = error.response.status;
      message = `Amazon returned ${status}`;
    } else if (error.code === "ECONNABORTED") {
      status = 408;
      message = "Request timed out";
    } else if (error.message.includes("URL")) {
      status = 400;
      message = error.message;
    }

    res.status(status).json({
      error: `❌ ${message}`,
      details: error.message,
    });
  }
});

router.get("/products", async (req, res) => {
  try {
    const products = await Product.find().sort({ addedAt: -1 }); // latest first
    res
      .status(200)
      .json({ message: "✅ Products fetched successfully", data: products });
  } catch (error) {
    console.error("❌ Error fetching products:", error.message);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

router.delete("/delete-product/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const deletedProduct = await Product.findByIdAndDelete(id);

    if (!deletedProduct) {
      return res.status(404).json({ error: "❌ Product not found" });
    }

    console.log(
      "\n🗑️ Product deleted:\n",
      JSON.stringify(deletedProduct, null, 2)
    );

    res.status(200).json({
      message: "✅ Product deleted successfully",
      data: deletedProduct,
    });
  } catch (error) {
    console.error("❌ Error deleting product:", error.message);
    res.status(500).json({ error: "Failed to delete product" });
  }
});

export default router;
