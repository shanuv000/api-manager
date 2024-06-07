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

    $(".cb-mtch-lst.cb-col.cb-col-100.cb-tms-itm").each((index, element) => {
      const match = {};

      // Basic match details
      try {
        const titleElement = $(element).find("h3 a");
        match.title = titleElement.text().trim() || "N/A";

        match.matchDetails =
          $(element).find("span.text-gray").first().text().trim() || "N/A";
      } catch (err) {
        match.title = "N/A";
        match.matchDetails = "N/A";
      }

      // Time extraction with error handling
      try {
        const timeElement = $(element).find("span.ng-binding").first();
        match.time = timeElement.length ? timeElement.text().trim() : "N/A";
      } catch (err) {
        match.time = "N/A";
      }

      // Heading extraction with error handling
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

      // Additional match details (team scores and live commentary)
      try {
        const liveDetailsElement = $(element).find(".cb-lv-scrs-well");
        match.playingTeamBat =
          liveDetailsElement
            .find(".cb-hmscg-bat-txt .cb-ovr-flo")
            .first()
            .text()
            .trim() || "N/A";
        match.playingTeamBall =
          liveDetailsElement
            .find(".cb-ovr-flo .cb-hmscg-tm-nm")
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
            .find(".cb-hmscg-bwl-txt .cb-ovr-flo ")
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

      // Links to detailed pages
      try {
        const liveScoreLinkElement = liveDetailsElement.attr("href");
        match.liveScoreLink = liveScoreLinkElement
          ? `https://www.cricbuzz.com${liveScoreLinkElement}`
          : null;
      } catch (err) {
        match.liveScoreLink = null;
      }

      // Links to additional pages (e.g., scorecard, commentary, news)
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

      matches.push(match);
    });

    // Send the scraped data as a JSON response
    res.json(matches);
  } catch (error) {
    console.error("Error fetching the webpage:", error.message);
    res.status(500).json({ error: "Error fetching the webpage" });
  }
});

module.exports = router;
