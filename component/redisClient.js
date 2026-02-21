/**
 * Redis Client (ioredis)
 * General-purpose cache client for API routes (news, articles, cricket data)
 */

require("dotenv").config();
const Redis = require("ioredis");

const DEBUG = process.env.NODE_ENV !== 'production';

// Singleton instance
let redis = null;

function getRedis() {
  if (redis) return redis;

  redis = new Redis({
    host: "127.0.0.1",
    port: 6379,
    db: 0,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    lazyConnect: true,
  });

  redis.on("error", (err) => {
    console.error("❌ Redis (general) connection error:", err.message);
  });

  redis.on("connect", () => {
    console.log("✅ Redis (general) connected to 127.0.0.1:6379");
  });

  redis.connect().catch(() => { });

  return redis;
}

/**
 * Get data from cache
 * @param {string} key - Cache key
 * @returns {Promise<any|null>} - Cached data or null if not found
 */
async function getCache(key) {
  try {
    const client = getRedis();
    const data = await client.get(key);
    if (data) {
      if (DEBUG) console.log(`✓ Cache HIT: ${key}`);
      return JSON.parse(data);
    }
    if (DEBUG) console.log(`✗ Cache MISS: ${key}`);
    return null;
  } catch (error) {
    console.error(`Redis GET error for ${key}:`, error.message);
    return null; // Fail gracefully
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
    const client = getRedis();
    await client.set(key, JSON.stringify(value), "EX", ttl);
    if (DEBUG) console.log(`✓ Cache SET: ${key} (TTL: ${ttl}s)`);
  } catch (error) {
    console.error(`Redis SET error for ${key}:`, error.message);
  }
}

/**
 * Delete data from cache
 * @param {string} key - Cache key
 */
async function deleteCache(key) {
  try {
    const client = getRedis();
    await client.del(key);
    if (DEBUG) console.log(`✓ Cache DELETE: ${key}`);
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
 */
async function invalidateNewsCache() {
  try {
    const client = getRedis();
    const keys = [];
    let cursor = '0';
    do {
      const [nextCursor, batch] = await client.scan(cursor, 'MATCH', 'cricket:news:*', 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');

    if (keys.length === 0) {
      return 0;
    }

    await client.del(...keys);
    console.log(`✓ Invalidated ${keys.length} news cache entries`);
    return keys.length;
  } catch (error) {
    console.error("Redis invalidateNewsCache error:", error.message);
    return 0;
  }
}

/**
 * Get cached article by slug
 */
async function getArticleCache(slug) {
  const key = `article:${slug}`;
  return getCache(key);
}

/**
 * Set article cache by slug
 */
async function setArticleCache(slug, data, ttl = 3600) {
  const key = `article:${slug}`;
  await setCache(key, data, ttl);
}

/**
 * Invalidate article cache by slug
 */
async function invalidateArticleCache(slug) {
  const key = `article:${slug}`;
  await deleteCache(key);
}

/**
 * Invalidate all article caches
 */
async function invalidateAllArticleCaches() {
  try {
    const client = getRedis();
    const keys = [];
    let cursor = '0';
    do {
      const [nextCursor, batch] = await client.scan(cursor, 'MATCH', 'article:*', 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');

    if (keys.length === 0) {
      return 0;
    }

    await client.del(...keys);
    console.log(`✓ Invalidated ${keys.length} article cache entries`);
    return keys.length;
  } catch (error) {
    console.error("Redis invalidateAllArticleCaches error:", error.message);
    return 0;
  }
}

module.exports = {
  redis: getRedis,
  getCache,
  setCache,
  deleteCache,
  invalidateCricketCache,
  invalidateNewsCache,
  getArticleCache,
  setArticleCache,
  invalidateArticleCache,
  invalidateAllArticleCaches,
};
