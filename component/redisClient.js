require("dotenv").config();
const { Redis } = require("@upstash/redis");

// Initialize Upstash Redis client
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

/**
 * Get data from cache
 * @param {string} key - Cache key
 * @returns {Promise<any|null>} - Cached data or null if not found
 */
async function getCache(key) {
  try {
    const data = await redis.get(key);
    if (data) {
      console.log(`✓ Cache HIT: ${key}`);
      // Upstash Redis automatically deserializes JSON, so data is already an object
      return data;
    }
    console.log(`✗ Cache MISS: ${key}`);
    return null;
  } catch (error) {
    console.error(`Redis GET error for ${key}:`, error.message);
    return null; // Fail gracefully, don't break the API
  }
}

/**
 * Set data in cache with TTL
 * @param {string} key - Cache key
 * @param {any} value - Data to cache
 * @param {number} ttl - Time to live in seconds
 */
async function setCache(key, value, ttl = 300) {
  try {
    // Upstash Redis automatically serializes objects, use set with EX option
    await redis.set(key, value, { ex: ttl });
    console.log(`✓ Cache SET: ${key} (TTL: ${ttl}s)`);
  } catch (error) {
    console.error(`Redis SET error for ${key}:`, error.message);
    // Fail gracefully, don't break the API
  }
}

/**
 * Delete data from cache
 * @param {string} key - Cache key
 */
async function deleteCache(key) {
  try {
    await redis.del(key);
    console.log(`✓ Cache DELETE: ${key}`);
  } catch (error) {
    console.error(`Redis DELETE error for ${key}:`, error.message);
  }
}

/**
 * Invalidate all cricket-related cache
 */
async function invalidateCricketCache() {
  const keys = [
    "cricket:recent-scores",
    "cricket:live-scores",
    "cricket:upcoming-matches",
  ];
  
  for (const key of keys) {
    await deleteCache(key);
  }
}

module.exports = {
  redis,
  getCache,
  setCache,
  deleteCache,
  invalidateCricketCache,
};
