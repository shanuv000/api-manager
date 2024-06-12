const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const sendEmail = require("../component/sendEmail"); // Correct import
const { scrapeMatches } = require("./Cricket/liveScores");
const router = express.Router();

// URL of the website you want to scrape
const recenturl =
  "https://www.cricbuzz.com/cricket-match/live-scores/recent-matches";

const liveUrl = "https://www.cricbuzz.com/cricket-match/live-scores";
// API route to fetch live scores and send email
router.get("/", async (req, res) => {
  try {
    const matches = await scrapeMatches(liveUrl);
    // console.log("Matches fetched:", matches); // Logging fetched matches

    const filteredMatches = matches.filter((match) => {
      return match.playingTeamBat === "IND" || match.playingTeamBall === "IND";
    });
    console.log(filteredMatches);

    if (filteredMatches.length > 0) {
      await sendEmail(filteredMatches);
    }

    res.status(200).json({ message: "Email sent successfully" });
  } catch (error) {
    console.error("Error in route handler:", error.message); // Logging errors
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
