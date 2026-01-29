const express = require("express");
const path = require("path");
const setupMiddleware = require("./component/middleware");


// Consolidated Cricket Routes
const cricketRoutes = require("./routes/Cricket/index");

// Other routes (commented out to reduce function count for Vercel)
// const t20WorldCupRoute = require("./routes/Cricket/t20Worldcup");
// const scheduleRoute = require("./routes/Cricket/schedule");
// const espnRoute = require("./routes/Cricket/espn");

const app = express();
const PORT = process.env.PORT || 5003;

// Set trust proxy to trust the first proxy (like Vercel)
app.set("trust proxy", 1);

// Apply middleware
setupMiddleware(app);

// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Consolidated Cricket API routes
app.use("/api/cricket", cricketRoutes);

// Other routes (commented out to reduce function count for Vercel)
// app.use("/api/cricket", scheduleRoute);
// app.use("/api/cricket", t20WorldCupRoute);
// app.use("/api/cricket", espnRoute);



// Fallback route for undefined endpoints
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error stack:", err.stack);
  console.error("Request body:", req.body);
  res.status(500).json({ error: "Internal server error" });
});

// Start the server
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown handling
const gracefulShutdown = (signal) => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(() => {
    console.log('HTTP server closed.');

    // Close database connections if any
    // Add your cleanup code here (e.g., Redis, database connections)

    console.log('Graceful shutdown completed.');
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10000);
};

// Listen for termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});

module.exports = app;
