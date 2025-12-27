/**
 * Live Score Background Worker
 *
 * Runs continuously, scraping live scores every 60 seconds
 * and caching them in Redis for instant API responses.
 *
 * Usage:
 *   node scrapers/live-score-worker.js
 *
 * For production (PM2):
 *   pm2 start scrapers/live-score-worker.js --name "live-score-worker"
 */

require("dotenv").config();
const axios = require("axios");
const cheerio = require("cheerio");
const { createLimiter } = require("../utils/concurrency-limiter");
const getScorecardDetails = require("../routes/Cricket/scorecard");
const { withAxiosRetry } = require("../utils/scraper-retry");
const redisClient = require("../utils/redis-client");

// Discord webhook for error notifications
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Configuration
const CONFIG = {
  SCRAPE_INTERVAL_MS: 60 * 1000, // 60 seconds (optimized for free tier)
  LIVE_SCORES_URL: "https://www.cricbuzz.com/cricket-match/live-scores",
  CONCURRENT_SCORECARD_LIMIT: 3,
  REDIS_TTL: 90, // 90 seconds TTL
  MAX_CONSECUTIVE_ERRORS: 3, // Only notify after this many consecutive errors
};

let iterationCount = 0;
let isRunning = false;
let consecutiveErrors = 0;
let lastNotifiedError = null;

/**
 * Send Discord notification for errors
 */
async function sendDiscordError(title, errorMessage, details = {}) {
  if (!DISCORD_WEBHOOK_URL) {
    console.log("⚠️ Discord webhook not configured, skipping notification");
    return;
  }

  try {
    await axios.post(DISCORD_WEBHOOK_URL, {
      embeds: [
        {
          title: `🚨 ${title}`,
          description: errorMessage,
          color: 15158332, // Red
          fields: [
            {
              name: "Iteration",
              value: `#${iterationCount}`,
              inline: true,
            },
            {
              name: "Consecutive Errors",
              value: `${consecutiveErrors}`,
              inline: true,
            },
            ...(details.duration
              ? [
                  {
                    name: "Duration",
                    value: `${details.duration}ms`,
                    inline: true,
                  },
                ]
              : []),
          ],
          timestamp: new Date().toISOString(),
          footer: {
            text: "Live Score Worker",
          },
        },
      ],
    });
    console.log("📢 Discord notification sent");
  } catch (err) {
    console.error("Failed to send Discord notification:", err.message);
  }
}

/**
 * Send Discord notification for recovery
 */
async function sendDiscordRecovery(previousErrors, duration) {
  if (!DISCORD_WEBHOOK_URL) return;

  try {
    await axios.post(DISCORD_WEBHOOK_URL, {
      embeds: [
        {
          title: "✅ Live Score Worker Recovered",
          description: `Worker is back online after ${previousErrors} consecutive failures.`,
          color: 3066993, // Green
          fields: [
            {
              name: "Iteration",
              value: `#${iterationCount}`,
              inline: true,
            },
            {
              name: "Response Time",
              value: `${duration}ms`,
              inline: true,
            },
          ],
          timestamp: new Date().toISOString(),
          footer: {
            text: "Live Score Worker",
          },
        },
      ],
    });
    console.log("📢 Discord recovery notification sent");
  } catch (err) {
    console.error("Failed to send Discord recovery notification:", err.message);
  }
}

/**
 * Extract match info from Cricbuzz page
 */
function parseMatches($) {
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

    // Match format extraction
    const formatMatch = title.match(
      /(\d+(?:st|nd|rd|th)?\s*(?:Test|T20I?|ODI|T10))/i
    );
    match.matchFormat = formatMatch ? formatMatch[1] : null;

    const locationParts = match.location.split("•").map((s) => s.trim());
    match.matchNumber = locationParts[0] || null;
    match.venue = locationParts[1] || match.location;

    // Match state
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

    // Related links
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

  return matches;
}

/**
 * Main scrape function
 */
async function scrapeAndCache() {
  const startTime = Date.now();
  iterationCount++;

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🔄 Iteration #${iterationCount} - ${new Date().toISOString()}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  try {
    // Step 1: Fetch live scores page
    console.log("📡 Fetching live scores page...");
    const response = await withAxiosRetry(
      () =>
        axios.get(CONFIG.LIVE_SCORES_URL, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
          timeout: 15000,
        }),
      { operationName: "Live Scores Page", maxRetries: 2 }
    );

    const $ = cheerio.load(response.data);
    const matches = parseMatches($);
    console.log(`📊 Found ${matches.length} matches`);

    // Step 2: Fetch scorecards in parallel (with limit)
    const limit = createLimiter(CONFIG.CONCURRENT_SCORECARD_LIMIT);
    console.log(
      `📋 Fetching scorecards (max ${CONFIG.CONCURRENT_SCORECARD_LIMIT} concurrent)...`
    );

    const enrichedMatches = await Promise.all(
      matches.map((match) =>
        limit(async () => {
          if (match.links && match.links["Scorecard"]) {
            try {
              const details = await getScorecardDetails(
                match.links["Scorecard"]
              );
              if (details) {
                match.scorecard = details;
              }
            } catch (err) {
              // Silent fail - scorecard is optional
            }
          }
          return match;
        })
      )
    );

    const scorecardCount = enrichedMatches.filter((m) => m.scorecard).length;
    console.log(`✅ Fetched ${scorecardCount}/${matches.length} scorecards`);

    // Step 3: Save to Redis
    const saved = await redisClient.setLiveScores(
      enrichedMatches,
      CONFIG.REDIS_TTL
    );

    if (saved) {
      // Update worker status
      await redisClient.setWorkerStatus({
        iteration: iterationCount,
        matchCount: enrichedMatches.length,
        scorecardCount,
        lastScrapeMs: Date.now() - startTime,
      });
    }

    const duration = Date.now() - startTime;
    console.log(`⏱️  Completed in ${duration}ms`);

    // Send recovery notification if we had consecutive errors before
    if (consecutiveErrors >= CONFIG.MAX_CONSECUTIVE_ERRORS) {
      await sendDiscordRecovery(consecutiveErrors, duration);
    }

    // Reset consecutive errors on success
    consecutiveErrors = 0;
    lastNotifiedError = null;

    return { success: true, matchCount: enrichedMatches.length, duration };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ Scrape failed: ${error.message}`);

    // Track consecutive errors
    consecutiveErrors++;

    // Send Discord notification after consecutive failures
    if (consecutiveErrors >= CONFIG.MAX_CONSECUTIVE_ERRORS) {
      // Only notify if it's a new error or first time hitting threshold
      if (
        lastNotifiedError !== error.message ||
        consecutiveErrors === CONFIG.MAX_CONSECUTIVE_ERRORS
      ) {
        await sendDiscordError(
          "Live Score Worker Error",
          `**Error:** ${error.message}\n\nThe worker has failed ${consecutiveErrors} times consecutively.`,
          { duration }
        );
        lastNotifiedError = error.message;
      }
    }

    // Update worker status with error
    await redisClient.setWorkerStatus({
      iteration: iterationCount,
      error: error.message,
      consecutiveErrors,
      lastScrapeMs: duration,
    });

    return { success: false, error: error.message };
  }
}

/**
 * Main loop
 */
async function startWorker() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🏏 Live Score Background Worker");
  console.log(`📍 Interval: ${CONFIG.SCRAPE_INTERVAL_MS / 1000}s`);
  console.log(`📍 Redis TTL: ${CONFIG.REDIS_TTL}s`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Check Redis connection
  const client = redisClient.getClient();
  if (!client) {
    console.error("❌ Cannot start worker: Redis not configured");
    process.exit(1);
  }

  isRunning = true;

  // Run immediately on start
  await scrapeAndCache();

  // Then run on interval
  const intervalId = setInterval(async () => {
    if (isRunning) {
      await scrapeAndCache();
    }
  }, CONFIG.SCRAPE_INTERVAL_MS);

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n⚠️  Received SIGINT. Shutting down gracefully...");
    isRunning = false;
    clearInterval(intervalId);
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\n⚠️  Received SIGTERM. Shutting down gracefully...");
    isRunning = false;
    clearInterval(intervalId);
    process.exit(0);
  });
}

// Start the worker
startWorker();
