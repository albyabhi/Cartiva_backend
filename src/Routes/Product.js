import express from "express";
const router = express.Router();
import axios from "axios";

import * as cheerio from "cheerio";
import Product from "../Schemas/Product.js";

const AFFILIATE_TAG = "cartiva-21";

function generateAffiliateLink(originalUrl) {
  const url = new URL(originalUrl);
  url.searchParams.set("tag", AFFILIATE_TAG);
  return url.toString();
}

router.post("/add-product", async (req, res) => {
  const { url } = req.body;

  if (!url || !url.includes("amazon")) {
    return res.status(400).json({ error: "❌ Invalid or missing Amazon URL" });
  }

  try {
    const response = await axios.get(url, {
      headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
    Referer: "https://www.amazon.in/",
    Connection: "keep-alive",
  },
    });

    const $ = cheerio.load(response.data);

    const title = $("#productTitle").text().trim();
    let priceStr =
  $("#priceblock_dealprice").text().trim() ||
  $("#priceblock_ourprice").text().trim() ||
  $("#priceblock_saleprice").text().trim() ||
  $(".a-price .a-offscreen").first().text().trim() ||
  (() => {
    const whole = $(".a-price-whole").first().text().trim().replace(/[,]/g, "");
    const fraction = $(".a-price-fraction").first().text().trim() || "00";
    return whole ? `${whole}.${fraction}` : null;
  })() ||
  $("[data-asin-price]").attr("data-asin-price") ||
  $('[data-a-size="l"]').text().trim();



    const originalStr =
      $(".priceBlockStrikePriceString").text().trim() || priceStr;

    const price = Math.round(parseFloat(priceStr.replace(/[₹,]/g, "")));
    let originalPrice = Math.round(
      parseFloat(originalStr.replace(/[₹,]/g, ""))
    );

    // ✅ Validate price
    if (!price || isNaN(price)) {
      return res
        .status(400)
        .json({ error: "❌ Unable to extract valid product price" });
    }

    // ✅ Handle missing or meaningless originalPrice
    if (isNaN(originalPrice) || originalPrice === 0 || originalPrice <= price) {
      originalPrice = null;
    }

    const discount = originalPrice
      ? Math.round(((originalPrice - price) / originalPrice) * 100)
      : 0;

    const image =
      $("#landingImage").attr("src") ||
      $("#imgTagWrapperId img").attr("data-old-hires") ||
      $("#imgTagWrapperId img").attr("src");

    const ratingStr = $(".a-icon-alt").first().text().trim();
    const rating = parseFloat(ratingStr.split(" ")[0]) || null;

    const product = {
      title,
      price,
      originalPrice,
      discount,
      image,
      rating,
    };

    // ✅ Check for duplicates
    const existingProduct = await Product.findOne({ title: product.title });

    if (existingProduct && existingProduct.price === product.price) {
      return res.status(200).json({
        message:
          "⚠️ Product already exists with the same price. Skipping save.",
      });
    }

    const result = {
      ...product,
      url,
      affiliateLink: generateAffiliateLink(url),
      source: "Amazon",
      category: "Unknown",
      addedAt: new Date(),
    };

    const savedProduct = await Product.create(result);

    console.log(
      "\n✅ Product saved to DB:\n",
      JSON.stringify(savedProduct, null, 2)
    );
    res
      .status(200)
      .json({ message: "✅ Product scraped and saved", data: savedProduct });
  } catch (error) {
    console.error("❌ Scraping error:", error.message);
    res.status(500).json({ error: "Failed to scrape and save product" });
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
