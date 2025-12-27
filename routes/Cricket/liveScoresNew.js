const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const { createLimiter } = require("../../utils/concurrency-limiter");
const getScorecardDetails = require("./scorecard");
const { withAxiosRetry } = require("../../utils/scraper-retry");
const scraperCache = require("../../utils/scraper-cache");
const scraperHealth = require("../../utils/scraper-health");
const redisClient = require("../../utils/redis-client");

const router = express.Router();

// URL of the website you want to scrape
const url = "https://www.cricbuzz.com/cricket-match/live-scores";

// Scraper name for health tracking
const SCRAPER_NAME = "liveScores";

// Limit concurrent scorecard fetches to prevent rate limiting
const CONCURRENT_SCORECARD_LIMIT = 3;

/**
 * Fallback scrape function - only used when Redis cache is empty
 * (i.e., when background worker is not running)
 */
async function fallbackScrape() {
  console.log("⚠️ Redis empty - performing fallback scrape...");

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
    } else {
      match.playingTeamBat = teams[0] || "N/A";
      match.playingTeamBall = teams[1] || "N/A";
    }

    match.teams = teams.length > 0 ? teams : teamAbbr;
    match.teamAbbr = teamAbbr.length > 0 ? teamAbbr : teams;

    if (scores.length >= 2) {
      match.liveScorebat = scores[0];
      match.liveScoreball = scores[1];
    } else {
      match.liveScorebat = scores[0] || "N/A";
      match.liveScoreball = scores[1] || "N/A";
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

    const formatMatch = title.match(
      /(\d+(?:st|nd|rd|th)?\s*(?:Test|T20I?|ODI|T10))/i
    );
    match.matchFormat = formatMatch ? formatMatch[1] : null;

    const locationParts = match.location.split("•").map((s) => s.trim());
    match.matchNumber = locationParts[0] || null;
    match.venue = locationParts[1] || match.location;

    if (match.liveCommentary.toLowerCase().includes("won")) {
      match.matchState = "completed";
    } else if (
      match.liveCommentary.toLowerCase().includes("preview") ||
      match.liveCommentary.toLowerCase().includes("upcoming")
    ) {
      match.matchState = "upcoming";
    } else if (
      match.liveCommentary.toLowerCase().includes("stumps") ||
      match.liveCommentary.toLowerCase().includes("lunch") ||
      match.liveCommentary.toLowerCase().includes("tea") ||
      match.liveCommentary.toLowerCase().includes("break")
    ) {
      match.matchState = "break";
    } else {
      match.matchState = "live";
    }

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
    }

    match.time = "N/A";
    matches.push(match);
  });

  // Fetch scorecards (limited for fallback - lighter operation)
  const limit = createLimiter(CONCURRENT_SCORECARD_LIMIT);
  const enrichedMatches = await Promise.all(
    matches.map((match) =>
      limit(async () => {
        if (match.links && match.links["Scorecard"]) {
          try {
            const details = await getScorecardDetails(match.links["Scorecard"]);
            if (details) {
              match.scorecard = details;
            }
          } catch (err) {
            // Silent fail
          }
        }
        return match;
      })
    )
  );

  // Cache in Redis for next requests
  await redisClient.setLiveScores(enrichedMatches, 90);

  return enrichedMatches;
}

// Define a GET route to scrape live scores
router.get("/live-scores", async (req, res) => {
  const startTime = Date.now();

  try {
    // PRIORITY 1: Try Redis cache (populated by background worker)
    const redisCached = await redisClient.getLiveScores();
    if (redisCached && redisCached.data) {
      const ageMs = Date.now() - redisCached.timestamp;
      const ageSeconds = Math.round(ageMs / 1000);

      return res.json({
        success: true,
        count: redisCached.count,
        data: redisCached.data,
        fromCache: true,
        cacheSource: "redis",
        cacheAgeSeconds: ageSeconds,
        responseTime: Date.now() - startTime,
      });
    }

    // PRIORITY 2: Try in-memory cache (legacy fallback)
    const cacheKey = scraperCache.generateKey("live", "scores");
    const memoryCached = scraperCache.get("liveScores", cacheKey);
    if (memoryCached) {
      return res.json({
        success: true,
        count: memoryCached.length,
        data: memoryCached,
        fromCache: true,
        cacheSource: "memory",
        responseTime: Date.now() - startTime,
      });
    }

    // PRIORITY 3: Fallback scrape (only when worker is down)
    const matches = await fallbackScrape();

    // Also cache in memory
    scraperCache.set("liveScores", cacheKey, matches);
    scraperHealth.recordSuccess(SCRAPER_NAME, Date.now() - startTime);

    res.json({
      success: true,
      count: matches.length,
      data: matches,
      fromCache: false,
      cacheSource: "fallback",
      responseTime: Date.now() - startTime,
    });
  } catch (error) {
    await scraperHealth.recordFailure(
      SCRAPER_NAME,
      error,
      Date.now() - startTime
    );

    console.error("Error fetching live scores:", error.message);
    res.status(500).json({
      success: false,
      error: "Error fetching the webpage",
      message: error.message,
      responseTime: Date.now() - startTime,
    });
  }
});

// Worker status endpoint (for monitoring)
router.get("/live-scores/worker-status", async (req, res) => {
  try {
    const status = await redisClient.getWorkerStatus();
    const cache = await redisClient.getLiveScores();

    res.json({
      success: true,
      worker: status || {
        status: "unknown",
        message: "No worker status found",
      },
      cache: cache
        ? {
            available: true,
            matchCount: cache.count,
            ageSeconds: Math.round((Date.now() - cache.timestamp) / 1000),
          }
        : { available: false },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Export the router for use in the main app
module.exports = router;
