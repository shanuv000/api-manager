// middleware.js
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const express = require("express");
const path = require("path");

// CORS configuration - Allow all origins
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, or server-side fetch)
    if (!origin) return callback(null, true);

    // Check for urtechy.com and its subdomains
    if (origin === "https://urtechy.com" || origin.endsWith(".urtechy.com")) {
      return callback(null, true);
    }

    // Check for localhost
    if (origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1")) {
      return callback(null, true);
    }

    callback(new Error("Not allowed by CORS"));
  },
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  preflightContinue: false,
  optionsSuccessStatus: 204,
};

// Rate limiting middleware
// Uses req.ip which respects trust proxy setting for real client IP
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute per real IP (was 30, but shared across all users behind proxy)
  message: "Too many requests from this IP, please try again after a minute",
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
});

// Middleware setup function
const setupMiddleware = (app) => {
  // NOTE: Compression removed — Nginx handles gzip globally.
  // Running compression here AND in Nginx wastes CPU (double compression).

  app.use(cors(corsOptions));
  app.use(express.json());
  app.use(helmet());
  app.use(limiter);
  app.use(express.static(path.join(__dirname, "public")));
};

module.exports = setupMiddleware;
