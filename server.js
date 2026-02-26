const express = require("express");
const path = require("path");
const setupMiddleware = require("./component/middleware");


// Consolidated Cricket Routes
const cricketRoutes = require("./routes/Cricket/index");

// Other routes (unused legacy endpoints)
// const t20WorldCupRoute = require("./routes/Cricket/t20Worldcup");
// const scheduleRoute = require("./routes/Cricket/schedule");
// const espnRoute = require("./routes/Cricket/espn");

const app = express();
const PORT = process.env.PORT || 5003;

// Trust the first proxy (Nginx) for correct client IP in rate limiting
app.set("trust proxy", 1);

// Apply middleware
setupMiddleware(app);

// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Consolidated Cricket API routes
app.use("/api/cricket", cricketRoutes);

// Other routes (unused legacy endpoints)
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
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`Server running on port ${PORT} at 127.0.0.1`);
});

// Graceful shutdown handling
const gracefulShutdown = async (signal) => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(async () => {
    console.log('HTTP server closed.');

    // Close Redis connections
    try {
      const { redis: getGeneralRedis } = require('./component/redisClient');
      const generalRedis = getGeneralRedis();
      if (generalRedis) await generalRedis.quit();
      console.log('Redis (general) connection closed.');
    } catch (e) { /* ignore — process is exiting */ }

    try {
      const { getClient: getLiveRedis } = require('./utils/redis-client');
      const liveRedis = getLiveRedis();
      if (liveRedis) await liveRedis.quit();
      console.log('Redis (live) connection closed.');
    } catch (e) { /* ignore */ }

    // Close database connections
    try {
      const prisma = require('./component/prismaClient');
      await prisma.$disconnect();
      if (prisma.pool) await prisma.pool.end();
      console.log('Database connections closed.');
    } catch (e) { /* ignore */ }

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
