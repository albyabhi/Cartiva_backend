import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import connectDB from "./src/config/db.js";

import Product from "./src/Routes/Product.js";
import TriggerRoutes from "./src/Routes/TriggerRoute.js"

dotenv.config();
connectDB();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/product", Product);
app.use("/", TriggerRoutes);

// Remove all cron-related code and the IIFE

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});