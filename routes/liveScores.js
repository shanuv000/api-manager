const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const router = express.Router();

// URL of the website you want to scrape
const url = "https://www.cricbuzz.com/cricket-match/live-scores"; // Replace with the actual URL

router.get("/", async (req, res) => {
  try {
    const response = await axios.get(url);
    const html = response.data;
    const $ = cheerio.load(html);

    const matches = [];

    $(".cb-mtch-lst .cb-schdl").each((index, element) => {
      const title = $(element).find("h3 a").text().trim();
      const matchDetails = $(element)
        .find("span.text-gray")
        .first()
        .text()
        .trim();
      const time = $(element).find("span.ng-binding").text().trim();
      const location = $(element).find(".text-gray").last().text().trim();
      const playingTeam = $(element)
        .find(" .cb-hmscg-bat-txt .cb-ovr-flo ")
        .eq(0)
        .text()
        .trim();
      const liveScore = $(element)
        .find(" .cb-hmscg-bat-txt .cb-ovr-flo ")
        .eq(1)
        .text()
        .trim();
      const liveCommentary = $(element).find(".cb-text-live").text().trim();
      const liveScoreLink = $(element).find("a.cb-lv-scrs-well").attr("href");

      matches.push({
        title,
        matchDetails,
        time,
        location,
        playingTeam,
        liveScore,
        liveCommentary,
        liveScoreLink: liveScoreLink
          ? `https://www.cricbuzz.com${liveScoreLink}`
          : null, // Construct full URL if relative
      });
    });

    // Send the scraped data as a JSON response
    res.json(matches);
  } catch (error) {
    console.error("Error fetching the webpage:", error);
    res.status(500).send("Error fetching the webpage");
  }
});

module.exports = router;
