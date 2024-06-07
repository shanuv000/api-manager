const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json()); // Add this line

const PORT = process.env.PORT || 5000;

// Import routes
const liveScoresRoute = require("./routes/liveScores");
const t20WorldCupRoute = require("./routes/t20Worldcup");
const studentRoute = require("./routes/students");
const ScheduleRoute = require("./routes/schedule");

// Use routes
app.use("/api/cricket", liveScoresRoute);
app.use("/api/cricket", ScheduleRoute);
app.use("/api/cricket", t20WorldCupRoute);
app.use("/api/students", studentRoute);

// Error handling middleware
app.use((err, req, res) => {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app; // Move this to the end
