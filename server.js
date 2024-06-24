const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path"); // Correctly require the path module

const app = express();

// Set trust proxy to 1 to trust the first proxy (like Vercel)
app.set("trust proxy", 1);

// List of allowed origins for CORS
const allowedOrigins = [
  "https://onlyblog.vercel.app",
  "http://localhost:3000",
  "http://localhost:4000",
  "http://localhost:5000",
  "https://vaibhav.vercel.app",
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
  max: 30, // Limit each IP to 30 requests per windowMs
  message: "Too many requests from this IP, please try again after a minute", // Custom message for rate limiting
});
app.use(limiter);

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, "public")));

// Serve the HTML file at the root URL
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 5000;

// Import routes
const liveScoresRoute = require("./routes/Cricket/liveScores");
// const recentMatchesRoute = require("./routes/Cricket/recentMatches");
// const upcomingMatchRoute = require("./routes/Cricket/upcomingMatches");
const t20WorldCupRoute = require("./routes/Cricket/t20Worldcup");
// const studentRoute = require("./routes/students");
const scheduleRoute = require("./routes/Cricket/schedule");
// const scheduleRoute2 = require("./routes/Cricket/schedulev2");
// const flipkartRoute = require("./routes/ecommerce/flipkart");
const espnRoute = require("./routes/Cricket/espn");
const sendLiveScore = require("./routes/sendLiveScore");
// const test2Route = require("./routes/test2");
const send3dContactInfo = require("./routes/hanldeFrontend/SendContactWA");
// Use routes
app.use("/api/cricket", liveScoresRoute.router);
// app.use("/api/cricket", recentMatchesRoute);
// app.use("/api/cricket", upcomingMatchRoute);
app.use("/api/cricket", scheduleRoute);
// app.use("/api/cricket", scheduleRoute2);
app.use("/api/cricket", t20WorldCupRoute);
app.use("/api/cricket", espnRoute);
// app.use("/api/buy", flipkartRoute);
// app.use("/api/students", studentRoute);
app.use("/api/test", sendLiveScore);
app.use("/api/contact", send3dContactInfo);
// app.use("/api/test2", test2Route);

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
