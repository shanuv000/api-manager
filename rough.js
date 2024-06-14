const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const WebSocket = require("ws");

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

// Apply CORS middleware with the specified options
app.use(cors(corsOptions));

// Middleware to parse JSON bodies
app.use(express.json());

// Helmet middleware to set various HTTP headers for security
app.use(helmet());

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: "Too many requests from this IP, please try again after a minute",
});
app.use(limiter);

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, "public")));

// Serve the HTML file at the root URL
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/client", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "client.html"));
});

const PORT = process.env.PORT || 5000;

// Import routes
const liveScoresRoute = require("./routes/Cricket/liveScores");
const t20WorldCupRoute = require("./routes/Cricket/t20Worldcup");
const studentRoute = require("./routes/students");
const scheduleRoute = require("./routes/Cricket/schedule");
const flipkartRoute = require("./routes/ecommerce/flipkart");
const espnRoute = require("./routes/Cricket/espn");
const testRoute = require("./routes/sendLiveScore");

// Use routes
app.use("/api/cricket", liveScoresRoute.router);
app.use("/api/cricket", scheduleRoute);
app.use("/api/cricket", t20WorldCupRoute);
app.use("/api/cricket", espnRoute);
app.use("/api/buy", flipkartRoute);
app.use("/api/students", studentRoute);
app.use("/api/test", testRoute);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error stack:", err.stack);
  console.error("Request body:", req.body);
  res.status(500).send("Something broke!");
});

// Start the server
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// WebSocket Server setup
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
  console.log("Client connected");

  ws.on("message", (message) => {
    console.log(`Received: ${message}`);
    ws.send("Hello from WebSocket server");
  });

  ws.on("close", () => {
    console.log("Client disconnected");
  });
});
