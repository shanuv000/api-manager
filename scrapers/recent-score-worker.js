/**
 * Recent Score Background Worker
 *
 * Refreshes the recent-scores cache every 15 minutes by calling
 * the api-manager's own /recent-scores endpoint. This eliminates
 * the 2.49s cold-start scrape on cache miss.
 *
 * The /recent-scores endpoint handler (routes/Cricket/index.js)
 * already handles scraping, enrichment, caching, AND match index
 * population — this worker just ensures the cache never expires.
 *
 * Usage:
 *   node scrapers/recent-score-worker.js
 *
 * For production (PM2):
 *   pm2 start scrapers/recent-score-worker.js --name "recent-score-worker"
 */

require("dotenv").config();
const axios = require("axios");

const CONFIG = {
    REFRESH_INTERVAL_MS: 15 * 60 * 1000, // 15 minutes
    API_BASE: "http://127.0.0.1:5003/api/cricket",
    REQUEST_TIMEOUT: 30000, // 30s timeout (scraping can be slow)
};

let iterationCount = 0;
let isRunning = false;
let lastSuccess = null;
let consecutiveErrors = 0;

/**
 * Refresh the recent-scores cache by calling the API endpoint
 * This triggers a cache-miss scrape if the cache has expired,
 * which also populates the match index.
 */
async function refreshRecentScores() {
    const startTime = Date.now();
    iterationCount++;

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🔄 Recent Scores - Iteration #${iterationCount} - ${new Date().toISOString()}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    try {
        // Call the recent-scores endpoint to trigger cache refresh
        const response = await axios.get(`${CONFIG.API_BASE}/recent-scores`, {
            timeout: CONFIG.REQUEST_TIMEOUT,
            params: { limit: 30 },
        });

        const duration = Date.now() - startTime;
        const matchCount = response.data?.count || 0;

        console.log(`✅ Refreshed ${matchCount} recent matches in ${duration}ms`);

        lastSuccess = {
            iteration: iterationCount,
            matchCount,
            duration,
            timestamp: Date.now(),
        };
        consecutiveErrors = 0;

        return { success: true, matchCount, duration };
    } catch (error) {
        const duration = Date.now() - startTime;
        consecutiveErrors++;
        console.error(`❌ Recent scores refresh failed (${consecutiveErrors}x): ${error.message} (${duration}ms)`);

        return { success: false, error: error.message, duration };
    }
}

/**
 * Also refresh upcoming-matches cache
 */
async function refreshUpcomingMatches() {
    try {
        const response = await axios.get(`${CONFIG.API_BASE}/upcoming-matches`, {
            timeout: CONFIG.REQUEST_TIMEOUT,
            params: { limit: 20 },
        });
        console.log(`✅ Refreshed ${response.data?.count || 0} upcoming matches`);
    } catch (error) {
        console.error(`❌ Upcoming matches refresh failed: ${error.message}`);
    }
}

/**
 * Main loop
 */
async function startWorker() {
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🏏 Recent Score Background Worker");
    console.log(`📍 Interval: ${CONFIG.REFRESH_INTERVAL_MS / 1000 / 60} minutes`);
    console.log(`📍 API Base: ${CONFIG.API_BASE}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    isRunning = true;

    // Wait 10s for api-manager to be ready on cold start
    console.log("⏳ Waiting 10s for api-manager to initialize...");
    await new Promise((resolve) => setTimeout(resolve, 10000));

    // Run immediately on start
    await refreshRecentScores();
    await refreshUpcomingMatches();

    // Then run on interval
    const intervalId = setInterval(async () => {
        if (isRunning) {
            await refreshRecentScores();
            // Refresh upcoming less frequently (every other cycle = 30 min)
            if (iterationCount % 2 === 0) {
                await refreshUpcomingMatches();
            }
        }
    }, CONFIG.REFRESH_INTERVAL_MS);

    // Graceful shutdown
    const shutdown = (signal) => {
        console.log(`\n⚠️  Received ${signal}. Shutting down gracefully...`);
        isRunning = false;
        clearInterval(intervalId);
        process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// Start the worker
startWorker();
