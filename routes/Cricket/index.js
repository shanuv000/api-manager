const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const router = express.Router();

// URLs for scraping
const urls = {
  recentMatches:
    "https://www.cricbuzz.com/cricket-match/live-scores/recent-matches",
  liveScores: "https://www.cricbuzz.com/cricket-match/live-scores",
  upcomingMatches:
    "https://www.cricbuzz.com/cricket-match/live-scores/upcoming-matches",
};

// Common scraping function
const scrapeCricbuzzMatches = async (url) => {
  const response = await axios.get(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    timeout: 10000,
  });

  const html = response.data;
  const $ = cheerio.load(html);
  const matches = [];
  const processedLinks = new Set();

  const matchElements = $("a.w-full.bg-cbWhite.flex.flex-col");

  matchElements.each((index, element) => {
    const $matchCard = $(element);
    const href = $matchCard.attr("href");
    const title = $matchCard.attr("title");

    if (!title || !href || !title.includes("vs") || processedLinks.has(href)) {
      return;
    }

    processedLinks.add(href);

    const match = {};
    match.title = title.trim();
    match.matchLink = href ? `https://www.cricbuzz.com${href}` : null;

    const titleParts = title.split(" - ");
    if (titleParts.length >= 2) {
      match.matchDetails = titleParts[0].trim();
      match.status = titleParts[1].trim();
    } else {
      match.matchDetails = title.trim();
      match.status = "N/A";
    }

    const locationSpan = $matchCard.find("span.text-xs.text-cbTxtSec").first();
    match.location = locationSpan.length ? locationSpan.text().trim() : "N/A";

    const teams = [];
    const teamAbbr = [];
    const scores = [];

    $matchCard
      .find("div.flex.items-center.gap-4.justify-between")
      .each((i, row) => {
        const $row = $(row);

        const teamFull = $row
          .find("span.hidden.wb\\:block.whitespace-nowrap")
          .text()
          .trim();
        if (teamFull) teams.push(teamFull);

        const teamAbb = $row
          .find("span.block.wb\\:hidden.whitespace-nowrap")
          .text()
          .trim();
        if (teamAbb) teamAbbr.push(teamAbb);

        const score = $row
          .find("span.font-medium.wb\\:font-semibold")
          .text()
          .trim();
        if (score) scores.push(score);
      });

    if (teams.length >= 2) {
      match.playingTeamBat = teams[0];
      match.playingTeamBall = teams[1];
    } else if (teams.length === 1) {
      match.playingTeamBat = teams[0];
      match.playingTeamBall = "N/A";
    } else {
      match.playingTeamBat = "N/A";
      match.playingTeamBall = "N/A";
    }

    match.teams = teams.length > 0 ? teams : teamAbbr;
    match.teamAbbr = teamAbbr.length > 0 ? teamAbbr : teams;

    if (scores.length >= 2) {
      match.liveScorebat = scores[0];
      match.liveScoreball = scores[1];
    } else if (scores.length === 1) {
      match.liveScorebat = scores[0];
      match.liveScoreball = "N/A";
    } else {
      match.liveScorebat = "N/A";
      match.liveScoreball = "N/A";
    }
    match.scores = scores;

    const resultSpan = $matchCard
      .find(
        'span[class*="text-cbComplete"], span[class*="text-cbLive"], span[class*="text-cbPreview"]'
      )
      .first();
    match.liveCommentary = resultSpan.length
      ? resultSpan.text().trim()
      : match.status || "N/A";

    match.links = {};
    if (href) {
      const basePath = href.replace("/live-cricket-scores/", "");
      match.links["Live Score"] = `https://www.cricbuzz.com${href}`;
      match.links[
        "Scorecard"
      ] = `https://www.cricbuzz.com/live-cricket-scorecard/${basePath}`;
      match.links[
        "Full Commentary"
      ] = `https://www.cricbuzz.com/live-cricket-full-commentary/${basePath}`;
      match.links[
        "News"
      ] = `https://www.cricbuzz.com/cricket-match-news/${basePath}`;
    }

    match.time = "N/A";
    matches.push(match);
  });

  return matches;
};

// Recent Scores endpoint
router.get("/recent-scores", async (req, res) => {
  try {
    const matches = await scrapeCricbuzzMatches(urls.recentMatches);
    res.json({
      success: true,
      count: matches.length,
      data: matches,
    });
  } catch (error) {
    console.error("Error fetching recent matches:", error.message);
    res.status(500).json({
      success: false,
      error: "Error fetching the webpage",
      message: error.message,
    });
  }
});

// Live Scores endpoint
router.get("/live-scores", async (req, res) => {
  try {
    const matches = await scrapeCricbuzzMatches(urls.liveScores);
    res.json({
      success: true,
      count: matches.length,
      data: matches,
    });
  } catch (error) {
    console.error("Error fetching live scores:", error.message);
    res.status(500).json({
      success: false,
      error: "Error fetching the webpage",
      message: error.message,
    });
  }
});

// Upcoming Matches endpoint
router.get("/upcoming-matches", async (req, res) => {
  try {
    const matches = await scrapeCricbuzzMatches(urls.upcomingMatches);
    res.json({
      success: true,
      count: matches.length,
      data: matches,
    });
  } catch (error) {
    console.error("Error fetching upcoming matches:", error.message);
    res.status(500).json({
      success: false,
      error: "Error fetching the webpage",
      message: error.message,
    });
  }
});

module.exports = router;
