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
const { getRecentCommentary } = require("../routes/Cricket/commentary");
const { withAxiosRetry } = require("../utils/scraper-retry");
const redisClient = require("../utils/redis-client");

// Discord webhook for error notifications
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Configuration
const CONFIG = {
  SCRAPE_INTERVAL_MS: 60 * 1000, // 60 seconds (optimized for free tier)
  LIVE_SCORES_URL: "https://www.cricbuzz.com/cricket-match/live-scores",
  CONCURRENT_SCORECARD_LIMIT: 3,
  CONCURRENT_COMMENTARY_LIMIT: 2, // Limit concurrent commentary fetches
  COMMENTARY_ENTRIES_LIMIT: 20, // Max commentary entries to cache per match
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
 * Extract match info from Cricbuzz page (comprehensive version)
 * Includes: team icons, time/date from JSON-LD, matchStatus, matchStartTime
 */
function parseMatches($, html) {
  const matches = [];
  const processedLinks = new Set();

  // Extract match times from JSON-LD SportsEvent data
  const matchTimeMap = new Map();
  try {
    // Parse JSON-LD script tags
    const scriptTags = $('script[type="application/ld+json"]');
    scriptTags.each((i, script) => {
      try {
        const content = $(script).html();
        if (content && content.includes("SportsEvent")) {
          const jsonData = JSON.parse(content);

          // Helper function to extract SportsEvent data
          const extractSportsEvents = (items) => {
            if (!Array.isArray(items)) return;
            for (const item of items) {
              if (item["@type"] === "SportsEvent") {
                const name = item.name;
                const startDate = item.startDate;
                const status = item.eventStatus;
                if (name && (startDate || status)) {
                  matchTimeMap.set(name, { startDate, status });
                }
              }
            }
          };

          // Handle WebPage with mainEntity.itemListElement
          if (
            jsonData["@type"] === "WebPage" &&
            jsonData.mainEntity?.itemListElement
          ) {
            extractSportsEvents(jsonData.mainEntity.itemListElement);
          }
          // Handle ItemList containing SportsEvents
          if (jsonData["@type"] === "ItemList" && jsonData.itemListElement) {
            extractSportsEvents(jsonData.itemListElement);
          }
          // Handle direct SportsEvent
          if (jsonData["@type"] === "SportsEvent") {
            const name = jsonData.name;
            const startDate = jsonData.startDate;
            const status = jsonData.eventStatus;
            if (name && (startDate || status)) {
              matchTimeMap.set(name, { startDate, status });
            }
          }
        }
      } catch (e) {
        // JSON parse error, skip
      }
    });

    // Extract from embedded RSC payload with team names
    const sportsEventPattern =
      /"@type":"SportsEvent","name":"([^"]+)"[^]*?"competitor":\[([^\]]+)\][^]*?"startDate":"([^"]+)"[^]*?"eventStatus":"([^"]+)"/g;
    let eventMatch;
    while ((eventMatch = sportsEventPattern.exec(html)) !== null) {
      const name = eventMatch[1];
      const competitorBlock = eventMatch[2];
      const startDate = eventMatch[3];
      const status = eventMatch[4];

      const teamNames = [];
      const teamPattern = /"name":"([^"]+)"/g;
      let teamMatch;
      while ((teamMatch = teamPattern.exec(competitorBlock)) !== null) {
        teamNames.push(teamMatch[1].toLowerCase());
      }

      if (name && (startDate || status)) {
        matchTimeMap.set(name, {
          startDate: startDate || null,
          status: status || null,
          teams: teamNames,
        });
      }
    }

    // Fallback: simpler pattern without competitors
    const simpleSportsEvents = html.match(
      /"@type":"SportsEvent","name":"([^"]+)"[^}]*?"startDate":"([^"]+)"[^}]*?"eventStatus":"([^"]+)"/g
    );
    if (simpleSportsEvents) {
      for (const eventStr of simpleSportsEvents) {
        const nameMatch = eventStr.match(/"name":"([^"]+)"/);
        const dateMatch = eventStr.match(/"startDate":"([^"]+)"/);
        const statusMatch = eventStr.match(/"eventStatus":"([^"]+)"/);
        if (
          nameMatch &&
          (dateMatch || statusMatch) &&
          !matchTimeMap.has(nameMatch[1])
        ) {
          matchTimeMap.set(nameMatch[1], {
            startDate: dateMatch ? dateMatch[1] : null,
            status: statusMatch ? statusMatch[1] : null,
            teams: [],
          });
        }
      }
    }

    console.log(`📅 Found ${matchTimeMap.size} match times from page data`);
  } catch (e) {
    console.log("Time extraction error (non-critical):", e.message);
  }

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
    const teamIcons = [];

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

        // Extract team icon
        const iconImg = $row.find("img").first();
        const iconSrc = iconImg.attr("src");
        if (iconSrc) {
          const fullIconUrl = iconSrc.startsWith("http")
            ? iconSrc
            : `https://static.cricbuzz.com${iconSrc}`;
          teamIcons.push(fullIconUrl);
        }
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

    // Add team icons
    match.teamIcons = teamIcons;
    if (teamIcons.length >= 2) {
      match.team1Icon = teamIcons[0];
      match.team2Icon = teamIcons[1];
    } else if (teamIcons.length === 1) {
      match.team1Icon = teamIcons[0];
      match.team2Icon = null;
    } else {
      match.team1Icon = null;
      match.team2Icon = null;
    }

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

    // ========== TIME AND STATUS EXTRACTION ==========
    // Helper functions
    const isMatchResult = (str) => {
      if (!str) return false;
      const resultPatterns = [
        /won by/i,
        /\bdrawn?\b/i,
        /\btied?\b/i,
        /no result/i,
        /abandoned/i,
        /cancelled/i,
        /innings (and|&)/i,
        /\d+\s*(wkts?|wickets?|runs?)/i,
      ];
      return resultPatterns.some((pattern) => pattern.test(str));
    };

    const isLiveStatus = (str) => {
      if (!str) return false;
      const livePatterns = [
        /\blive\b/i,
        /day \d+/i,
        /session/i,
        /innings break/i,
        /tea\b|lunch\b|stumps/i,
        /at (bat|crease)/i,
        /opt to (bat|bowl)/i,
        /trail by|lead by/i,
        /\bneed\s+\d+\s+runs?\b/i,
      ];
      return livePatterns.some((pattern) => pattern.test(str));
    };

    const teamsMatch = (scrapedTeams, jsonLdTeams) => {
      if (!jsonLdTeams || jsonLdTeams.length === 0) return false;
      if (!scrapedTeams || scrapedTeams.length === 0) return false;
      const scrapedLower = scrapedTeams.map((t) => t.toLowerCase());
      return jsonLdTeams.some((jsonTeam) =>
        scrapedLower.some(
          (scraped) => scraped.includes(jsonTeam) || jsonTeam.includes(scraped)
        )
      );
    };

    // Try to match with JSON-LD data
    let timeInfo = null;
    const matchDescParts = match.matchDetails?.split(",") || [];
    const matchNumber2 = matchDescParts
      .find((part) =>
        /\d+(st|nd|rd|th)\s+(match|test|odi|t20)/i.test(part.trim())
      )
      ?.trim();

    for (const [eventName, value] of matchTimeMap) {
      const descriptionMatches =
        matchNumber2 &&
        eventName.toLowerCase().includes(matchNumber2.toLowerCase());
      const eventParts = eventName.split(",");
      const eventPartMatches =
        eventParts.length > 0 &&
        match.matchDetails?.includes(eventParts[0].trim());

      if (descriptionMatches || eventPartMatches) {
        if (teamsMatch(match.teams, value.teams)) {
          timeInfo = value;
          break;
        }
      }
    }

    // Set time and matchStatus based on extracted info
    if (timeInfo && timeInfo.status) {
      const statusStr = timeInfo.status;

      if (isLiveStatus(statusStr)) {
        match.matchStatus = "live";
        match.result = statusStr;
        match.time = "LIVE";
        match.matchStartTime = {
          startDateISO: timeInfo.startDate || null,
          status: statusStr,
        };
      } else if (isMatchResult(statusStr)) {
        match.result = statusStr;
        match.matchStatus = "completed";
        if (timeInfo.startDate) {
          match.matchStartTime = {
            startDateISO: timeInfo.startDate,
            note: "Match completed",
          };
          try {
            const startDate = new Date(timeInfo.startDate);
            match.time = startDate.toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            });
          } catch (e) {
            match.time = "Completed";
          }
        } else {
          match.time = "Completed";
          match.matchStartTime = { note: "Match completed" };
        }
      } else {
        // Parse "Match starts at" format
        const matchStartsMatch = statusStr.match(
          /Match starts at\s+(?:([A-Za-z]+\s+\d{1,2}),?\s+)?(\d{1,2}:\d{2})\s*(GMT|IST|Local)?/i
        );
        if (matchStartsMatch) {
          const datePart = matchStartsMatch[1] || "";
          const timePart = matchStartsMatch[2];
          const tzPart = matchStartsMatch[3] || "GMT";
          match.time = datePart
            ? `${datePart}, ${timePart} ${tzPart}`
            : `${timePart} ${tzPart}`;
          match.matchStatus = "upcoming";
          match.matchStartTime = {
            date: datePart || null,
            time: timePart,
            timezone: tzPart,
            startDateISO: timeInfo.startDate,
            raw: statusStr,
          };
        } else {
          match.time = statusStr;
          match.matchStartTime = {
            startDateISO: timeInfo.startDate,
            raw: statusStr,
          };
          match.matchStatus = "live";
        }
      }
    } else if (match.liveCommentary) {
      // Fallback: extract from liveCommentary
      if (isLiveStatus(match.liveCommentary)) {
        match.result = match.liveCommentary;
        match.matchStatus = "live";
        match.time = "LIVE";
      } else if (isMatchResult(match.liveCommentary)) {
        match.result = match.liveCommentary;
        match.matchStatus = "completed";
        match.time = "Completed";
      } else {
        const matchStartsMatch = match.liveCommentary.match(
          /Match starts at\s+(?:([A-Za-z]+\s+\d{1,2}),?\s+)?(\d{1,2}:\d{2})\s*(GMT|IST|Local)?/i
        );
        if (matchStartsMatch) {
          const datePart = matchStartsMatch[1] || "";
          const timePart = matchStartsMatch[2];
          const tzPart = matchStartsMatch[3] || "GMT";
          match.time = datePart
            ? `${datePart}, ${timePart} ${tzPart}`
            : `${timePart} ${tzPart}`;
          match.matchStatus = "upcoming";
          match.matchStartTime = {
            date: datePart || null,
            time: timePart,
            timezone: tzPart,
            raw: match.liveCommentary,
          };
        } else {
          match.time = "N/A";
          match.matchStatus = "live";
        }
      }
    } else {
      match.time = "N/A";
      match.matchStatus = "live";
    }

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

    const html = response.data;
    const $ = cheerio.load(html);
    const matches = parseMatches($, html);
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

    // Step 3: Save to Redis using tiered data structure
    // Extract matchId from matchLink for each match
    const matchesWithIds = enrichedMatches.map((match) => {
      const idMatch = match.matchLink?.match(/\/(\d+)\//);
      match.matchId = idMatch ? idMatch[1] : null;
      return match;
    });

    // 3a: Save LITE data (without scorecards) for fast list endpoint
    const liteMatches = matchesWithIds.map((match) => {
      const { scorecard, ...liteMatch } = match;
      // Add scorecardUrl for clients to fetch scorecard on-demand
      if (match.matchId && match.scorecard) {
        liteMatch.scorecardUrl = `/api/cricket/scorecard/${match.matchId}`;
        liteMatch.hasScorecard = true;
      } else {
        liteMatch.hasScorecard = false;
      }
      return liteMatch;
    });
    await redisClient.setLiteScores(liteMatches, CONFIG.REDIS_TTL);

    // 3b: Save individual scorecards for on-demand fetching
    let savedScorecards = 0;
    for (const match of matchesWithIds) {
      if (match.matchId && match.scorecard) {
        const scorecardSaved = await redisClient.setMatchScorecard(
          match.matchId,
          {
            matchId: match.matchId,
            title: match.title,
            teams: match.teams,
            innings: match.scorecard,
            timestamp: Date.now(),
          },
          CONFIG.REDIS_TTL
        );
        if (scorecardSaved) savedScorecards++;
      }
    }
    console.log(`💾 Saved ${savedScorecards} individual scorecards to Redis`);

    // 3c: Fetch and cache commentary for LIVE matches only
    const liveMatchesForCommentary = matchesWithIds.filter(
      (m) => m.matchStatus === "live" && m.matchLink && m.matchId
    );
    let savedCommentary = 0;

    if (liveMatchesForCommentary.length > 0) {
      console.log(
        `📝 Fetching commentary for ${liveMatchesForCommentary.length} live matches...`
      );

      const commentaryLimit = createLimiter(CONFIG.CONCURRENT_COMMENTARY_LIMIT);
      await Promise.all(
        liveMatchesForCommentary.map((match) =>
          commentaryLimit(async () => {
            try {
              const commentary = await getRecentCommentary(
                match.matchLink,
                CONFIG.COMMENTARY_ENTRIES_LIMIT
              );
              if (commentary && commentary.entries.length > 0) {
                await redisClient.setMatchCommentary(
                  match.matchId,
                  {
                    matchId: match.matchId,
                    title: match.title,
                    teams: match.teams,
                    currentInnings: commentary.currentInnings,
                    matchInfo: commentary.matchInfo,
                    activeBatsmen: commentary.activeBatsmen,
                    overSummaries: commentary.overSummaries?.slice(0, 5),
                    entries: commentary.entries,
                    entryCount: commentary.entryCount,
                    timestamp: Date.now(),
                  },
                  CONFIG.REDIS_TTL
                );
                savedCommentary++;
              }
            } catch (err) {
              // Silent fail - commentary is optional enhancement
            }
          })
        )
      );
      console.log(
        `💾 Saved ${savedCommentary}/${liveMatchesForCommentary.length} commentaries to Redis`
      );
    }

    // 3d: Save FULL data (backward compatible) for ?full=true requests
    const saved = await redisClient.setLiveScores(
      matchesWithIds,
      CONFIG.REDIS_TTL
    );

    if (saved) {
      // Update worker status
      await redisClient.setWorkerStatus({
        iteration: iterationCount,
        matchCount: matchesWithIds.length,
        scorecardCount,
        savedScorecards,
        savedCommentary,
        liveMatchCount: liveMatchesForCommentary.length,
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
