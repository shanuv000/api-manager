const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();

// Set trust proxy to 1 to trust the first proxy (like Vercel)
app.set("trust proxy", 1);

// List of allowed origins for CORS
const allowedOrigins = [
  "https://onlyblog.vercel.app",
  "http://localhost:3000",
  "http://localhost:4000",
];

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // Check if the request origin is in the allowed origins list
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  preflightContinue: false,
  optionsSuccessStatus: 204, // Set the status code for successful OPTIONS requests
};

// Apply CORS middleware with the specified options
app.use(cors(corsOptions));

// Middleware to parse JSON bodies
app.use(express.json());

// Helmet middleware to set various HTTP headers for security
app.use(helmet());

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Limit each IP to 10 requests per windowMs
  message: "Too many requests from this IP, please try again after a minute", // Custom message for rate limiting
});
app.use(limiter);

const PORT = process.env.PORT || 5000;

// Import routes
const liveScoresRoute = require("./routes/Cricket/liveScores");
const recentMatchesRoute = require("./routes/Cricket/recentMatches");
const upcomingMatchRoute = require("./routes/Cricket/upcomingMatches");
const t20WorldCupRoute = require("./routes/Cricket/t20Worldcup");
const studentRoute = require("./routes/students");
const ScheduleRoute = require("./routes/Cricket/schedule");
const FlipkartRoute = require("./routes/ecommerce/flipkart");
const EspnRoute = require("./routes/Cricket/espn");

// Use routes
app.use("/api/cricket", liveScoresRoute);
app.use("/api/cricket", recentMatchesRoute);
app.use("/api/cricket", upcomingMatchRoute);
app.use("/api/cricket", ScheduleRoute);
app.use("/api/cricket", t20WorldCupRoute);
app.use("/api/cricket", EspnRoute);
app.use("/api/buy", FlipkartRoute);
app.use("/api/students", studentRoute);

// Error handling middleware
app.use((err, req, res, next) => {
  // Log the error stack trace
  console.error("Error stack:", err.stack);
  // Log the request that caused the error
  console.error("Request body:", req.body);
  // Respond with a 500 status code and a generic message
  res.status(500).send("Something broke!");
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
