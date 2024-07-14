const express = require("express");
const path = require("path");
const setupMiddleware = require("./component/middleware");

const liveScoresRoute = require("./routes/Cricket/liveScores");
const t20WorldCupRoute = require("./routes/Cricket/t20Worldcup");
const scheduleRoute = require("./routes/Cricket/schedule");
const espnRoute = require("./routes/Cricket/espn");
const sendLiveScore = require("./routes/sendLiveScore");
const send3dContactInfo = require("./routes/hanldeFrontend/SendContactWA");
const {
  createWebhookHandler,
} = require("./component/telegram/telegramWebhook"); // Import webhook handler

const app = express();
const PORT = process.env.PORT || 5000;

// Set trust proxy to 1 to trust the first proxy (like Vercel)
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
app.use("/api/test", sendLiveScore);
app.use("/api/contact", send3dContactInfo);

// Use the webhook handler
app.use(createWebhookHandler());

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error stack:", err.stack);
  console.error("Request body:", req.body);
  res.status(500).send("Something broke!");
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
