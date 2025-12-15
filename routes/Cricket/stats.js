/**
 * Cricket Stats Module - RapidAPI Cricbuzz Integration
 * 
 * Provides functions to fetch ICC rankings, standings, and records
 * from the Cricbuzz RapidAPI.
 */

const axios = require("axios");

// RapidAPI configuration
const RAPIDAPI_BASE_URL = "https://cricbuzz-cricket.p.rapidapi.com";
const getHeaders = () => ({
  "x-rapidapi-host": process.env.RAPIDAPI_CRICBUZZ_HOST || "cricbuzz-cricket.p.rapidapi.com",
  "x-rapidapi-key": process.env.RAPIDAPI_CRICBUZZ_KEY,
});

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
        throw new Error("Rate limit exceeded on RapidAPI. Please try again later.");
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
    throw new Error(`Invalid category. Must be one of: ${validCategories.join(", ")}`);
  }
  if (!validFormats.includes(formatType)) {
    throw new Error(`Invalid formatType. Must be one of: ${validFormats.join(", ")}`);
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
    throw new Error("statsType is required. Use /stats/record-filters to get available types.");
  }
  // Endpoint: /stats/v1/topstats/{id}?statsType={statsType}
  return makeRequest(`/stats/v1/topstats/${id}`, { statsType });
};

module.exports = {
  fetchRankings,
  fetchStandings,
  fetchRecordFilters,
  fetchRecords,
};
