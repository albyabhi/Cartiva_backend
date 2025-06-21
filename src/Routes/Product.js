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

function parsePrice(priceStr) {
  if (!priceStr) return NaN;
  
  const cleaned = priceStr
    .replace(/[^\d.,]/g, '')
    .replace(/,(\d{3})/g, '$1') // Handle thousands separators
    .replace(',', '.'); // Handle European decimal commas
  
  return parseFloat(cleaned);
}

router.post("/add-product", async (req, res) => {
  const { url } = req.body;

  if (!url || !/https?:\/\/(www\.)?amazon\.[a-z.]+\//i.test(url)) {
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

    // --------- TITLE EXTRACTION ---------
    let title = "";
    const titleSelectors = [
      "#productTitle",
      "#title",
      "h1#title",
      "span#productTitle",
      "meta[property='og:title']",
      "meta[name='title']",
      "title"
    ];

    for (const selector of titleSelectors) {
      const element = $(selector).first();
      if (element.length) {
        title = element.text().trim() || element.attr("content") || "";
        if (title) {
          // Clean up title from Amazon additions
          title = title.replace(/(Amazon\.(com|co\.uk|ca|de|fr|it|es|jp|in)| : |\s+-\s+Amazon\.).*/gi, "").trim();
          break;
        }
      }
    }

    // Fallback to JSON-LD for title
    if (!title) {
      const jsonLd = $('script[type="application/ld+json"]').html();
      if (jsonLd) {
        try {
          const parsedData = JSON.parse(jsonLd.replace(/\\/g, ''));
          const productData = Array.isArray(parsedData) ? 
            parsedData.find(item => item["@type"] === "Product") : 
            parsedData;
          
          if (productData && productData.name) {
            title = productData.name.trim();
          }
        } catch (e) {
          console.log("JSON-LD parse error:", e.message);
        }
      }
    }

    if (!title) {
      return res.status(400).json({ error: "❌ Could not extract product title" });
    }

    // --------- PRICE EXTRACTION ---------
    let price = null;
    let originalPrice = null;

    // Priority 1: Price block selectors
    const priceBlockSelectors = [
      'span.a-price[data-a-size="xl"] span.a-offscreen',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      '#priceblock_saleprice',
      '.a-price .a-offscreen',
      '.priceToPay span.a-offscreen',
      'span.aok-offscreen'
    ];

    for (const selector of priceBlockSelectors) {
      const priceElement = $(selector).first();
      if (priceElement.length) {
        const priceText = priceElement.text().trim();
        price = parsePrice(priceText);
        if (!isNaN(price)) break;
      }
    }

    // Priority 2: JSON-LD data
    if (isNaN(price)) {
      try {
        const jsonLd = $('script[type="application/ld+json"]').html();
        if (jsonLd) {
          const parsedData = JSON.parse(jsonLd.replace(/\\/g, ''));
          const productData = Array.isArray(parsedData) ? 
            parsedData.find(item => item["@type"] === "Product") : 
            parsedData;
          
          if (productData) {
            // Handle different offer structures
            const offers = productData.offers;
            if (offers) {
              if (Array.isArray(offers)) {
                price = parsePrice(offers[0]?.price);
              } else if (typeof offers === 'object') {
                price = parsePrice(offers.price);
              }
            }
          }
        }
      } catch (e) {
        console.log("JSON-LD price parse error:", e.message);
      }
    }

    // Priority 3: Data attributes
    if (isNaN(price)) {
      const priceData = $('#corePriceDisplay_desktop_feature_div').data();
      if (priceData && priceData.priceAmount) {
        price = parseFloat(priceData.priceAmount);
      }
    }

    if (isNaN(price)) {
      return res.status(400).json({ error: "❌ Could not extract product price" });
    }

    // --------- ORIGINAL PRICE EXTRACTION ---------
    const originalPriceSelectors = [
      '.basisPrice .a-text-price span',
      '.a-price.a-text-price span.a-offscreen',
      '#listPrice',
      '#priceblock_saleprice_row',
      '.a-text-price[data-a-strike="true"]',
      '.a-price.a-text-price .a-offscreen'
    ];

    for (const selector of originalPriceSelectors) {
      const originalPriceElement = $(selector).first();
      if (originalPriceElement.length) {
        const originalPriceText = originalPriceElement.text().trim();
        originalPrice = parsePrice(originalPriceText);
        if (!isNaN(originalPrice)) break;
      }
    }

    // Calculate discount if we have both prices
    let discount = 0;
    if (!isNaN(originalPrice) && originalPrice > price) {
      discount = Math.round(((originalPrice - price) / originalPrice) * 100);
    }

    // --------- IMAGE EXTRACTION ---------
    const imageSelectors = [
      '#landingImage',
      '#imgTagWrapperId img',
      '#main-image-container img',
      '#imageBlock img',
      'div.image-wrapper img',
      'img[data-old-hires]',
      'img[data-a-image-name="landingImage"]'
    ];

    let image = "";
    for (const selector of imageSelectors) {
      const imgElement = $(selector).first();
      if (imgElement.length) {
        image = imgElement.attr('data-old-hires') || 
                imgElement.attr('src') || 
                imgElement.attr('data-src') ||
                "";
        if (image) break;
      }
    }

    // Fallback to meta image
    if (!image) {
      image = $('meta[property="og:image"]').attr('content') || "";
    }

    // --------- RATING EXTRACTION ---------
    let rating = null;
    let reviewCount = 0;

    const ratingElement = $("i.a-icon-star span.a-icon-alt").first();
    const ratingText = ratingElement.text().trim();
    if (ratingText) {
      rating = parseFloat(ratingText.split(" ")[0]);
    }

    const reviewCountText = $("#acrCustomerReviewText").text().trim();
    if (reviewCountText) {
      reviewCount = parseInt(reviewCountText.replace(/\D/g, "")) || 0;
    }

    // --------- CATEGORY EXTRACTION ---------
    let category = "Unknown";
    const categorySelectors = [
      '#wayfinding-breadcrumbs_container ul li:last-child span a',
      '#nav-subnav .nav-a-content',
      '#nav-breadcrumb a',
      '.a-breadcrumb li:last-child a'
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
    $("#feature-bullets li:not(.aok-hidden)").each((i, el) => {
      const text = $(el).text().trim();
      if (text) features.push(text);
    });

    // Fallback to technical details
    if (features.length === 0) {
      $("#prodDetails .a-spacing-small").each((i, el) => {
        const text = $(el).text().trim();
        if (text) features.push(text);
      });
    }

    // --------- DESCRIPTION EXTRACTION ---------
    let description = $("#productDescription").text().trim() ||
                     $("#feature-bullets").text().trim().substring(0, 500) ||
                     "";

    // Fallback to meta description
    if (!description) {
      description = $('meta[name="description"]').attr('content') || "";
    }

    // --------- ASIN EXTRACTION ---------
    const asin = $("#ASIN").val() || 
                 new URL(url).pathname.split("/dp/")[1]?.split("/")[0] || 
                 "";

    // --------- PRODUCT DATA ASSEMBLY ---------
    const product = {
      title,
      price,
      originalPrice: !isNaN(originalPrice) && originalPrice > price ? originalPrice : null,
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
            { 
              $set: { 
                price, 
                originalPrice: !isNaN(originalPrice) ? originalPrice : null, 
                discount 
              }, 
              $push: { priceHistory: existingProduct.price } 
            },
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
