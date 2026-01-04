// middleware.js
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const express = require("express");
const path = require("path");
const compression = require("compression");

// CORS configuration - Allow all origins
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      "https://urtechy.com",
      "https://blog.urtechy.com",
    ];

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Check for play.urtechy.com and its subdomains
    if (origin === "https://play.urtechy.com" || origin.endsWith(".play.urtechy.com")) {
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
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Limit each IP to 30 requests per windowMs
  message: "Too many requests from this IP, please try again after a minute",
});

// Middleware setup function
const setupMiddleware = (app) => {
  // Compression should be first to compress all responses
  app.use(
    compression({
      filter: (req, res) => {
        // Don't compress if client doesn't accept encoding
        if (req.headers["x-no-compression"]) {
          return false;
        }
        // Use compression for all responses
        return compression.filter(req, res);
      },
      level: 6, // Compression level (0-9, 6 is default and good balance)
    })
  );

  app.use(cors(corsOptions));
  app.use(express.json());
  app.use(helmet());
  app.use(limiter);
  app.use(express.static(path.join(__dirname, "public")));
};

module.exports = setupMiddleware;
