/**
 * Standalone Commentary API Router
 *
 * Provides ball-by-ball commentary for cricket matches.
 * Can be mounted independently in any Express app.
 *
 * Endpoints:
 *   GET /commentary/:matchId - Get commentary for a match
 *   GET /commentary/:matchId?limit=N - Limit number of entries
 *
 * Usage:
 *   const commentaryRouter = require('./routes/Cricket/commentaryRouter');
 *   app.use('/api/cricket', commentaryRouter);
 */

const express = require("express");
const router = express.Router();

// Import commentary extraction functions
const {
  getCommentaryDetails,
  getRecentCommentary,
  getHighlightsCommentary,
} = require("./commentary");

// Import Redis client (optional - graceful fallback if not available)
let redisClient = null;
try {
  redisClient = require("../../utils/redis-client");
} catch (e) {
  console.log("Commentary Router: Redis client not available, using direct fetch mode");
}

/**
 * GET /commentary/:matchId
 * Get ball-by-ball commentary for a specific match
 *
 * Query Parameters:
 *   - limit: Max entries to return (default: 20)
 *   - highlights: If "true", only return 4s, 6s, wickets
 *
 * Response:
 *   - success: boolean
 *   - matchId: string
 *   - data: Object containing:
 *       - matchInfo: { state, status, scores }
 *       - currentInnings: number
 *       - activeBatsmen: [{ playerId, playerName }]
 *       - overSummaries: [{ overNumber, summary, teamScore }]
 *       - entries: [{ ball, text, eventType, team }]
 *       - entryCount: number
 *       - totalAvailable: number
 *   - fromCache: boolean
 *   - cacheSource: string
 *   - responseTime: number (ms)
 */
router.get("/commentary/:matchId", async (req, res) => {
  const startTime = Date.now();
  const { matchId } = req.params;
  const limit = parseInt(req.query.limit) || 20;
  const highlightsOnly = req.query.highlights === "true";

  // Validate matchId
  if (!matchId || !/^\d+$/.test(matchId)) {
    return res.status(400).json({
      success: false,
      error: "Invalid matchId",
      message: "matchId must be a numeric string",
      responseTime: Date.now() - startTime,
    });
  }

  try {
    // STEP 1: Try Redis cache first (if available)
    if (redisClient) {
      try {
        const cached = await redisClient.getMatchCommentary(matchId);
        if (cached) {
          let entries = cached.entries || [];

          // Filter for highlights if requested
          if (highlightsOnly) {
            entries = entries.filter((e) =>
              ["wicket", "six", "four"].includes(e.eventType)
            );
          }

          // Apply limit
          entries = entries.slice(0, limit);

          return res.json({
            success: true,
            matchId,
            data: {
              ...cached,
              entries,
              entryCount: entries.length,
              totalAvailable: cached.entries?.length || 0,
            },
            fromCache: true,
            cacheSource: "redis",
            cacheAgeSeconds: Math.round((Date.now() - cached.timestamp) / 1000),
            responseTime: Date.now() - startTime,
          });
        }
      } catch (cacheErr) {
        console.log("Redis cache miss or error:", cacheErr.message);
      }
    }

    // STEP 2: Fetch live from Cricbuzz
    const matchUrl = `https://www.cricbuzz.com/live-cricket-scores/${matchId}`;

    let commentary;
    if (highlightsOnly) {
      commentary = await getHighlightsCommentary(matchUrl);
    } else {
      commentary = await getRecentCommentary(matchUrl, limit);
    }

    if (commentary && commentary.entries && commentary.entries.length > 0) {
      const responseData = {
        matchId,
        matchInfo: commentary.matchInfo,
        currentInnings: commentary.currentInnings,
        activeBatsmen: commentary.activeBatsmen,
        overSummaries: commentary.overSummaries?.slice(0, 5),
        entries: commentary.entries.slice(0, limit),
        entryCount: Math.min(commentary.entries.length, limit),
        totalAvailable: commentary.totalAvailable || commentary.entries.length,
        timestamp: Date.now(),
      };

      return res.json({
        success: true,
        matchId,
        data: responseData,
        fromCache: false,
        cacheSource: "live-fetch",
        responseTime: Date.now() - startTime,
      });
    }

    // STEP 3: No commentary found
    return res.status(404).json({
      success: false,
      error: "Commentary not found",
      message: `No commentary available for matchId: ${matchId}. Commentary is only available for live or recently completed matches.`,
      hint: "Try a different matchId or check if the match has started",
      responseTime: Date.now() - startTime,
    });
  } catch (error) {
    console.error(`Error fetching commentary for ${matchId}:`, error.message);
    res.status(500).json({
      success: false,
      error: "Error fetching commentary",
      message: error.message,
      responseTime: Date.now() - startTime,
    });
  }
});

/**
 * GET /commentary/:matchId/highlights
 * Shorthand for getting only 4s, 6s, and wickets
 */
router.get("/commentary/:matchId/highlights", async (req, res) => {
  req.query.highlights = "true";
  req.query.limit = req.query.limit || "50";
  return router.handle(req, res);
});

// Export the router
module.exports = router;
