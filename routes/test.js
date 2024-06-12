const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const sendEmail = require("../component/sendEmail"); // Correct import

const router = express.Router();

// URL of the website you want to scrape
const url = "https://www.cricbuzz.com/cricket-match/live-scores";

// Function to fetch and scrape the webpage
async function fetchLiveScores() {
  try {
    const response = await axios.get(url);
    const html = response.data;
    const $ = cheerio.load(html);

    const matches = [];

    $(".cb-mtch-lst.cb-col.cb-col-100.cb-tms-itm").each((index, element) => {
      const match = {};
      const titleElement = $(element).find("h3 a");
      match.title = titleElement.text().trim() || "N/A";
      match.matchDetails =
        $(element).find("span.text-gray").first().text().trim() || "N/A";
      matches.push(match);
    });

    return matches;
  } catch (error) {
    console.error("Error fetching the webpage:", error.message);
    throw new Error("Error fetching the webpage");
  }
}

// API route to fetch live scores and send email
router.get("/", async (req, res) => {
  try {
    const matches = await fetchLiveScores();
    await sendEmail(matches);
    res.status(200).json({ message: "Email sent successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
