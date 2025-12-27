/**
 * Upstash Redis Client
 * Wrapper for live score caching with free tier optimization
 */

require("dotenv").config();
const { Redis } = require("@upstash/redis");

// Redis key constants
const KEYS = {
  LIVE_SCORES: "live_scores_cache",
  WORKER_STATUS: "live_scores_worker_status",
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

module.exports = {
  getClient,
  getLiveScores,
  setLiveScores,
  setWorkerStatus,
  getWorkerStatus,
  KEYS,
  DEFAULT_TTL,
};
