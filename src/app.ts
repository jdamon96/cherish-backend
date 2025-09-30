import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { SupabaseClient } from "@supabase/supabase-js";
import { validateEnvironment } from "./types/env";
import { createSupabaseClient, Database } from "./config/supabase";
import { summarizeAnecdoteRoutes } from "./routes/summarize-anecdote";
import { parseGiftRoutes } from "./routes/parse-gift";
import { giftRecsRoutes } from "./routes/gift-recs";

// Load environment variables
require("dotenv").config();

const env = validateEnvironment();
const supabase: SupabaseClient<Database> = createSupabaseClient(env);

// Create Express app
const app = express();

// Security middleware
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin:
      process.env.NODE_ENV === "production"
        ? ["https://your-frontend-domain.com"] // Replace with your actual frontend domain
        : true,
    credentials: true,
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
  });
});

// API routes
app.use("/api/summarize-anecdote", summarizeAnecdoteRoutes(supabase));
app.use("/api/parse-gift-image", parseGiftRoutes(supabase));
app.use("/api/get-gift-recs", giftRecsRoutes(supabase));

// Error handling middleware
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error("Error:", err);

    if (err.name === "ValidationError") {
      return res.status(400).json({
        error: "Validation Error",
        message: err.message,
      });
    }

    if (err.name === "UnauthorizedError") {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Invalid credentials",
      });
    }

    return res.status(500).json({
      error: "Internal Server Error",
      message:
        process.env.NODE_ENV === "development"
          ? err.message
          : "Something went wrong",
    });
  }
);

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    error: "Not Found",
    message: `Route ${req.originalUrl} not found`,
  });
});

export { app, env };
