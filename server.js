const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const app = express();
const allowedOrigins = [
  "https://onlyblog.vercel.app",
  // "https://your-frontend-domain2.com",
];

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  preflightContinue: false,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.use(express.json()); // Middleware to parse JSON bodies
app.use(helmet()); // Helmet for security headers

const PORT = process.env.PORT || 5000;

// Import routes
const liveScoresRoute = require("./routes/Cricket/liveScores");
const t20WorldCupRoute = require("./routes/Cricket/t20Worldcup");
const studentRoute = require("./routes/students");
const ScheduleRoute = require("./routes/Cricket/schedule");
const FlipkartRoute = require("./routes/ecommerce/flipkart");

// Use routes
app.use("/api/cricket", liveScoresRoute);
app.use("/api/cricket", ScheduleRoute);
app.use("/api/cricket", t20WorldCupRoute);
app.use("/api/buy", FlipkartRoute);
app.use("/api/students", studentRoute);

// Error handling middleware
app.use((err, req, res, next) => {
  // Added 'next' parameter
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app; // Move this to the end
