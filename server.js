const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;
// Import routes
const liveScoresRoute = require("./routes/liveScores");
const t20WorldCupRoute = require("./routes/t20Worldcup");
const studentRoute = require("./routes/students");
const ScheduleRoute = require("./routes/schedule");

// Use routes with logging middleware
app.use(
  "/api/live-scores",
  (req, res, next) => {
    console.log("Live scores route hit");
    next();
  },
  liveScoresRoute
);
app.use(
  "/api/schedule",
  (req, res, next) => {
    console.log("Live scores route hit");
    next();
  },
  ScheduleRoute
);
app.use(
  "/api/t20-world-cup-2024",
  (req, res, next) => {
    console.log("T20 World Cup route hit");
    next();
  },
  t20WorldCupRoute
);
app.use(
  "/api/students",
  (req, res, next) => {
    console.log("Students hit");
    next();
  },
  studentRoute
);
// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

module.exports = app;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
