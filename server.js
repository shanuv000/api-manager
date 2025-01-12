const express = require("express");
const path = require("path");
const setupMiddleware = require("./component/middleware");
const liveScoresRoute = require("./routes/Cricket/liveScores");
const t20WorldCupRoute = require("./routes/Cricket/t20Worldcup");
const scheduleRoute = require("./routes/Cricket/schedule");
const espnRoute = require("./routes/Cricket/espn");
const sendLiveScore = require("./routes/sendLiveScore");
const send3dContactInfo = require("./routes/hanldeFrontend/SendContactWA");

const app = express();
const PORT = process.env.PORT || 5002;

// Set trust proxy to trust the first proxy (like Vercel)
app.set("trust proxy", 1);

// Apply middleware
setupMiddleware(app);

// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use("/api/cricket/live", liveScoresRoute.router);
app.use("/api/cricket/schedule", scheduleRoute);
app.use("/api/cricket/t20", t20WorldCupRoute);
app.use("/api/cricket/espn", espnRoute);
app.use("/api/test", sendLiveScore);
app.use("/api/contact", send3dContactInfo);

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
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
