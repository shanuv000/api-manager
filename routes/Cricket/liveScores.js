const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const router = express.Router();

// URL of the website you want to scrape
const url = "https://www.cricbuzz.com/cricket-match/live-scores"; // Replace with the actual URL

// Define a GET route to scrape live scores
router.get("/live-scores", async (req, res) => {
  try {
    // Fetch the webpage
    const response = await axios.get(url);
    const html = response.data;
    const $ = cheerio.load(html); // Load HTML into cheerio

    const matches = []; // Array to hold match details

    // Select each match element and extract information
    $(".cb-mtch-lst.cb-col.cb-col-100.cb-tms-itm").each((index, element) => {
      const match = {}; // Object to hold individual match details

      // Extract basic match details with error handling
      try {
        const titleElement = $(element).find("h3 a");
        match.title = titleElement.text().trim() || "N/A"; // Match title

        match.matchDetails =
          $(element).find("span.text-gray").first().text().trim() || "N/A"; // Match details
      } catch (err) {
        match.title = "N/A";
        match.matchDetails = "N/A";
      }

      // Extract match time with error handling
      try {
        const timeElement = $(element)
          .find("span.ng-binding")
          .filter(function () {
            return $(this)
              .text()
              .trim()
              .match(/^\d{1,2}:\d{2} [AP]M$/);
          })
          .first();
        match.time = timeElement.length ? timeElement.text().trim() : "N/A"; // Match time
      } catch (err) {
        match.time = "N/A";
      }

      // Extract match heading with error handling
      try {
        const headingElement = $(element)
          .closest(".cb-plyr-tbody.cb-rank-hdr.cb-lv-main")
          .find("h2.cb-lv-grn-strip.text-bold.cb-lv-scr-mtch-hdr a");
        match.heading = headingElement.length
          ? headingElement.text().trim()
          : "N/A"; // Match heading
      } catch (err) {
        match.heading = "N/A";
      }

      // Extract match location with error handling
      try {
        const locationElement = $(element).find(".text-gray").last();
        match.location = locationElement.text().trim() || "N/A"; // Match location
      } catch (err) {
        match.location = "N/A";
      }

      // Extract additional match details (team scores and live commentary) with error handling
      try {
        const liveDetailsElement = $(element).find(".cb-lv-scrs-well");
        match.playingTeamBat =
          liveDetailsElement
            .find(".cb-hmscg-bat-txt .cb-hmscg-tm-nm")
            .first()
            .text()
            .trim() || "N/A"; // Batting team
        match.playingTeamBall =
          liveDetailsElement
            .find(".cb-hmscg-bwl-txt .cb-hmscg-tm-nm")
            .first()
            .text()
            .trim() || "N/A"; // Bowling team
        match.liveScorebat =
          liveDetailsElement
            .find(".cb-hmscg-bat-txt .cb-ovr-flo")
            .last()
            .text()
            .trim() || "N/A"; // Batting team score
        match.liveScoreball =
          liveDetailsElement
            .find(".cb-hmscg-bwl-txt .cb-ovr-flo")
            .eq(1)
            .text()
            .trim() || "N/A"; // Bowling team score
        match.liveCommentary =
          liveDetailsElement.find(".cb-text-live").text().trim() || // Live commentary
          liveDetailsElement.find(".cb-text-complete").text().trim() ||
          liveDetailsElement.find(".cb-text-preview").text().trim() ||
          "N/A";
      } catch (err) {
        match.playingTeam = "N/A";
        match.liveScore = "N/A";
        match.liveCommentary = "N/A";
      }

      // Extract link to the detailed live score page with error handling
      try {
        const liveScoreLinkElement = $(element)
          .find(".cb-lv-scrs-well")
          .attr("href");
        match.liveScoreLink = liveScoreLinkElement
          ? `https://www.cricbuzz.com${liveScoreLinkElement}`
          : null; // Live score link
      } catch (err) {
        match.liveScoreLink = null;
      }

      // Extract links to additional pages (e.g., scorecard, commentary, news) with error handling
      match.links = {};
      try {
        $(element)
          .find("nav.cb-col-100.cb-col.padt5 a")
          .each((i, linkElement) => {
            const title = $(linkElement).attr("title");
            const href = $(linkElement).attr("href");
            match.links[title] = href
              ? `https://www.cricbuzz.com${href}`
              : null; // Additional links
          });
      } catch (err) {
        match.links = {};
      }

      // Add the match object to the matches array
      matches.push(match);
    });

    // Send the scraped data as a JSON response
    res.json(matches);
  } catch (error) {
    // Handle errors in fetching the webpage or processing the HTML
    console.error("Error fetching the webpage:", error.message);
    res.status(500).json({ error: "Error fetching the webpage" });
  }
});

// Export the router for use in the main app
module.exports = router;
