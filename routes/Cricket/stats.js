/**
 * Cricket Stats Module - RapidAPI Cricbuzz Integration
 *
 * Provides functions to fetch ICC rankings, standings, and records
 * from the Cricbuzz RapidAPI.
 */

const axios = require("axios");
const { getCache, setCache } = require("../../component/redisClient");

// RapidAPI configuration
const RAPIDAPI_BASE_URL = "https://cricbuzz-cricket.p.rapidapi.com";
const RAPIDAPI_MONTHLY_LIMIT = 200; // Free tier limit

const getHeaders = () => ({
  "x-rapidapi-host":
    process.env.RAPIDAPI_CRICBUZZ_HOST || "cricbuzz-cricket.p.rapidapi.com",
  "x-rapidapi-key": process.env.RAPIDAPI_CRICBUZZ_KEY,
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
 */
const trackRapidAPIUsage = async (endpoint, responseSize = 0) => {
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
      };
    }

    // Reset monthly count if new month
    if (quotaData.currentMonth !== monthKey) {
      quotaData.monthlyCount = 0;
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
    quotaData.lastRequest = {
      endpoint,
      timestamp: new Date().toISOString(),
      responseSize,
    };

    // Keep last 20 requests in history
    quotaData.history.unshift({
      endpoint,
      timestamp: new Date().toISOString(),
      day: dayKey,
    });
    if (quotaData.history.length > 20) {
      quotaData.history = quotaData.history.slice(0, 20);
    }

    // Store for 35 days (covers full month + buffer)
    await setCache(quotaKey, quotaData, 3024000);

    // Log warning if approaching limit
    const remaining = RAPIDAPI_MONTHLY_LIMIT - quotaData.monthlyCount;
    if (remaining <= 20) {
      console.warn(
        `⚠️ RapidAPI quota warning: ${remaining} requests remaining this month!`
      );
    }
  } catch (error) {
    console.error("Failed to track RapidAPI usage:", error.message);
    // Don't throw - tracking failure shouldn't break the request
  }
};

/**
 * Get current RapidAPI quota status
 * @returns {Promise<object>} Quota status
 */
const getRapidAPIQuota = async () => {
  try {
    const quotaData = await getCache("rapidapi:quota");
    if (!quotaData) {
      return {
        monthlyUsed: 0,
        monthlyLimit: RAPIDAPI_MONTHLY_LIMIT,
        monthlyRemaining: RAPIDAPI_MONTHLY_LIMIT,
        dailyUsed: 0,
        percentUsed: 0,
        currentMonth: getMonthKey(),
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
      monthlyUsed: monthlyCount,
      monthlyLimit: RAPIDAPI_MONTHLY_LIMIT,
      monthlyRemaining: RAPIDAPI_MONTHLY_LIMIT - monthlyCount,
      dailyUsed: dailyCount,
      totalAllTime: quotaData.totalCount || 0,
      bandwidthMB: (quotaData.bandwidthMB || 0).toFixed(2),
      percentUsed: ((monthlyCount / RAPIDAPI_MONTHLY_LIMIT) * 100).toFixed(1),
      currentMonth,
      currentDay,
      lastRequest: quotaData.lastRequest,
      recentHistory: (quotaData.history || []).slice(0, 10),
    };
  } catch (error) {
    console.error("Failed to get RapidAPI quota:", error.message);
    return { error: "Failed to retrieve quota data" };
  }
};

/**
 * Make a request to the Cricbuzz RapidAPI
 * @param {string} endpoint - API endpoint path
 * @param {object} params - Query parameters
 * @returns {Promise<object>} API response data
 */
const makeRequest = async (endpoint, params = {}) => {
  const apiKey = process.env.RAPIDAPI_CRICBUZZ_KEY;

  if (!apiKey) {
    throw new Error("RAPIDAPI_CRICBUZZ_KEY environment variable is not set");
  }

  try {
    const response = await axios.get(`${RAPIDAPI_BASE_URL}${endpoint}`, {
      headers: getHeaders(),
      params,
      timeout: 15000,
    });

    // Track usage after successful request
    const responseSize = JSON.stringify(response.data).length;
    await trackRapidAPIUsage(endpoint, responseSize);

    return response.data;
  } catch (error) {
    if (error.response) {
      // API returned an error response
      const status = error.response.status;
      const message = error.response.data?.message || error.message;

      if (status === 401 || status === 403) {
        throw new Error(`RapidAPI authentication failed: ${message}`);
      }
      if (status === 429) {
        throw new Error(
          "Rate limit exceeded on RapidAPI. Please try again later."
        );
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

/**
 * Fetch list of photo galleries
 * @returns {Promise<object>} List of photo galleries
 */
const fetchPhotosList = async () => {
  // Endpoint: /photos/v1/index
  return makeRequest("/photos/v1/index");
};

/**
 * Fetch specific photo gallery details
 * @param {string|number} galleryId - Gallery ID to fetch
 * @returns {Promise<object>} Gallery details with photos
 */
const fetchPhotoGallery = async (galleryId) => {
  if (!galleryId) {
    throw new Error("galleryId is required");
  }
  // Endpoint: /photos/v1/detail/{galleryId}
  return makeRequest(`/photos/v1/detail/${galleryId}`);
};

/**
 * Fetch image from Cricbuzz
 * @param {string} imagePath - Image path (e.g., 'i1/c231889/i.jpg')
 * @returns {Promise<object>} Image data as buffer with content type
 */
const fetchImage = async (imagePath) => {
  if (!imagePath) {
    throw new Error("imagePath is required");
  }

  const apiKey = process.env.RAPIDAPI_CRICBUZZ_KEY;

  if (!apiKey) {
    throw new Error("RAPIDAPI_CRICBUZZ_KEY environment variable is not set");
  }

  try {
    const response = await axios.get(
      `${RAPIDAPI_BASE_URL}/img/v1/${imagePath}`,
      {
        headers: getHeaders(),
        responseType: "arraybuffer",
        timeout: 30000,
      }
    );
    return {
      data: response.data,
      contentType: response.headers["content-type"] || "image/jpeg",
    };
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      const message = error.response.data?.message || error.message;

      if (status === 401 || status === 403) {
        throw new Error(`RapidAPI authentication failed: ${message}`);
      }
      if (status === 429) {
        throw new Error(
          "Rate limit exceeded on RapidAPI. Please try again later."
        );
      }
      if (status === 404) {
        throw new Error(`Image not found: ${imagePath}`);
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

module.exports = {
  fetchRankings,
  fetchStandings,
  fetchRecordFilters,
  fetchRecords,
  fetchPhotosList,
  fetchPhotoGallery,
  fetchImage,
  getRapidAPIQuota,
};
