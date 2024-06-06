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
      const titleElement = $(element).find("h3 a");
      match.title = titleElement.text().trim() || "N/A";

      match.matchDetails =
        $(element).find("span.text-gray").first().text().trim() || "N/A";

      // Time extraction with error handling
      const timeElement = $(element).find("span.ng-binding").first();
      match.time = timeElement.length ? timeElement.text().trim() : "N/A";

      // Heading extraction with error handling
      const headingElement = $(element)
        .closest(".cb-plyr-tbody.cb-rank-hdr.cb-lv-main")
        .find("h2.cb-lv-grn-strip.text-bold.cb-lv-scr-mtch-hdr a");
      match.heading = headingElement.length
        ? headingElement.text().trim()
        : "N/A";

      const locationElement = $(element).find(".text-gray").last();
      match.location = locationElement.text().trim() || "N/A";

      // Additional match details (team scores and live commentary)
      const liveDetailsElement = $(element).find(".cb-lv-scrs-well");
      match.playingTeam =
        liveDetailsElement
          .find(".cb-hmscg-bat-txt .cb-ovr-flo")
          .first()
          .text()
          .trim() || "N/A";
      match.liveScore =
        liveDetailsElement
          .find(".cb-hmscg-bat-txt .cb-ovr-flo")
          .last()
          .text()
          .trim() || "N/A";
      match.liveCommentary =
        liveDetailsElement.find(".cb-text-live").text().trim() || "N/A";

      // Links to detailed pages
      const liveScoreLinkElement = liveDetailsElement.attr("href");
      match.liveScoreLink = liveScoreLinkElement
        ? `https://www.cricbuzz.com${liveScoreLinkElement}`
        : null;

      // Links to additional pages (e.g., scorecard, commentary, news)
      match.links = {};
      $(element)
        .find("nav.cb-col-100.cb-col.padt5 a")
        .each((i, linkElement) => {
          const title = $(linkElement).attr("title");
          const href = $(linkElement).attr("href");
          match.links[title] = href ? `https://www.cricbuzz.com${href}` : null;
        });

      matches.push(match);
    });

    // Send the scraped data as a JSON response
    res.json(matches);
  } catch (error) {
    console.error("Error fetching the webpage:", error.message);
    res.status(500).send("Error fetching the webpage");
  }
});

module.exports = router;
