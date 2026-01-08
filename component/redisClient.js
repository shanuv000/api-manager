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
 * Invalidate all cricket-related cache (scores)
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

/**
 * Invalidate all cricket news cache entries
 * Call this after scraping new articles to ensure fresh content is served
 */
async function invalidateNewsCache() {
  try {
    // Upstash Redis scan for keys matching pattern
    const keys = await redis.keys("cricket:news:*");

    if (keys.length === 0) {
      console.log("✓ No news cache entries to invalidate");
      return 0;
    }

    for (const key of keys) {
      await deleteCache(key);
    }

    console.log(`✓ Invalidated ${keys.length} news cache entries`);
    return keys.length;
  } catch (error) {
    console.error("Redis invalidateNewsCache error:", error.message);
    return 0; // Fail gracefully
  }
}

/**
 * Get cached article by slug
 * @param {string} slug - Article slug
 * @returns {Promise<any|null>} - Cached article or null
 */
async function getArticleCache(slug) {
  const key = `article:${slug}`;
  return getCache(key);
}

/**
 * Set article cache by slug
 * @param {string} slug - Article slug
 * @param {any} data - Article data to cache
 * @param {number} ttl - TTL in seconds (default 1 hour)
 */
async function setArticleCache(slug, data, ttl = 3600) {
  const key = `article:${slug}`;
  await setCache(key, data, ttl);
}

/**
 * Invalidate article cache by slug
 * @param {string} slug - Article slug
 */
async function invalidateArticleCache(slug) {
  const key = `article:${slug}`;
  await deleteCache(key);
}

/**
 * Invalidate all article caches
 * Call this after content enhancement to ensure fresh enhanced content is served
 * @returns {Promise<number>} - Number of invalidated cache entries
 */
async function invalidateAllArticleCaches() {
  try {
    const keys = await redis.keys("article:*");

    if (keys.length === 0) {
      console.log("✓ No article cache entries to invalidate");
      return 0;
    }

    for (const key of keys) {
      await deleteCache(key);
    }

    console.log(`✓ Invalidated ${keys.length} article cache entries`);
    return keys.length;
  } catch (error) {
    console.error("Redis invalidateAllArticleCaches error:", error.message);
    return 0; // Fail gracefully
  }
}

module.exports = {
  redis,
  getCache,
  setCache,
  deleteCache,
  invalidateCricketCache,
  invalidateNewsCache,
  // Article-level caching
  getArticleCache,
  setArticleCache,
  invalidateArticleCache,
  invalidateAllArticleCaches,
};
