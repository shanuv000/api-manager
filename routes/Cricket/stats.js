/**
 * Cricket Stats Module - RapidAPI Cricbuzz Integration
 *
 * Provides functions to fetch ICC rankings, standings, and records
 * from the Cricbuzz RapidAPI.
 * 
 * Features:
 * - Multi-key fallback: Uses multiple API keys with automatic failover
 * - Quota tracking: Monitors usage per key and overall
 */

const axios = require("axios");
const { getCache, setCache } = require("../../component/redisClient");

// RapidAPI configuration
const RAPIDAPI_BASE_URL = "https://cricbuzz-cricket.p.rapidapi.com";
const RAPIDAPI_MONTHLY_LIMIT = 200; // Free tier limit per key
const RAPIDAPI_HOST = process.env.RAPIDAPI_CRICBUZZ_HOST || "cricbuzz-cricket.p.rapidapi.com";

/**
 * Get all available RapidAPI keys from environment
 * Supports RAPIDAPI_CRICBUZZ_KEY, RAPIDAPI_CRICBUZZ_KEY2, KEY3, KEY4, KEY5
 */
const getApiKeys = () => {
  const keys = [];
  if (process.env.RAPIDAPI_CRICBUZZ_KEY) keys.push(process.env.RAPIDAPI_CRICBUZZ_KEY);
  if (process.env.RAPIDAPI_CRICBUZZ_KEY2) keys.push(process.env.RAPIDAPI_CRICBUZZ_KEY2);
  if (process.env.RAPIDAPI_CRICBUZZ_KEY3) keys.push(process.env.RAPIDAPI_CRICBUZZ_KEY3);
  if (process.env.RAPIDAPI_CRICBUZZ_KEY4) keys.push(process.env.RAPIDAPI_CRICBUZZ_KEY4);
  if (process.env.RAPIDAPI_CRICBUZZ_KEY5) keys.push(process.env.RAPIDAPI_CRICBUZZ_KEY5);
  return keys;
};

let currentKeyIndex = 0;

/**
 * Get the current active API key
 */
const getCurrentApiKey = () => {
  const keys = getApiKeys();
  if (keys.length === 0) return null;
  return keys[currentKeyIndex % keys.length];
};

/**
 * Switch to next API key (used on rate limit or quota exhaustion)
 */
const switchToNextKey = () => {
  const keys = getApiKeys();
  if (keys.length <= 1) return false;

  const oldIndex = currentKeyIndex;
  currentKeyIndex = (currentKeyIndex + 1) % keys.length;
  console.log(`🔄 RapidAPI: Switching from key ${oldIndex + 1} to key ${currentKeyIndex + 1} of ${keys.length}`);
  return true;
};

const getHeaders = (apiKey = null) => ({
  "x-rapidapi-host": RAPIDAPI_HOST,
  "x-rapidapi-key": apiKey || getCurrentApiKey(),
});

/**
 * Get current month key for quota tracking (YYYY-MM format)
 */
const getMonthKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

/**
 * Get current day key for quota tracking (YYYY-MM-DD format)
 */
const getDayKey = () => {
  return new Date().toISOString().split("T")[0];
};

/**
 * Track RapidAPI usage in Redis
 * @param {string} endpoint - The endpoint called
 * @param {number} responseSize - Size of response in bytes (approximate)
 * @param {number} keyIndex - Which API key was used (1-based)
 */
const trackRapidAPIUsage = async (endpoint, responseSize = 0, keyIndex = 1) => {
  try {
    const monthKey = getMonthKey();
    const dayKey = getDayKey();
    const quotaKey = "rapidapi:quota";

    // Get current quota data
    let quotaData = await getCache(quotaKey);
    if (!quotaData) {
      quotaData = {
        monthlyCount: 0,
        dailyCount: 0,
        totalCount: 0,
        bandwidthMB: 0,
        currentMonth: monthKey,
        currentDay: dayKey,
        lastRequest: null,
        history: [],
        perKeyUsage: {}, // Track usage per API key
      };
    }

    // Reset monthly count if new month
    if (quotaData.currentMonth !== monthKey) {
      quotaData.monthlyCount = 0;
      quotaData.perKeyUsage = {}; // Reset per-key usage too
      quotaData.currentMonth = monthKey;
    }

    // Reset daily count if new day
    if (quotaData.currentDay !== dayKey) {
      quotaData.dailyCount = 0;
      quotaData.currentDay = dayKey;
    }

    // Update counts
    quotaData.monthlyCount++;
    quotaData.dailyCount++;
    quotaData.totalCount++;
    quotaData.bandwidthMB += responseSize / (1024 * 1024);

    // Track per-key usage
    if (!quotaData.perKeyUsage) quotaData.perKeyUsage = {};
    const keyLabel = `key${keyIndex}`;
    quotaData.perKeyUsage[keyLabel] = (quotaData.perKeyUsage[keyLabel] || 0) + 1;

    quotaData.lastRequest = {
      endpoint,
      timestamp: new Date().toISOString(),
      responseSize,
      keyUsed: keyIndex,
    };

    // Keep last 20 requests in history
    quotaData.history.unshift({
      endpoint,
      timestamp: new Date().toISOString(),
      day: dayKey,
      keyUsed: keyIndex,
    });
    if (quotaData.history.length > 20) {
      quotaData.history = quotaData.history.slice(0, 20);
    }

    // Store for 35 days (covers full month + buffer)
    await setCache(quotaKey, quotaData, 3024000);

    // Log warning if approaching limit (per combined total)
    const keys = getApiKeys();
    const totalLimit = RAPIDAPI_MONTHLY_LIMIT * keys.length;
    const remaining = totalLimit - quotaData.monthlyCount;
    if (remaining <= 50) {
      console.warn(
        `⚠️ RapidAPI quota warning: ${remaining} requests remaining across ${keys.length} keys this month!`
      );
    }
  } catch (error) {
    console.error("Failed to track RapidAPI usage:", error.message);
    // Don't throw - tracking failure shouldn't break the request
  }
};

/**
 * Get current RapidAPI quota status (multi-key aware)
 * @returns {Promise<object>} Quota status
 */
const getRapidAPIQuota = async () => {
  try {
    const keys = getApiKeys();
    const totalLimit = RAPIDAPI_MONTHLY_LIMIT * keys.length;
    const quotaData = await getCache("rapidapi:quota");

    if (!quotaData) {
      return {
        keysConfigured: keys.length,
        activeKeyIndex: currentKeyIndex + 1,
        monthlyUsed: 0,
        monthlyLimitPerKey: RAPIDAPI_MONTHLY_LIMIT,
        totalMonthlyLimit: totalLimit,
        monthlyRemaining: totalLimit,
        dailyUsed: 0,
        percentUsed: 0,
        currentMonth: getMonthKey(),
        perKeyUsage: {},
        lastRequest: null,
        history: [],
      };
    }

    // Check if we need to reset for new month/day
    const currentMonth = getMonthKey();
    const currentDay = getDayKey();
    const monthlyCount =
      quotaData.currentMonth === currentMonth ? quotaData.monthlyCount : 0;
    const dailyCount =
      quotaData.currentDay === currentDay ? quotaData.dailyCount : 0;

    return {
      keysConfigured: keys.length,
      activeKeyIndex: currentKeyIndex + 1,
      monthlyUsed: monthlyCount,
      monthlyLimitPerKey: RAPIDAPI_MONTHLY_LIMIT,
      totalMonthlyLimit: totalLimit,
      monthlyRemaining: totalLimit - monthlyCount,
      dailyUsed: dailyCount,
      totalAllTime: quotaData.totalCount || 0,
      bandwidthMB: (quotaData.bandwidthMB || 0).toFixed(2),
      percentUsed: ((monthlyCount / totalLimit) * 100).toFixed(1),
      currentMonth,
      currentDay,
      perKeyUsage: quotaData.perKeyUsage || {},
      lastRequest: quotaData.lastRequest,
      recentHistory: (quotaData.history || []).slice(0, 10),
    };
  } catch (error) {
    console.error("Failed to get RapidAPI quota:", error.message);
    return { error: "Failed to retrieve quota data" };
  }
};

/**
 * Make a request to the Cricbuzz RapidAPI with automatic key rotation
 * @param {string} endpoint - API endpoint path
 * @param {object} params - Query parameters
 * @param {number} retryCount - Internal: number of retries attempted
 * @returns {Promise<object>} API response data
 */
const makeRequest = async (endpoint, params = {}, retryCount = 0) => {
  const keys = getApiKeys();
  const maxRetries = keys.length; // Try each key once

  const apiKey = getCurrentApiKey();
  if (!apiKey) {
    throw new Error("No RAPIDAPI_CRICBUZZ_KEY environment variables are set");
  }

  try {
    const response = await axios.get(`${RAPIDAPI_BASE_URL}${endpoint}`, {
      headers: getHeaders(apiKey),
      params,
      timeout: 15000,
    });

    // Track usage after successful request (include key index)
    const responseSize = JSON.stringify(response.data).length;
    await trackRapidAPIUsage(endpoint, responseSize, currentKeyIndex + 1);

    return response.data;
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      const message = error.response.data?.message || error.message;

      // On rate limit (429) or quota exceeded, try next key
      if (status === 429) {
        if (retryCount < maxRetries - 1 && switchToNextKey()) {
          console.log(`⚠️ Rate limit hit on key ${currentKeyIndex}. Retrying with next key...`);
          return makeRequest(endpoint, params, retryCount + 1);
        }
        throw new Error(
          `Rate limit exceeded on all ${keys.length} API keys. Please try again later.`
        );
      }

      if (status === 401 || status === 403) {
        // Auth failed - try next key
        if (retryCount < maxRetries - 1 && switchToNextKey()) {
          console.log(`⚠️ Auth failed on key ${currentKeyIndex}. Trying next key...`);
          return makeRequest(endpoint, params, retryCount + 1);
        }
        throw new Error(`RapidAPI authentication failed: ${message}`);
      }

      if (status >= 500) {
        throw new Error(`Cricbuzz API is temporarily unavailable: ${message}`);
      }
      throw new Error(`API request failed (${status}): ${message}`);
    }
    if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
      throw new Error("Request to Cricbuzz API timed out. Please try again.");
    }
    throw error;
  }
};

/**
 * Fetch ICC rankings
 * @param {string} category - batsmen, bowlers, allrounders, or teams
 * @param {string} formatType - test, odi, or t20
 * @returns {Promise<object>} Rankings data
 */
const fetchRankings = async (category, formatType) => {
  const validCategories = ["batsmen", "bowlers", "allrounders", "teams"];
  const validFormats = ["test", "odi", "t20"];

  if (!validCategories.includes(category)) {
    throw new Error(
      `Invalid category. Must be one of: ${validCategories.join(", ")}`
    );
  }
  if (!validFormats.includes(formatType)) {
    throw new Error(
      `Invalid formatType. Must be one of: ${validFormats.join(", ")}`
    );
  }

  return makeRequest(`/stats/v1/rankings/${category}`, { formatType });
};

/**
 * Fetch ICC standings (World Test Championship, etc.)
 * @param {number|string} matchType - 1 for World Test Championship, etc.
 * @returns {Promise<object>} Standings data
 */
const fetchStandings = async (matchType) => {
  const typeStr = String(matchType || 1);
  // Endpoint: /stats/v1/iccstanding/team/matchtype/{matchType}
  return makeRequest(`/stats/v1/iccstanding/team/matchtype/${typeStr}`);
};

/**
 * Fetch top stats categories (record filter options)
 * @returns {Promise<object>} Available stats types
 */
const fetchRecordFilters = async () => {
  // Endpoint: /stats/v1/topstats
  return makeRequest("/stats/v1/topstats");
};

/**
 * Fetch cricket records/stats
 * @param {string} statsType - Stats type (e.g., 'mostRuns', 'mostWickets')
 * @param {string|number} id - Stats ID (default: 0)
 * @returns {Promise<object>} Records data
 */
const fetchRecords = async (statsType, id = 0) => {
  if (!statsType) {
    throw new Error(
      "statsType is required. Use /stats/record-filters to get available types."
    );
  }
  // Endpoint: /stats/v1/topstats/{id}?statsType={statsType}
  return makeRequest(`/stats/v1/topstats/${id}`, { statsType });
};

// ============================================
// ROBUST CACHING LAYER - QUOTA PROTECTION
// ============================================

// Cache TTLs in seconds - stats data changes infrequently
const CACHE_TTL = {
  RANKINGS: 7 * 24 * 60 * 60,      // 7 days - rankings update weekly
  STANDINGS: 7 * 24 * 60 * 60,     // 7 days - standings update after matches
  RECORD_FILTERS: 30 * 24 * 60 * 60, // 30 days - rarely changes
  RECORDS: 3 * 24 * 60 * 60,       // 3 days - records update less frequently
  STALE_BACKUP: 90 * 24 * 60 * 60, // 90 days - never-expire backup
};

/**
 * Cache-first fetch with background refresh
 * Returns cached data immediately if available, fetches fresh data in background
 * @param {string} cacheKey - Redis cache key
 * @param {Function} fetchFn - Function to fetch fresh data
 * @param {number} ttl - Cache TTL in seconds
 * @param {object} options - Additional options
 * @returns {Promise<object>} Data with cache metadata
 */
const cachedFetch = async (cacheKey, fetchFn, ttl, options = {}) => {
  const staleKey = `${cacheKey}:stale`; // Never-expire backup

  try {
    // 1. Check primary cache first
    const cached = await getCache(cacheKey);
    if (cached) {
      console.log(`✅ Cache hit: ${cacheKey}`);
      return {
        data: cached.data || cached,
        cached: true,
        stale: false,
        cacheAge: cached.timestamp ? getAgeString(cached.timestamp) : 'unknown',
      };
    }

    // 2. Check stale backup cache
    const staleCache = await getCache(staleKey);

    // 3. Check if we should skip API call (quota protection)
    const quota = await getRapidAPIQuota();
    const quotaExhausted = quota.monthlyRemaining <= 10; // Reserve 10 for emergencies

    if (quotaExhausted && staleCache) {
      console.log(`⚠️ Quota low (${quota.monthlyRemaining}), returning stale cache: ${cacheKey}`);
      return {
        data: staleCache.data || staleCache,
        cached: true,
        stale: true,
        cacheAge: staleCache.timestamp ? getAgeString(staleCache.timestamp) : 'unknown',
        quotaProtection: true,
      };
    }

    // 4. Fetch fresh data from API
    console.log(`🔄 Fetching fresh data: ${cacheKey}`);
    const freshData = await fetchFn();

    // 5. Store in both primary and stale backup cache
    const cachePayload = {
      data: freshData,
      timestamp: new Date().toISOString(),
      source: 'rapidapi',
    };

    await Promise.all([
      setCache(cacheKey, cachePayload, ttl),
      setCache(staleKey, cachePayload, CACHE_TTL.STALE_BACKUP), // Never-expire backup
    ]);

    return {
      data: freshData,
      cached: false,
      stale: false,
    };

  } catch (error) {
    // 6. On error, return stale cache if available
    console.error(`❌ Fetch error for ${cacheKey}:`, error.message);

    const staleCache = await getCache(staleKey);
    if (staleCache) {
      console.log(`🔙 Returning stale cache after error: ${cacheKey}`);
      return {
        data: staleCache.data || staleCache,
        cached: true,
        stale: true,
        cacheAge: staleCache.timestamp ? getAgeString(staleCache.timestamp) : 'unknown',
        error_fallback: true,
        original_error: error.message,
      };
    }

    throw error; // No cache fallback available
  }
};

/**
 * Get human-readable age string from timestamp
 */
const getAgeString = (timestamp) => {
  const ageMs = Date.now() - new Date(timestamp).getTime();
  const hours = Math.floor(ageMs / (1000 * 60 * 60));
  if (hours < 1) return 'less than 1 hour';
  if (hours < 24) return `${hours} hours`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? 's' : ''}`;
};

// ============================================
// CACHED FETCH WRAPPERS
// ============================================

/**
 * Cached version of fetchRankings
 */
const cachedFetchRankings = async (category, formatType) => {
  const cacheKey = `cricket:stats:rankings:${category}:${formatType}`;
  return cachedFetch(
    cacheKey,
    () => fetchRankings(category, formatType),
    CACHE_TTL.RANKINGS
  );
};

/**
 * Cached version of fetchStandings
 */
const cachedFetchStandings = async (matchType) => {
  const cacheKey = `cricket:stats:standings:${matchType}`;
  return cachedFetch(
    cacheKey,
    () => fetchStandings(matchType),
    CACHE_TTL.STANDINGS
  );
};

/**
 * Cached version of fetchRecordFilters
 */
const cachedFetchRecordFilters = async () => {
  const cacheKey = `cricket:stats:record-filters`;
  return cachedFetch(
    cacheKey,
    () => fetchRecordFilters(),
    CACHE_TTL.RECORD_FILTERS
  );
};

/**
 * Cached version of fetchRecords
 */
const cachedFetchRecords = async (statsType, id = 0) => {
  const cacheKey = `cricket:stats:records:${statsType}:${id}`;
  return cachedFetch(
    cacheKey,
    () => fetchRecords(statsType, id),
    CACHE_TTL.RECORDS
  );
};

// NOTE: Photo functions (fetchPhotosList, fetchPhotoGallery, fetchImage) have been 
// moved to scrapers/cricbuzz-photos-scraper.js which uses direct Cheerio scraping
// instead of RapidAPI, saving API quota for stats/rankings only.

module.exports = {
  // Original functions (direct API calls - use sparingly)
  fetchRankings,
  fetchStandings,
  fetchRecordFilters,
  fetchRecords,

  // Cached versions (use these by default)
  cachedFetchRankings,
  cachedFetchStandings,
  cachedFetchRecordFilters,
  cachedFetchRecords,

  // Quota and utilities
  getRapidAPIQuota,
  CACHE_TTL,
};
