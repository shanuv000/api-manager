const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const router = express.Router();

// URLs of the websites to scrape
const urls = {
  recentMatches:
    "https://www.cricbuzz.com/cricket-match/live-scores/recent-matches",
  liveScores: "https://www.cricbuzz.com/cricket-match/live-scores",
  upcomingMatches:
    "https://www.cricbuzz.com/cricket-match/live-scores/upcoming-matches",
};

// Function to extract match information
const extractMatchInfo = ($, element) => {
  const match = {};
  try {
    const titleElement = $(element).find("h3 a");
    match.title = titleElement.text().trim() || "N/A";
    match.matchDetails =
      $(element).find("span.text-gray").first().text().trim() || "N/A";

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

    const headingElement = $(element)
      .closest(".cb-plyr-tbody.cb-rank-hdr.cb-lv-main")
      .find("h2.cb-lv-grn-strip.text-bold.cb-lv-scr-mtch-hdr a");
    match.heading = headingElement.length
      ? headingElement.text().trim()
      : "N/A";

    const locationElement = $(element).find(".text-gray").last();
    match.location = locationElement.text().trim() || "N/A";

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

    const liveScoreLinkElement = $(element)
      .find(".cb-lv-scrs-well")
      .attr("href");
    match.liveScoreLink = liveScoreLinkElement
      ? `https://www.cricbuzz.com${liveScoreLinkElement}`
      : null;

    match.links = {};
    $(element)
      .find("nav.cb-col-100.cb-col.padt5 a")
      .each((i, linkElement) => {
        const title = $(linkElement).attr("title");
        const href = $(linkElement).attr("href");
        match.links[title] = href ? `https://www.cricbuzz.com${href}` : null;
      });
  } catch (err) {
    match.title =
      match.matchDetails =
      match.time =
      match.heading =
      match.location =
        "N/A";
    match.playingTeamBat =
      match.playingTeamBall =
      match.liveScorebat =
      match.liveScoreball =
      match.liveCommentary =
        "N/A";
    match.liveScoreLink = null;
    match.links = {};
  }

  return match;
};

// Function to handle scraping
const scrapeMatches = async (url) => {
  try {
    const response = await axios.get(url);
    const html = response.data;
    const $ = cheerio.load(html);

    const matches = [];
    $(".cb-mtch-lst.cb-col.cb-col-100.cb-tms-itm").each((index, element) => {
      const match = extractMatchInfo($, element);
      matches.push(match);
    });

    return matches;
  } catch (error) {
    console.error("Error fetching the webpage:", error.message);
    throw new Error("Error fetching the webpage");
  }
};

// Define routes
router.get("/recent-scores", async (req, res) => {
  try {
    const matches = await scrapeMatches(urls.recentMatches);
    res.json(matches);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/live-scores", async (req, res) => {
  try {
    const matches = await scrapeMatches(urls.liveScores);
    res.json(matches);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/upcoming-matches", async (req, res) => {
  try {
    const matches = await scrapeMatches(urls.upcomingMatches);
    res.json(matches);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export the router for use in the main app
module.exports = {
  router,
  scrapeMatches,
};
