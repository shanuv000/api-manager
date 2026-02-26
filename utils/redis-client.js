/**
 * Local Redis Client (ioredis)
 * TCP connection to local Redis for live score caching
 * and O(1) match index for direct match lookups
 */

require("dotenv").config();
const Redis = require("ioredis");

const DEBUG = process.env.NODE_ENV !== 'production';

// Redis key constants
const KEYS = {
  LIVE_SCORES: "live_scores_cache",
  LIVE_SCORES_LITE: "live_scores_lite",
  WORKER_STATUS: "live_scores_worker_status",
  SCORECARD_PREFIX: "scorecard:",
  COMMENTARY_PREFIX: "commentary:",
  MATCH_INDEX_PREFIX: "match:",
};

// Source priority for match index (higher = fresher data)
const SOURCE_PRIORITY = { live: 3, recent: 2, upcoming: 1 };

// Lua script for conditional SET with priority protection
// Atomically checks existing entry's priority before overwriting
// Prevents stale data (e.g., upcoming) from overwriting fresh data (e.g., live)
const MATCH_INDEX_LUA = `
local key = KEYS[1]
local newData = ARGV[1]
local newPriority = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])

local existing = redis.call('GET', key)
if existing then
  local ok, decoded = pcall(cjson.decode, existing)
  if ok and decoded._meta and decoded._meta.priority then
    local existingPriority = tonumber(decoded._meta.priority)
    if existingPriority > newPriority then
      local remainingTTL = redis.call('TTL', key)
      if remainingTTL > 0 then
        return 0
      end
    end
  end
end

redis.call('SET', key, newData, 'EX', ttl)
return 1
`;

// TTL in seconds (90s to allow 60s refresh cycle + buffer)
const DEFAULT_TTL = 90;

// Singleton instance
let redisClient = null;

/**
 * Get or create Redis client instance
 * @returns {Redis|null} Redis client or null if connection failed
 */
function getClient() {
  if (redisClient) return redisClient;

  try {
    redisClient = new Redis({
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

    redisClient.on("error", (err) => {
      console.error("❌ Redis connection error:", err.message);
    });

    redisClient.on("connect", () => {
      console.log("✅ Connected to local Redis (127.0.0.1:6379)");
    });

    // Register Lua script for match index priority protection
    redisClient.defineCommand("setMatchIndex", {
      numberOfKeys: 1,
      lua: MATCH_INDEX_LUA,
    });

    redisClient.connect().catch(() => {
      // Silently handle — retryStrategy handles reconnection
    });

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
      if (DEBUG) console.log("✅ Redis HIT: live_scores_cache");
      return JSON.parse(cached);
    }
    if (DEBUG) console.log("❌ Redis MISS: live_scores_cache");
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
    await client.set(KEYS.LIVE_SCORES, JSON.stringify(payload), "EX", ttl);
    if (DEBUG) console.log(
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
      JSON.stringify({
        ...status,
        timestamp: Date.now(),
      }),
      "EX",
      300
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
    const data = await client.get(KEYS.WORKER_STATUS);
    return data ? JSON.parse(data) : null;
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
      return JSON.parse(cached);
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
    await client.set(key, JSON.stringify(data), "EX", ttl);
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
      if (DEBUG) console.log("✅ Redis HIT: live_scores_lite");
      return JSON.parse(cached);
    }
    if (DEBUG) console.log("❌ Redis MISS: live_scores_lite");
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
    await client.set(KEYS.LIVE_SCORES_LITE, JSON.stringify(payload), "EX", ttl);
    if (DEBUG) console.log(
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
      return JSON.parse(cached);
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
    await client.set(key, JSON.stringify(data), "EX", ttl);
    return true;
  } catch (error) {
    console.error(`Redis SET commentary error (${matchId}):`, error.message);
    return false;
  }
}

/**
 * Extract matchId from a Cricbuzz matchLink URL
 * @param {Object} match - Match object with matchLink or matchId
 * @returns {string|null} - Extracted matchId or null
 */
function extractMatchId(match) {
  if (match.matchId) return match.matchId.toString();
  if (match.matchLink) {
    const idMatch = match.matchLink.match(/\/(\d+)\//);
    return idMatch ? idMatch[1] : null;
  }
  return null;
}

/**
 * Get a single match from the index
 * O(1) Redis GET — ~0.17ms verified
 * @param {string} matchId
 * @returns {Promise<Object|null>}
 */
async function getMatchIndex(matchId) {
  const client = getClient();
  if (!client) return null;

  try {
    const key = `${KEYS.MATCH_INDEX_PREFIX}${matchId}`;
    const cached = await client.get(key);
    if (cached) {
      if (DEBUG) console.log(`✅ Match index HIT: ${matchId}`);
      return JSON.parse(cached);
    }
    if (DEBUG) console.log(`❌ Match index MISS: ${matchId}`);
    return null;
  } catch (error) {
    console.error(`Redis GET match index error (${matchId}):`, error.message);
    return null;
  }
}

/**
 * Batch-index matches using Lua-in-Pipeline for atomic priority protection
 * ~1.34ms for 40 matches (verified benchmark)
 * @param {Array} matches - Array of match objects
 * @param {string} source - 'live', 'recent', or 'upcoming'
 * @param {number} ttl - TTL in seconds
 * @returns {Promise<number>} - Number of matches indexed
 */
async function setMatchIndexBatch(matches, source, ttl) {
  const client = getClient();
  if (!client || !matches || matches.length === 0) return 0;

  const priority = SOURCE_PRIORITY[source] || 1;

  try {
    const pipe = client.pipeline();
    let count = 0;

    for (const match of matches) {
      const matchId = extractMatchId(match);
      if (!matchId) continue;

      // Strip scorecard to keep index entries small (~1-2KB)
      const { scorecard, ...liteMatch } = match;
      const entry = {
        ...liteMatch,
        matchId,
        _meta: {
          source,
          priority,
          indexedAt: Date.now(),
        },
      };

      const key = `${KEYS.MATCH_INDEX_PREFIX}${matchId}`;
      pipe.setMatchIndex(key, JSON.stringify(entry), priority, ttl);
      count++;
    }

    if (count > 0) {
      await pipe.exec();
    }

    if (DEBUG) console.log(`🔑 Indexed ${count} matches (source: ${source}, TTL: ${ttl}s)`);
    return count;
  } catch (error) {
    console.error(`Redis match index batch error (${source}):`, error.message);
    return 0;
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
  getMatchIndex,
  setMatchIndexBatch,
  extractMatchId,
  KEYS,
  DEFAULT_TTL,
  SOURCE_PRIORITY,
};
