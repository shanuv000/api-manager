/**
 * Scraper Cache Utility
 * In-memory caching with TTL for scraper responses
 */

const NodeCache = require("node-cache");

// Cache configuration by scraper type
const CACHE_CONFIG = {
  liveScores: {
    ttl: 30, // 30 seconds - scores change frequently
    checkPeriod: 10,
  },
  recentMatches: {
    ttl: 3600, // 1 hour - recent matches only update when a match ends
    checkPeriod: 120,
  },
  scorecard: {
    ttl: 60, // 1 minute - scorecards during live matches
    checkPeriod: 20,
  },
  upcomingMatches: {
    ttl: 7200, // 2 hours - upcoming matches/schedules rarely change
    checkPeriod: 300,
  },
};

// Create cache instances for each scraper type
const caches = {};

/**
 * Get or create a cache instance for given type
 * @param {string} type - Cache type (liveScores, recentMatches, scorecard)
 * @returns {NodeCache} Cache instance
 */
function getCache(type) {
  if (!caches[type]) {
    const config = CACHE_CONFIG[type] || { ttl: 60, checkPeriod: 20 };
    caches[type] = new NodeCache({
      stdTTL: config.ttl,
      checkperiod: config.checkPeriod,
      useClones: true,
    });
    console.log(`📦 Created cache for ${type} (TTL: ${config.ttl}s)`);
  }
  return caches[type];
}

/**
 * Generate cache key from request parameters
 * @param {string} prefix - Key prefix
 * @param  {...any} parts - Additional key parts
 * @returns {string} Cache key
 */
function generateKey(prefix, ...parts) {
  return [prefix, ...parts.filter(Boolean)].join(":");
}

/**
 * Get value from cache
 * @param {string} type - Cache type
 * @param {string} key - Cache key
 * @returns {any|undefined} Cached value or undefined
 */
function get(type, key) {
  const cache = getCache(type);
  const value = cache.get(key);

  if (value !== undefined) {
    console.log(`✅ Cache HIT [${type}]: ${key}`);
    return value;
  }

  console.log(`❌ Cache MISS [${type}]: ${key}`);
  return undefined;
}

/**
 * Set value in cache
 * @param {string} type - Cache type
 * @param {string} key - Cache key
 * @param {any} value - Value to cache
 * @param {number} customTtl - Optional custom TTL in seconds
 */
function set(type, key, value, customTtl = null) {
  const cache = getCache(type);

  if (customTtl) {
    cache.set(key, value, customTtl);
  } else {
    cache.set(key, value);
  }

  console.log(`💾 Cache SET [${type}]: ${key}`);
}

/**
 * Delete specific key from cache
 * @param {string} type - Cache type
 * @param {string} key - Cache key
 */
function del(type, key) {
  const cache = getCache(type);
  cache.del(key);
  console.log(`🗑️ Cache DEL [${type}]: ${key}`);
}

/**
 * Clear all entries in a cache type
 * @param {string} type - Cache type
 */
function clear(type) {
  const cache = getCache(type);
  cache.flushAll();
  console.log(`🧹 Cache CLEAR [${type}]`);
}

/**
 * Get cache statistics
 * @param {string} type - Cache type
 * @returns {Object} Statistics object
 */
function getStats(type) {
  const cache = getCache(type);
  const stats = cache.getStats();
  return {
    type,
    keys: cache.keys().length,
    hits: stats.hits,
    misses: stats.misses,
    hitRate:
      stats.hits + stats.misses > 0
        ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(2) + "%"
        : "0%",
  };
}

/**
 * Get all cache statistics
 * @returns {Object} All cache stats
 */
function getAllStats() {
  return Object.keys(caches).reduce((acc, type) => {
    acc[type] = getStats(type);
    return acc;
  }, {});
}

/**
 * Cache-through helper - get from cache or execute function and cache result
 * @param {string} type - Cache type
 * @param {string} key - Cache key
 * @param {Function} fetchFn - Async function to fetch data if not cached
 * @param {number} customTtl - Optional custom TTL
 * @returns {Promise<any>} Cached or fetched data
 */
async function getOrFetch(type, key, fetchFn, customTtl = null) {
  // Try cache first
  const cached = get(type, key);
  if (cached !== undefined) {
    return { data: cached, fromCache: true };
  }

  // Fetch fresh data
  const data = await fetchFn();

  // Cache it
  set(type, key, data, customTtl);

  return { data, fromCache: false };
}

module.exports = {
  getCache,
  generateKey,
  get,
  set,
  del,
  clear,
  getStats,
  getAllStats,
  getOrFetch,
  CACHE_CONFIG,
};
