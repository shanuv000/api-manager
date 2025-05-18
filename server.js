const express = require("express");
const path = require("path");
const setupMiddleware = require("./component/middleware");
const liveScoresRoute = require("./routes/Cricket/liveScores");

const t20WorldCupRoute = require("./routes/Cricket/t20Worldcup");
const scheduleRoute = require("./routes/Cricket/schedule");
const espnRoute = require("./routes/Cricket/espn");

const send3dContactInfo = require("./routes/hanldeFrontend/SendContactWA");

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

app.use("/api/cricket", liveScoresRoute.router);
app.use("/api/cricket", scheduleRoute);
app.use("/api/cricket", t20WorldCupRoute);
app.use("/api/cricket", espnRoute);
// app.use("/api/send", sendLiveScore);
// app.use("/api/send", sendAllScore);
// app.use("/api/send", sendUpcomingMatches);
// app.use("/api/send", sendRecentMatches);
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
