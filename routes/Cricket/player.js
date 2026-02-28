/**
 * Cricket Player Profile Module - RapidAPI Cricbuzz Integration
 *
 * Provides an aggregated player profile endpoint that fetches info, batting,
 * and bowling stats in a single request using Promise.allSettled for resilience.
 *
 * Uses the same cachedFetch infrastructure from stats.js for:
 * - Redis caching with namespaced keys (cricket:player:{id}:*)
 * - Quota protection (stale fallback when quota is low)
 * - Stale backup (90-day never-expire copies)
 */

const axios = require("axios");
const { getCache, setCache } = require("../../component/redisClient");

// Reuse RapidAPI infrastructure from stats module
const RAPIDAPI_BASE_URL = "https://cricbuzz-cricket.p.rapidapi.com";
const RAPIDAPI_HOST =
    process.env.RAPIDAPI_CRICBUZZ_HOST || "cricbuzz-cricket.p.rapidapi.com";

// Import shared utilities from stats module
const { getRapidAPIQuota, CACHE_TTL: STATS_CACHE_TTL } = require("./stats");

// ============================================
// API KEY MANAGEMENT (mirrors stats.js)
// ============================================

const getApiKeys = () => {
    const keys = [];
    if (process.env.RAPIDAPI_CRICBUZZ_KEY)
        keys.push(process.env.RAPIDAPI_CRICBUZZ_KEY);
    if (process.env.RAPIDAPI_CRICBUZZ_KEY2)
        keys.push(process.env.RAPIDAPI_CRICBUZZ_KEY2);
    if (process.env.RAPIDAPI_CRICBUZZ_KEY3)
        keys.push(process.env.RAPIDAPI_CRICBUZZ_KEY3);
    if (process.env.RAPIDAPI_CRICBUZZ_KEY4)
        keys.push(process.env.RAPIDAPI_CRICBUZZ_KEY4);
    if (process.env.RAPIDAPI_CRICBUZZ_KEY5)
        keys.push(process.env.RAPIDAPI_CRICBUZZ_KEY5);
    return keys;
};

let currentKeyIndex = 0;

const getCurrentApiKey = () => {
    const keys = getApiKeys();
    if (keys.length === 0) return null;
    return keys[currentKeyIndex % keys.length];
};

const switchToNextKey = () => {
    const keys = getApiKeys();
    if (keys.length <= 1) return false;
    currentKeyIndex = (currentKeyIndex + 1) % keys.length;
    return true;
};

const getHeaders = (apiKey) => ({
    "x-rapidapi-key": apiKey,
    "x-rapidapi-host": RAPIDAPI_HOST,
});

// ============================================
// PLAYER-SPECIFIC CACHE TTLs
// ============================================

const CACHE_TTL = {
    PLAYER_INFO: 7 * 24 * 60 * 60, // 7 days — bio rarely changes
    PLAYER_BATTING: 48 * 60 * 60, // 48 hours — updates after matches
    PLAYER_BOWLING: 48 * 60 * 60, // 48 hours — updates after matches
    STALE_BACKUP: 90 * 24 * 60 * 60, // 90 days — never-expire fallback
};

// ============================================
// RAW API FETCH FUNCTIONS
// ============================================

/**
 * Make a request to the Cricbuzz RapidAPI with automatic key rotation
 */
const makeRequest = async (endpoint, params = {}, retryCount = 0) => {
    const keys = getApiKeys();
    const maxRetries = keys.length;

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

        return response.data;
    } catch (error) {
        if (error.response) {
            const status = error.response.status;
            const message = error.response.data?.message || error.message;

            if (status === 429) {
                if (retryCount < maxRetries - 1 && switchToNextKey()) {
                    console.log(
                        `⚠️ [Player] Rate limit on key ${currentKeyIndex}. Retrying...`
                    );
                    return makeRequest(endpoint, params, retryCount + 1);
                }
                throw new Error(
                    `Rate limit exceeded on all ${keys.length} API keys.`
                );
            }

            if (status === 401 || status === 403) {
                if (retryCount < maxRetries - 1 && switchToNextKey()) {
                    console.log(
                        `⚠️ [Player] Auth failed on key ${currentKeyIndex}. Trying next...`
                    );
                    return makeRequest(endpoint, params, retryCount + 1);
                }
                throw new Error(`RapidAPI authentication failed: ${message}`);
            }

            if (status >= 500) {
                throw new Error(
                    `Cricbuzz API is temporarily unavailable: ${message}`
                );
            }
            throw new Error(`API request failed (${status}): ${message}`);
        }
        if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
            throw new Error("Request to Cricbuzz API timed out.");
        }
        throw error;
    }
};

// Individual fetch functions
const fetchPlayerInfo = async (playerId) => {
    return makeRequest(`/stats/v1/player/${playerId}`);
};

const fetchPlayerBatting = async (playerId) => {
    return makeRequest(`/stats/v1/player/${playerId}/batting`);
};

const fetchPlayerBowling = async (playerId) => {
    return makeRequest(`/stats/v1/player/${playerId}/bowling`);
};

// ============================================
// CACHED FETCH (matches stats.js pattern exactly)
// ============================================

/**
 * Get human-readable age string from timestamp
 */
const getAgeString = (timestamp) => {
    const ageMs = Date.now() - new Date(timestamp).getTime();
    const hours = Math.floor(ageMs / (1000 * 60 * 60));
    if (hours < 1) return "less than 1 hour";
    if (hours < 24) return `${hours} hours`;
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? "s" : ""}`;
};

/**
 * Cache-first fetch with stale backup and quota protection
 * Identical pattern to stats.js cachedFetch
 */
const cachedFetch = async (cacheKey, fetchFn, ttl) => {
    const staleKey = `${cacheKey}:stale`;

    try {
        // 1. Check primary cache
        const cached = await getCache(cacheKey);
        if (cached) {
            console.log(`✅ [Player] Cache hit: ${cacheKey}`);
            return {
                data: cached.data || cached,
                cached: true,
                stale: false,
                cacheAge: cached.timestamp
                    ? getAgeString(cached.timestamp)
                    : "unknown",
            };
        }

        // 2. Check stale backup
        const staleCache = await getCache(staleKey);

        // 3. Quota protection
        const quota = await getRapidAPIQuota();
        const quotaExhausted = quota.monthlyRemaining <= 10;

        if (quotaExhausted && staleCache) {
            console.log(
                `⚠️ [Player] Quota low (${quota.monthlyRemaining}), returning stale: ${cacheKey}`
            );
            return {
                data: staleCache.data || staleCache,
                cached: true,
                stale: true,
                cacheAge: staleCache.timestamp
                    ? getAgeString(staleCache.timestamp)
                    : "unknown",
                quotaProtection: true,
            };
        }

        // 4. Fetch fresh
        console.log(`🔄 [Player] Fetching fresh: ${cacheKey}`);
        const freshData = await fetchFn();

        // 5. Store in primary + stale backup
        const cachePayload = {
            data: freshData,
            timestamp: new Date().toISOString(),
            source: "rapidapi",
        };

        await Promise.all([
            setCache(cacheKey, cachePayload, ttl),
            setCache(staleKey, cachePayload, CACHE_TTL.STALE_BACKUP),
        ]);

        return {
            data: freshData,
            cached: false,
            stale: false,
        };
    } catch (error) {
        // 6. On error, return stale if available
        console.error(`❌ [Player] Fetch error for ${cacheKey}:`, error.message);

        const staleCache = await getCache(staleKey);
        if (staleCache) {
            console.log(
                `🔙 [Player] Returning stale cache after error: ${cacheKey}`
            );
            return {
                data: staleCache.data || staleCache,
                cached: true,
                stale: true,
                cacheAge: staleCache.timestamp
                    ? getAgeString(staleCache.timestamp)
                    : "unknown",
                error_fallback: true,
                original_error: error.message,
            };
        }

        throw error; // No cache fallback available
    }
};

// ============================================
// AGGREGATED PLAYER PROFILE
// ============================================

/**
 * Fetch a complete player profile using Promise.allSettled.
 * Returns partial data if one or two sub-requests fail.
 *
 * @param {string|number} playerId - Cricbuzz player ID
 * @returns {Promise<object>} Aggregated profile with info, batting, bowling
 */
const fetchPlayerProfile = async (playerId) => {
    const id = String(playerId);

    // Validate ID is numeric
    if (!/^\d+$/.test(id)) {
        throw new Error("Player ID must be a numeric value");
    }

    // Redis keys — namespaced under cricket:player:{id}:*
    const infoKey = `cricket:player:${id}:info`;
    const battingKey = `cricket:player:${id}:batting`;
    const bowlingKey = `cricket:player:${id}:bowling`;

    // Fire all three in parallel with individual caching + quota protection
    const [infoResult, battingResult, bowlingResult] = await Promise.allSettled([
        cachedFetch(infoKey, () => fetchPlayerInfo(id), CACHE_TTL.PLAYER_INFO),
        cachedFetch(
            battingKey,
            () => fetchPlayerBatting(id),
            CACHE_TTL.PLAYER_BATTING
        ),
        cachedFetch(
            bowlingKey,
            () => fetchPlayerBowling(id),
            CACHE_TTL.PLAYER_BOWLING
        ),
    ]);

    // Extract data or null for each section
    const extractResult = (settled) => {
        if (settled.status === "fulfilled") {
            return {
                data: settled.value.data,
                cached: settled.value.cached,
                stale: settled.value.stale || false,
                cacheAge: settled.value.cacheAge,
            };
        }
        return {
            data: null,
            error: settled.reason?.message || "Unknown error",
            cached: false,
            stale: false,
        };
    };

    const info = extractResult(infoResult);
    const batting = extractResult(battingResult);
    const bowling = extractResult(bowlingResult);

    // At least info must succeed for a meaningful profile
    const hasInfo = info.data !== null;
    const hasBatting = batting.data !== null;
    const hasBowling = bowling.data !== null;

    return {
        playerId: id,
        info: info.data,
        batting: batting.data,
        bowling: bowling.data,
        _meta: {
            infoStatus: hasInfo ? "ok" : "error",
            battingStatus: hasBatting ? "ok" : "error",
            bowlingStatus: hasBowling ? "ok" : "error",
            infoCached: info.cached,
            battingCached: batting.cached,
            bowlingCached: bowling.cached,
            infoStale: info.stale,
            battingStale: batting.stale,
            bowlingStale: bowling.stale,
            infoCacheAge: info.cacheAge,
            battingCacheAge: batting.cacheAge,
            bowlingCacheAge: bowling.cacheAge,
            partial: !(hasInfo && hasBatting && hasBowling),
            errors: [
                ...(info.error ? [`info: ${info.error}`] : []),
                ...(batting.error ? [`batting: ${batting.error}`] : []),
                ...(bowling.error ? [`bowling: ${bowling.error}`] : []),
            ],
        },
    };
};

module.exports = {
    fetchPlayerProfile,
    CACHE_TTL,
};
