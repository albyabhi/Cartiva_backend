import express from "express";
const router = express.Router();
import axios from "axios";

import * as cheerio from "cheerio";
import Product from "../Schemas/Product.js";

const AFFILIATE_TAG = "cartiva-21";

// Improved URL validation with domain detection
function generateAffiliateLink(originalUrl) {
  try {
    const url = new URL(originalUrl);
    if (!url.hostname.includes('amazon.')) {
      throw new Error('Invalid domain');
    }
    
    // Handle different Amazon domain structures
    if (url.searchParams.has('tag')) {
      url.searchParams.set('tag', AFFILIATE_TAG);
    } else {
      const domainParts = url.hostname.split('.');
      const tld = domainParts[domainParts.length - 1];
      url.searchParams.append('tag', `${AFFILIATE_TAG}-${tld}`);
    }
    
    return url.toString();
  } catch (error) {
    console.error('Affiliate link generation failed:', error);
    return originalUrl;
  }
}

// Centralized headers configuration
const AMAZON_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Referer": "https://www.google.com/",
  "Connection": "keep-alive",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache"
};

router.post("/add-product", async (req, res) => {
  const { url } = req.body;

  if (!url || !/https?:\/\/(www\.)?amazon\.[a-z]{2,3}(\.[a-z]{2})?/.test(url)) {
    return res.status(400).json({ error: "❌ Invalid or non-Amazon URL" });
  }

  try {
    const response = await axios.get(url, {
      headers: AMAZON_HEADERS,
      timeout: 10000,  // 10-second timeout
    });

    if (response.status !== 200) {
      return res.status(response.status).json({ 
        error: `❌ Amazon returned status ${response.status}` 
      });
    }

    const $ = cheerio.load(response.data);

    // Extract critical data first
    const title = $("#productTitle").text().trim() || 
                  $("meta[name='title']").attr("content") || 
                  "";

    // Handle unavailable products
    if ($("#outOfStock").length || 
        /currently unavailable/i.test($("#availability").text())) {
      return res.status(404).json({ error: "❌ Product is unavailable" });
    }

    // --------- PRICE EXTRACTION ---------
    const extractPrice = selector => {
      const text = $(selector).first().text().trim().replace(/[^0-9.,]/g, "");
      return parseFloat(text.replace(/[.,]/g, m => m === ',' ? '' : '.'));
    };

    // Priority order for price extraction
    const priceSelectors = [
      'span.a-price[data-a-size="xl"] span',  // Main price
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      '#priceblock_saleprice',
      '.a-price .a-offscreen',
      '[data-a-color="price"] span'
    ];

    let price = null;
    for (const selector of priceSelectors) {
      price = extractPrice(selector);
      if (!isNaN(price)) break;
    }

    // Fallback to JSON-LD data
    if (isNaN(price)) {
      const jsonData = $('script[type="application/ld+json"]').html();
      if (jsonData) {
        try {
          const productData = JSON.parse(jsonData.replace(/\\/g, ''));
          if (Array.isArray(productData)) {
            const mainProduct = productData.find(item => item["@type"] === "Product");
            if (mainProduct?.offers?.price) {
              price = parseFloat(mainProduct.offers.price);
            }
          } else if (productData.offers?.price) {
            price = parseFloat(productData.offers.price);
          }
        } catch (e) { /* Ignore parse errors */ }
      }
    }

    // --------- ADDITIONAL DATA EXTRACTION ---------
    // Original price
    const originalPrice = extractPrice(".a-price.a-text-price span") || 
                          extractPrice(".basisPrice .a-text-price span");

    // Discount calculation
    const discount = originalPrice && !isNaN(originalPrice) && originalPrice > price
      ? Math.round(((originalPrice - price) / originalPrice) * 100)
      : 0;

    // Image extraction with fallbacks
    const image = $("#landingImage").attr("data-old-hires") ||
                  $("#landingImage").attr("src") ||
                  $("#imgTagWrapperId img").attr("data-old-hires") ||
                  $("#imgTagWrapperId img").attr("src") ||
                  $("div#imageBlock img").attr("src");

    // Rating and review count
    const ratingElement = $("i.a-icon-star span.a-icon-alt").first();
    const ratingText = ratingElement.text().trim();
    const rating = parseFloat(ratingText.split(" ")[0]) || null;
    const reviewCount = parseInt($("#acrCustomerReviewText").text().replace(/\D/g, "")) || 0;

    // Category from breadcrumbs
    const category = $("#wayfinding-breadcrumbs_container ul li:last-child span a")
                      .text().trim() || "Unknown";

    // Key features/bullet points
    const features = [];
    $("#feature-bullets li:not(.aok-hidden)").each((i, el) => {
      const text = $(el).text().trim();
      if (text) features.push(text);
    });

    // Product description
    const description = $("#productDescription").text().trim() ||
                        $("#feature-bullets").text().trim().substring(0, 500) ||
                        "";

    // ASIN extraction
    const asin = $("#ASIN").val() || 
                 new URL(url).pathname.split("/dp/")[1]?.split("/")[0] || 
                 "";

    // --------- PRODUCT DATA ASSEMBLY ---------
    const product = {
      title,
      price,
      originalPrice: originalPrice > price ? originalPrice : null,
      discount,
      image,
      rating,
      reviewCount,
      features,
      description,
      category,
      asin,
      source: "Amazon",
      addedAt: new Date(),
      url,
      affiliateLink: generateAffiliateLink(url)
    };

    // --------- DATABASE OPERATIONS ---------
    // Check for existing products by ASIN or title
    const existingProduct = await Product.findOne({
      $or: [{ asin }, { title }]
    });

    if (existingProduct) {
      const priceChanged = existingProduct.price !== price;
      const updatedProduct = priceChanged 
        ? await Product.findByIdAndUpdate(
            existingProduct._id,
            { $set: { price, originalPrice, discount }, $push: { priceHistory: existingProduct.price } },
            { new: true }
          )
        : existingProduct;

      return res.status(200).json({
        message: priceChanged 
          ? "🔄 Product price updated" 
          : "ℹ️ Product already exists",
        data: updatedProduct
      });
    }

    // Add price history for new products
    const newProductData = {
      ...product,
      priceHistory: [price]
    };

    const savedProduct = await Product.create(newProductData);
    res.status(201).json({ 
      message: "✅ Product saved successfully", 
      data: savedProduct 
    });

  } catch (error) {
    console.error("❌ Scraping Error:", error.message);
    
    const status = error.response?.status || 500;
    const message = error.response 
      ? `Amazon returned ${error.response.status}`
      : "Scraping failed";

    res.status(status).json({ 
      error: `❌ ${message}`, 
      details: error.message 
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
