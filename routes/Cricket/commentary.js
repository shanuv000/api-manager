/**
 * Commentary Extractor for Cricbuzz Match Pages
 *
 * Extracts ball-by-ball commentary from Cricbuzz live/scores pages.
 * Works similarly to scorecard.js - uses axios + parsing on SSR HTML.
 *
 * Usage:
 *   const getCommentaryDetails = require('./commentary');
 *   const commentary = await getCommentaryDetails('https://www.cricbuzz.com/live-cricket-scores/108811');
 */

const axios = require("axios");
const { withAxiosRetry } = require("../../utils/scraper-retry");

/**
 * Decode escaped unicode and HTML entities from Cricbuzz RSC payload
 */
function decodeCommentaryText(text) {
  if (!text) return "";

  return text
    .replace(/\\u003c/g, "<")
    .replace(/\\u003e/g, ">")
    .replace(/\\u0026/g, "&")
    .replace(/\\u003cbr\\u003e/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\\\/g, "\\")
    .replace(/\\"/g, '"')
    .replace(/<b>/gi, "**")
    .replace(/<\/b>/gi, "**")
    .replace(/<i>/gi, "_")
    .replace(/<\/i>/gi, "_")
    .replace(/<br\s*\/?>/gi, "\n")
    .trim();
}

/**
 * Extract commentary entries from Cricbuzz page HTML
 * Commentary is embedded as JSON in Next.js RSC script payload
 */
function parseCommentaryFromHtml(html) {
  const result = {
    entries: [],
    overSummaries: [],
    matchInfo: {},
    currentInnings: null,
  };

  try {
    // Extract match info - multiple patterns for robustness
    // Pattern 1: From matchScoreDetails or matchInfo (handles escaped and unescaped)
    const matchIdPatterns = [
      /\"matchId\\?\":\s*(\d+)/,                    // Escaped: \"matchId\":108811
      /"matchId":\s*(\d+)/,                         // Unescaped: "matchId":108811
      /matchId["\s:]+(\d+)/,                        // General: matchId: 108811
      /live-cricket-scores\/(\d+)\//                // From URL in page
    ];
    
    for (const pattern of matchIdPatterns) {
      const matchIdMatch = html.match(pattern);
      if (matchIdMatch) {
        result.matchInfo.matchId = matchIdMatch[1];
        break;
      }
    }

    // Pattern 2: State and status
    const statePattern = /"state\\?":\s*\\?"([^"\\]+)\\?"/;
    const stateMatch = html.match(statePattern);
    if (stateMatch) {
      result.matchInfo.state = stateMatch[1];
    }

    const statusPattern = /"customStatus\\?":\s*\\?"([^"\\]+)\\?"/;
    const statusMatch = html.match(statusPattern);
    if (statusMatch) {
      result.matchInfo.status = statusMatch[1]
        .replace(/\\u0026/g, "&")
        .replace(/\\\\/g, "");
    }

    // Pattern 3: Innings scores
    const inningsPattern =
      /"inningsScoreList\\?":\s*\[([^\]]+)\]/;
    const inningsMatch = html.match(inningsPattern);
    if (inningsMatch) {
      const inningsData = inningsMatch[1];
      // Extract team scores
      const scorePattern =
        /"batTeamName\\?":\s*\\?"([^"\\]+)\\?"[^}]*"score\\?":\s*(\d+)[^}]*"wickets\\?":\s*(\d+)[^}]*"overs\\?":\s*([0-9.]+)/g;
      let scoreMatch;
      result.matchInfo.scores = [];
      while ((scoreMatch = scorePattern.exec(inningsData)) !== null) {
        result.matchInfo.scores.push({
          team: scoreMatch[1],
          score: parseInt(scoreMatch[2]),
          wickets: parseInt(scoreMatch[3]),
          overs: parseFloat(scoreMatch[4]),
        });
      }
    }

    // Pattern to extract full commentary objects
    // Format: {"commType":"commentary","commText":"...", ...}
    const commPattern =
      /\\"commType\\":\\"commentary\\",\\"commText\\":\\"([^"]*?)\\",\\"inningsId\\":(\d+),\\"event\\":\[([^\]]*)\],\\"ballMetric\\":([0-9.]+|\\"?\$undefined\\"?),\\"teamName\\":\\"([^"]+)\\",\\"timestamp\\":(\d+)/g;

    let match;
    while ((match = commPattern.exec(html)) !== null) {
      const [, rawText, inningsId, rawEvents, ballMetric, teamName, timestamp] =
        match;

      // Skip placeholder entries
      if (rawText === "$23" || rawText === "$undefined") continue;

      const entry = {
        type: "ball",
        text: decodeCommentaryText(rawText),
        textPlain: decodeCommentaryText(rawText).replace(/\*\*|_/g, ""), // Remove markdown
        inningsId: parseInt(inningsId),
        teamName: teamName,
        timestamp: parseInt(timestamp),
        ball: null,
        events: [],
      };

      // Parse ball number (over.ball format)
      if (ballMetric && !ballMetric.includes("undefined")) {
        entry.ball = parseFloat(ballMetric.replace(/"/g, ""));
      }

      // Parse events array
      if (rawEvents) {
        entry.events = rawEvents
          .replace(/\\\"/g, "")
          .replace(/"/g, "")
          .split(",")
          .map((e) => e.trim())
          .filter((e) => e && e !== "all" && e !== "none");
      }

      // Classify the entry
      if (entry.events.includes("wicket")) {
        entry.eventType = "wicket";
      } else if (entry.events.includes("six")) {
        entry.eventType = "six";
      } else if (entry.events.includes("four")) {
        entry.eventType = "four";
      } else if (entry.events.includes("over-break")) {
        entry.eventType = "over-end";
      } else {
        entry.eventType = "ball";
      }

      result.entries.push(entry);
    }

    // Pattern 2: Pre-match/delay/break commentary with $undefined inningsId
    const preMatchPattern =
      /\\\"commType\\\":\\\"commentary\\\",\\\"commText\\\":\\\"([^\"]{10,}?)\\\",\\\"inningsId\\\":\\\"?\$undefined\\\"?,\\\"event\\\":\[([^\]]*)\],\\\"ballMetric\\\":\\\"?\$undefined\\\"?,\\\"teamName\\\":\\\"([^\"]*)\\\",\\\"timestamp\\\":(\d+)/g;

    while ((match = preMatchPattern.exec(html)) !== null) {
      const [, rawText, rawEvents, teamName, timestamp] = match;

      // Skip placeholder entries
      if (rawText === "$23" || rawText === "$undefined" || rawText.length < 10)
        continue;

      const entry = {
        type: "update",
        text: decodeCommentaryText(rawText),
        textPlain: decodeCommentaryText(rawText).replace(/\*\*|_/g, ""),
        inningsId: null,
        teamName: teamName || "N/A",
        timestamp: parseInt(timestamp),
        ball: null,
        events: [],
        eventType: "update", // Weather update, break update, etc.
      };

      // Parse events array
      if (rawEvents) {
        entry.events = rawEvents
          .replace(/\\\"/g, "")
          .replace(/"/g, "")
          .split(",")
          .map((e) => e.trim())
          .filter((e) => e && e !== "all" && e !== "none");
      }

      result.entries.push(entry);
    }

    // Extract over summaries
    const overPattern =
      /\\"overSeparator\\":\{[^}]*\\"overNumber\\":(\d+),\\"overSummary\\":\\"([^"]+)\\",\\"batTeamObj\\":\{\\"teamName\\":\\"([^"]+)\\",\\"teamScore\\":\\"([^"]+)\\"/g;

    while ((match = overPattern.exec(html)) !== null) {
      const [, overNumber, summary, teamName, teamScore] = match;
      result.overSummaries.push({
        type: "over-summary",
        overNumber: parseInt(overNumber),
        summary: summary,
        teamName: teamName,
        teamScore: teamScore,
      });
    }

    // Extract batsman details from commentary
    const batsmanPattern =
      /\\"batsmanDetails\\":\{\\"playerId\\":(\d+),\\"playerName\\":\\"([^"]+)\\"/g;
    const batsmenSeen = new Map();
    while ((match = batsmanPattern.exec(html)) !== null) {
      const [, playerId, playerName] = match;
      if (playerId !== "0" && playerName) {
        batsmenSeen.set(playerId, decodeCommentaryText(playerName));
      }
    }
    result.activeBatsmen = Array.from(batsmenSeen.entries()).map(
      ([id, name]) => ({
        playerId: id,
        playerName: name,
      })
    );

    // Sort entries by ball number (descending - most recent first)
    result.entries.sort((a, b) => {
      if (a.ball === null && b.ball === null) return b.timestamp - a.timestamp;
      if (a.ball === null) return 1;
      if (b.ball === null) return -1;
      return b.ball - a.ball;
    });

    // Remove duplicates (same ball number + same text)
    const seen = new Set();
    result.entries = result.entries.filter((entry) => {
      const key = `${entry.ball}-${entry.text.substring(0, 50)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Get current innings from most recent entry
    if (result.entries.length > 0) {
      result.currentInnings = result.entries[0].inningsId;
    }
  } catch (error) {
    console.error("Error parsing commentary:", error.message);
  }

  return result;
}

/**
 * Fetch and parse commentary from a Cricbuzz match URL
 * @param {string} url - Match URL (live-cricket-scores or live-cricket-full-commentary)
 * @returns {Object} Parsed commentary data
 */
async function getCommentaryDetails(url) {
  try {
    const response = await withAxiosRetry(
      () =>
        axios.get(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
          },
          timeout: 15000,
        }),
      { operationName: "Commentary Fetch", maxRetries: 2 }
    );

    const html = response.data;
    const commentary = parseCommentaryFromHtml(html);

    // Add metadata
    commentary.url = url;
    commentary.fetchedAt = Date.now();
    commentary.entryCount = commentary.entries.length;

    return commentary;
  } catch (error) {
    console.error(`Error fetching commentary from ${url}:`, error.message);
    return null;
  }
}

/**
 * Get recent commentary (last N balls)
 */
async function getRecentCommentary(url, limit = 20) {
  const full = await getCommentaryDetails(url);
  if (!full) return null;

  return {
    ...full,
    entries: full.entries.slice(0, limit),
    entryCount: Math.min(full.entries.length, limit),
    totalAvailable: full.entries.length,
  };
}

/**
 * Get commentary filtered by event type
 */
async function getHighlightsCommentary(url) {
  const full = await getCommentaryDetails(url);
  if (!full) return null;

  const highlights = full.entries.filter((e) =>
    ["wicket", "six", "four"].includes(e.eventType)
  );

  return {
    ...full,
    entries: highlights,
    entryCount: highlights.length,
    filterType: "highlights",
  };
}

module.exports = {
  getCommentaryDetails,
  getRecentCommentary,
  getHighlightsCommentary,
  parseCommentaryFromHtml,
};
