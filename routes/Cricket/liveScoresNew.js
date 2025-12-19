const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const getScorecardDetails = require("./scorecard");
const { withAxiosRetry } = require("../../utils/scraper-retry");
const scraperCache = require("../../utils/scraper-cache");
const scraperHealth = require("../../utils/scraper-health");

const router = express.Router();

// URL of the website you want to scrape
const url = "https://www.cricbuzz.com/cricket-match/live-scores";

// Scraper name for health tracking
const SCRAPER_NAME = "liveScores";

// Define a GET route to scrape live scores
router.get("/live-scores", async (req, res) => {
  const startTime = Date.now();
  const cacheKey = scraperCache.generateKey("live", "scores");

  try {
    // Check cache first
    const cached = scraperCache.get("liveScores", cacheKey);
    if (cached) {
      return res.json({
        success: true,
        count: cached.length,
        data: cached,
        fromCache: true,
        responseTime: Date.now() - startTime,
      });
    }

    // Fetch the webpage with retry logic
    const response = await withAxiosRetry(
      () =>
        axios.get(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
          timeout: 15000,
        }),
      { operationName: "Live Scores Fetch", maxRetries: 3 }
    );

    const html = response.data;
    const $ = cheerio.load(html);

    const matches = [];
    const processedLinks = new Set(); // To avoid duplicates

    // Find all match cards directly - they are <a> tags with specific classes
    const matchElements = $("a.w-full.bg-cbWhite.flex.flex-col");

    matchElements.each((index, element) => {
      const $matchCard = $(element);
      const href = $matchCard.attr("href");
      const title = $matchCard.attr("title");

      // Only process valid match links (must have "vs" in title) and avoid duplicates
      if (
        !title ||
        !href ||
        !title.includes("vs") ||
        processedLinks.has(href)
      ) {
        return;
      }

      processedLinks.add(href);

      const match = {};

      // Extract basic match details
      match.title = title.trim();
      match.matchLink = href ? `https://www.cricbuzz.com${href}` : null;

      // Extract match info from title
      const titleParts = title.split(" - ");
      if (titleParts.length >= 2) {
        match.matchDetails = titleParts[0].trim();
        match.status = titleParts[1].trim();
      } else {
        match.matchDetails = title.trim();
        match.status = "N/A";
      }

      // Extract location from the span with match details
      const locationSpan = $matchCard
        .find("span.text-xs.text-cbTxtSec")
        .first();
      match.location = locationSpan.length ? locationSpan.text().trim() : "N/A";

      // Extract team names and scores
      const teams = [];
      const teamAbbr = [];
      const scores = [];

      // Find all team/score rows within this match card
      $matchCard
        .find("div.flex.items-center.gap-4.justify-between")
        .each((i, row) => {
          const $row = $(row);

          // Get full team name (desktop version - hidden wb:block)
          const teamFull = $row
            .find("span.hidden.wb\\:block.whitespace-nowrap")
            .text()
            .trim();
          if (teamFull) {
            teams.push(teamFull);
          }

          // Get team abbreviation (mobile version - block wb:hidden)
          const teamAbb = $row
            .find("span.block.wb\\:hidden.whitespace-nowrap")
            .text()
            .trim();
          if (teamAbb) {
            teamAbbr.push(teamAbb);
          }

          // Get score
          const score = $row
            .find("span.font-medium.wb\\:font-semibold")
            .text()
            .trim();
          if (score) {
            scores.push(score);
          }
        });

      // Assign teams
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

      // Assign team arrays
      match.teams = teams.length > 0 ? teams : teamAbbr;
      match.teamAbbr = teamAbbr.length > 0 ? teamAbbr : teams;

      // Assign scores
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

      // Extract match result/commentary
      const resultSpan = $matchCard
        .find(
          'span[class*="text-cbComplete"], span[class*="text-cbLive"], span[class*="text-cbPreview"]'
        )
        .first();
      match.liveCommentary = resultSpan.length
        ? resultSpan.text().trim()
        : match.status || "N/A";

      // Extract related links
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

      match.time = "N/A"; // Time not readily available in new structure

      // Add the match object to the matches array
      matches.push(match);
    });

    // Enrich matches with detailed scorecard data
    // We use Promise.all to fetch details in parallel
    console.log(`Fetching details for ${matches.length} matches...`);
    const enrichedMatches = await Promise.all(
      matches.map(async (match) => {
        if (match.links && match.links["Scorecard"]) {
          try {
            console.log(`Fetching scorecard for ${match.title}...`);
            const details = await getScorecardDetails(match.links["Scorecard"]);
            if (details) {
              console.log(`Successfully fetched scorecard for ${match.title}`);
              match.scorecard = details;
            } else {
              console.log(`No details returned for ${match.title}`);
            }
          } catch (err) {
            console.error(
              `Failed to fetch details for ${match.title}: ${err.message}`
            );
          }
        } else {
          console.log(`No scorecard link for ${match.title}`);
        }
        return match;
      })
    );
    console.log("Finished fetching details.");

    // Cache the results
    scraperCache.set("liveScores", cacheKey, enrichedMatches);

    // Record success
    scraperHealth.recordSuccess(SCRAPER_NAME, Date.now() - startTime);

    // Send the scraped data as a JSON response
    res.json({
      success: true,
      count: enrichedMatches.length,
      data: enrichedMatches,
      fromCache: false,
      responseTime: Date.now() - startTime,
    });
  } catch (error) {
    // Record failure for health monitoring
    await scraperHealth.recordFailure(
      SCRAPER_NAME,
      error,
      Date.now() - startTime
    );

    // Handle errors in fetching the webpage or processing the HTML
    console.error("Error fetching live scores:", error.message);
    res.status(500).json({
      success: false,
      error: "Error fetching the webpage",
      message: error.message,
      responseTime: Date.now() - startTime,
    });
  }
});

// Export the router for use in the main app
module.exports = router;
