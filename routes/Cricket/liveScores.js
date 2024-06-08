const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cron = require("node-cron");

const router = express.Router();

// URL of the website you want to scrape
const url = "https://www.cricbuzz.com/cricket-match/live-scores"; // Replace with the actual URL

// Variable to store the fetched matches data
let matches = [];

// Function to fetch and update matches data
let i = 0;
const fetchMatchesData = async () => {
  try {
    console.log(`Fetching data at ${new Date().toISOString()}`);
    console.log(i++);
    const response = await axios.get(url);
    const html = response.data;
    const $ = cheerio.load(html);

    const updatedMatches = [];

    $(".cb-mtch-lst.cb-col.cb-col-100.cb-tms-itm").each((index, element) => {
      const match = {};

      try {
        const titleElement = $(element).find("h3 a");
        match.title = titleElement.text().trim() || "N/A";

        match.matchDetails =
          $(element).find("span.text-gray").first().text().trim() || "N/A";
      } catch (err) {
        match.title = "N/A";
        match.matchDetails = "N/A";
      }

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
        match.time = timeElement.length ? timeElement.text().trim() : "N/A";
      } catch (err) {
        match.time = "N/A";
      }

      try {
        const headingElement = $(element)
          .closest(".cb-plyr-tbody.cb-rank-hdr.cb-lv-main")
          .find("h2.cb-lv-grn-strip.text-bold.cb-lv-scr-mtch-hdr a");
        match.heading = headingElement.length
          ? headingElement.text().trim()
          : "N/A";
      } catch (err) {
        match.heading = "N/A";
      }

      try {
        const locationElement = $(element).find(".text-gray").last();
        match.location = locationElement.text().trim() || "N/A";
      } catch (err) {
        match.location = "N/A";
      }

      try {
        // match.test = i++;
        const liveDetailsElement = $(element).find(".cb-lv-scrs-well");
        match.playingTeamBat =
          liveDetailsElement
            .find(".cb-hmscg-bat-txt .cb-hmscg-tm-nm")
            .first()
            .text()
            .trim() || "N/A";
        match.playingTeamBall =
          liveDetailsElement
            .find(".cb-hmscg-bwl-txt .cb-hmscg-tm-nm")
            .first()
            .text()
            .trim() || "N/A";
        match.liveScorebat =
          liveDetailsElement
            .find(".cb-hmscg-bat-txt .cb-ovr-flo")
            .last()
            .text()
            .trim() || "N/A";
        match.liveScoreball =
          liveDetailsElement
            .find(".cb-hmscg-bwl-txt .cb-ovr-flo")
            .eq(1)
            .text()
            .trim() || "N/A";
        match.liveCommentary =
          liveDetailsElement.find(".cb-text-live").text().trim() ||
          liveDetailsElement.find(".cb-text-complete").text().trim() ||
          liveDetailsElement.find(".cb-text-preview").text().trim() ||
          "N/A";
      } catch (err) {
        match.playingTeam = "N/A";
        match.liveScore = "N/A";
        match.liveCommentary = "N/A";
      }

      try {
        const liveScoreLinkElement = $(element)
          .find(".cb-lv-scrs-well")
          .attr("href");
        match.liveScoreLink = liveScoreLinkElement
          ? `https://www.cricbuzz.com${liveScoreLinkElement}`
          : null;
      } catch (err) {
        match.liveScoreLink = null;
      }

      match.links = {};
      try {
        $(element)
          .find("nav.cb-col-100.cb-col.padt5 a")
          .each((i, linkElement) => {
            const title = $(linkElement).attr("title");
            const href = $(linkElement).attr("href");
            match.links[title] = href
              ? `https://www.cricbuzz.com${href}`
              : null;
          });
      } catch (err) {
        match.links = {};
      }

      updatedMatches.push(match);
    });

    matches = updatedMatches;
  } catch (error) {
    console.error("Error fetching the webpage:", error.message);
  }
};

// Schedule the fetchMatchesData function to run every minute
cron.schedule("* * * * *", fetchMatchesData);

// Initial fetch to populate data
fetchMatchesData();

// Define a GET route to serve the live scores
router.get("/live-scores", (req, res) => {
  res.json(matches);
});

// Export the router for use in the main app
module.exports = router;
