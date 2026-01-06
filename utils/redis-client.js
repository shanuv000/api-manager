/**
 * Upstash Redis Client
 * Wrapper for live score caching with free tier optimization
 */

require("dotenv").config();
const { Redis } = require("@upstash/redis");

// Redis key constants
const KEYS = {
  LIVE_SCORES: "live_scores_cache",
  LIVE_SCORES_LITE: "live_scores_lite",
  WORKER_STATUS: "live_scores_worker_status",
  SCORECARD_PREFIX: "scorecard:",
  COMMENTARY_PREFIX: "commentary:",
};

// TTL in seconds (90s to allow 60s refresh cycle + buffer)
const DEFAULT_TTL = 90;

// Singleton instance
let redisClient = null;

/**
 * Get or create Redis client instance
 * @returns {Redis|null} Redis client or null if not configured
 */
function getClient() {
  if (redisClient) return redisClient;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.warn(
      "⚠️ Redis not configured: Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN"
    );
    return null;
  }

  try {
    redisClient = new Redis({ url, token });
    console.log("✅ Upstash Redis client initialized");
    return redisClient;
  } catch (error) {
    console.error("❌ Failed to initialize Redis client:", error.message);
    return null;
  }
}

/**
 * Get live scores from Redis cache
 * @returns {Promise<{data: any, timestamp: number}|null>}
 */
async function getLiveScores() {
  const client = getClient();
  if (!client) return null;

  try {
    const cached = await client.get(KEYS.LIVE_SCORES);
    if (cached) {
      console.log("✅ Redis HIT: live_scores_cache");
      return cached;
    }
    console.log("❌ Redis MISS: live_scores_cache");
    return null;
  } catch (error) {
    console.error("Redis GET error:", error.message);
    return null;
  }
}

/**
 * Set live scores in Redis cache
 * @param {Array} matches - Array of match data
 * @param {number} ttl - TTL in seconds (default: 90)
 * @returns {Promise<boolean>}
 */
async function setLiveScores(matches, ttl = DEFAULT_TTL) {
  const client = getClient();
  if (!client) return false;

  try {
    const payload = {
      data: matches,
      timestamp: Date.now(),
      count: matches.length,
    };
    await client.set(KEYS.LIVE_SCORES, payload, { ex: ttl });
    console.log(
      `💾 Redis SET: live_scores_cache (${matches.length} matches, TTL: ${ttl}s)`
    );
    return true;
  } catch (error) {
    console.error("Redis SET error:", error.message);
    return false;
  }
}

/**
 * Update worker status (for monitoring)
 * @param {Object} status - Worker status info
 * @returns {Promise<boolean>}
 */
async function setWorkerStatus(status) {
  const client = getClient();
  if (!client) return false;

  try {
    await client.set(
      KEYS.WORKER_STATUS,
      {
        ...status,
        timestamp: Date.now(),
      },
      { ex: 300 }
    ); // 5 min TTL for status
    return true;
  } catch (error) {
    console.error("Redis worker status error:", error.message);
    return false;
  }
}

/**
 * Get worker status
 * @returns {Promise<Object|null>}
 */
async function getWorkerStatus() {
  const client = getClient();
  if (!client) return null;

  try {
    return await client.get(KEYS.WORKER_STATUS);
  } catch (error) {
    console.error("Redis worker status GET error:", error.message);
    return null;
  }
}

/**
 * Get individual match scorecard from Redis
 * @param {string} matchId
 * @returns {Promise<any|null>}
 */
async function getMatchScorecard(matchId) {
  const client = getClient();
  if (!client) return null;

  try {
    const key = `${KEYS.SCORECARD_PREFIX}${matchId}`;
    const cached = await client.get(key);
    if (cached) {
      // console.log(`✅ Redis HIT: ${key}`);
      return cached;
    }
    return null;
  } catch (error) {
    console.error(`Redis GET scorecard error (${matchId}):`, error.message);
    return null;
  }
}

/**
 * Set individual match scorecard in Redis
 * @param {string} matchId
 * @param {Object} data
 * @param {number} ttl
 * @returns {Promise<boolean>}
 */
async function setMatchScorecard(matchId, data, ttl = DEFAULT_TTL) {
  const client = getClient();
  if (!client) return false;

  try {
    const key = `${KEYS.SCORECARD_PREFIX}${matchId}`;
    await client.set(key, data, { ex: ttl });
    return true;
  } catch (error) {
    console.error(`Redis SET scorecard error (${matchId}):`, error.message);
    return false;
  }
}

/**
 * Get lite live scores from Redis cache (match list without scorecards)
 * @returns {Promise<{data: any, timestamp: number}|null>}
 */
async function getLiteScores() {
  const client = getClient();
  if (!client) return null;

  try {
    const cached = await client.get(KEYS.LIVE_SCORES_LITE);
    if (cached) {
      console.log("✅ Redis HIT: live_scores_lite");
      return cached;
    }
    console.log("❌ Redis MISS: live_scores_lite");
    return null;
  } catch (error) {
    console.error("Redis GET lite error:", error.message);
    return null;
  }
}

/**
 * Set lite live scores in Redis cache (match list without scorecards)
 * @param {Array} matches - Array of match data (without scorecards)
 * @param {number} ttl - TTL in seconds (default: 90)
 * @returns {Promise<boolean>}
 */
async function setLiteScores(matches, ttl = DEFAULT_TTL) {
  const client = getClient();
  if (!client) return false;

  try {
    const payload = {
      data: matches,
      timestamp: Date.now(),
      count: matches.length,
    };
    await client.set(KEYS.LIVE_SCORES_LITE, payload, { ex: ttl });
    console.log(
      `💾 Redis SET: live_scores_lite (${matches.length} matches, TTL: ${ttl}s)`
    );
    return true;
  } catch (error) {
    console.error("Redis SET lite error:", error.message);
    return false;
  }
}

/**
 * Get individual match commentary from Redis
 * @param {string} matchId
 * @returns {Promise<any|null>}
 */
async function getMatchCommentary(matchId) {
  const client = getClient();
  if (!client) return null;

  try {
    const key = `${KEYS.COMMENTARY_PREFIX}${matchId}`;
    const cached = await client.get(key);
    if (cached) {
      return cached;
    }
    return null;
  } catch (error) {
    console.error(`Redis GET commentary error (${matchId}):`, error.message);
    return null;
  }
}

/**
 * Set individual match commentary in Redis
 * @param {string} matchId
 * @param {Object} data
 * @param {number} ttl
 * @returns {Promise<boolean>}
 */
async function setMatchCommentary(matchId, data, ttl = DEFAULT_TTL) {
  const client = getClient();
  if (!client) return false;

  try {
    const key = `${KEYS.COMMENTARY_PREFIX}${matchId}`;
    await client.set(key, data, { ex: ttl });
    return true;
  } catch (error) {
    console.error(`Redis SET commentary error (${matchId}):`, error.message);
    return false;
  }
}

module.exports = {
  getClient,
  getLiveScores,
  setLiveScores,
  getLiteScores,
  setLiteScores,
  setWorkerStatus,
  getWorkerStatus,
  getMatchScorecard,
  setMatchScorecard,
  getMatchCommentary,
  setMatchCommentary,
  KEYS,
  DEFAULT_TTL,
};
