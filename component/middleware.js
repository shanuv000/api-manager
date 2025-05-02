// middleware.js
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const express = require("express");
const path = require("path");

// List of allowed origins for CORS
const allowedOrigins = [
  "https://onlyblog.vercel.app",
  "http://localhost:3000",
  "http://localhost:4000",
  "http://localhost:5000",
  "http://localhost:5001",
  "http://localhost:5002",
  "https://vaibhav.vercel.app",
  "https://urtechy.com",
  "https://*.urtechy.com",
  "https://blog.urtechy.com/",
];

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // Allow requests with no origin (like mobile apps or curl requests)
    if (allowedOrigins.includes(origin)) {
      callback(null, true); // Check if the request origin is in the allowed origins list
    } else {
      callback(new Error("Not allowed by CORS"));
    }
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
  app.use(cors(corsOptions));
  app.use(express.json());
  app.use(helmet());
  app.use(limiter);
  app.use(express.static(path.join(__dirname, "public")));
};

module.exports = setupMiddleware;
