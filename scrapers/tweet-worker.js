/**
 * Tweet Worker - Auto-Post Enhanced Articles to Twitter
 *
 * Queries untweeted enhanced articles and posts them to Twitter
 * Only tweets articles enhanced after TWEET_START_DATE
 *
 * Usage:
 *   node scrapers/tweet-worker.js           # Post pending tweets
 *   node scrapers/tweet-worker.js --dry-run # Preview without posting
 *   node scrapers/tweet-worker.js --single  # Post only 1 tweet
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env.local") });
require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");
const {
  postArticleTweet,
  validateCredentials,
  CONFIG: TWITTER_CONFIG,
} = require("../services/twitter-service");

// ============================================
// CONFIGURATION
// ============================================

/**
 * Check if today is a weekend (Saturday or Sunday)
 */
function isWeekend() {
  const day = new Date().getDay();
  return day === 0 || day === 6; // Sunday = 0, Saturday = 6
}

const CONFIG = {
  // How many articles to tweet per run
  // Weekends get more tweets since fans are more active
  BATCH_SIZE: isWeekend() ? 4 : 3,

  // Delay between tweets (milliseconds) - CRITICAL for avoiding bans
  TWEET_DELAY_MS: 10 * 60 * 1000, // 10 minutes between tweets

  // Maximum tweets per day - Twitter's unwritten safe limit
  // Weekends get slightly higher limit
  MAX_TWEETS_PER_DAY: isWeekend() ? 18 : 15,

  // Minimum hours between runs (to spread tweets throughout day)
  MIN_HOURS_BETWEEN_RUNS: 2,

  // Cutoff date
  START_DATE: TWITTER_CONFIG.START_DATE,
};

// ============================================
// DATABASE
// ============================================

let prisma = null;
let pool = null;

async function initDatabase() {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });
}

async function closeDatabase() {
  if (prisma) await prisma.$disconnect();
  if (pool) await pool.end();
}

// ============================================
// DAILY LIMIT TRACKING (Anti-Ban Protection)
// ============================================

/**
 * Get count of tweets posted today
 * @returns {number} Number of tweets posted in last 24 hours
 */
async function getTodaysTweetCount() {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const count = await prisma.enhancedContent.count({
    where: {
      tweetedAt: {
        gte: twentyFourHoursAgo,
      },
    },
  });
  
  return count;
}

/**
 * Check if we've hit the daily tweet limit
 * @returns {Object} { canTweet: boolean, tweetsToday: number, remaining: number }
 */
async function checkDailyLimit() {
  const tweetsToday = await getTodaysTweetCount();
  const remaining = Math.max(0, CONFIG.MAX_TWEETS_PER_DAY - tweetsToday);
  
  return {
    canTweet: tweetsToday < CONFIG.MAX_TWEETS_PER_DAY,
    tweetsToday,
    remaining,
    limit: CONFIG.MAX_TWEETS_PER_DAY,
  };
}

/**
 * Get time since last tweet
 * @returns {Object} { lastTweetTime: Date|null, hoursSince: number }
 */
async function getLastTweetTime() {
  const lastTweet = await prisma.enhancedContent.findFirst({
    where: {
      tweetedAt: { not: null },
    },
    orderBy: {
      tweetedAt: 'desc',
    },
    select: {
      tweetedAt: true,
    },
  });
  
  if (!lastTweet?.tweetedAt) {
    return { lastTweetTime: null, hoursSince: 999 };
  }
  
  const hoursSince = (Date.now() - new Date(lastTweet.tweetedAt).getTime()) / (1000 * 60 * 60);
  
  return {
    lastTweetTime: lastTweet.tweetedAt,
    hoursSince,
  };
}

// ============================================
// FETCH UNTWEETED ARTICLES
// ============================================

/**
 * Get enhanced articles that haven't been tweeted yet
 * Only returns articles enhanced after START_DATE
 *
 * @param {number} limit - Max articles to fetch
 * @returns {Array} Articles with enhanced content
 */
async function fetchUntweetedArticles(limit = CONFIG.BATCH_SIZE) {
  const articles = await prisma.newsArticle.findMany({
    where: {
      enhancedContent: {
        status: "published",
        tweetedAt: null, // Not tweeted yet
        createdAt: {
          gte: CONFIG.START_DATE, // Only after cutoff
        },
      },
    },
    include: {
      enhancedContent: true,
    },
    orderBy: {
      createdAt: "desc", // Newest first
    },
    take: limit,
  });

  return articles;
}

// ============================================
// UPDATE TWEET STATUS
// ============================================

/**
 * Mark article as tweeted in database
 *
 * @param {string} enhancedContentId - EnhancedContent ID
 * @param {string} tweetId - Twitter post ID
 */
async function markAsTweeted(enhancedContentId, tweetId) {
  await prisma.enhancedContent.update({
    where: { id: enhancedContentId },
    data: {
      tweetedAt: new Date(),
      tweetId: tweetId,
    },
  });
}

// ============================================
// SLEEP UTILITY (with randomization for natural behavior)
// ============================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get randomized delay to appear more human-like
 * Adds 0-50% random variation to base delay
 * @param {number} baseMs - Base delay in milliseconds
 * @returns {number} Randomized delay
 */
function getRandomizedDelay(baseMs) {
  // Add 0-50% random variation
  const variation = baseMs * 0.5 * Math.random();
  return Math.floor(baseMs + variation);
}

// ============================================
// MAIN WORKER
// ============================================

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const isSingle = args.includes("--single");
  const forceRun = args.includes("--force"); // Skip safety checks

  console.log(`
╔════════════════════════════════════════════════════════════╗
║           Tweet Worker - Auto-Post to Twitter              ║
║                   🛡️ Anti-Ban Protection Enabled           ║
╠════════════════════════════════════════════════════════════╣
║  Started: ${new Date().toISOString()}              ║
║  Mode: ${isDryRun ? "DRY RUN (no posting)" : "LIVE POSTING"}                               ║
║  Cutoff: ${CONFIG.START_DATE.toISOString().substring(0, 10)}                                   ║
║  Daily Limit: ${CONFIG.MAX_TWEETS_PER_DAY} tweets/day                              ║
║  Tweet Delay: ${(CONFIG.TWEET_DELAY_MS / 60000)} minutes                                  ║
╚════════════════════════════════════════════════════════════╝
`);

  try {
    // Initialize database
    console.log("🔌 Connecting to database...");
    await initDatabase();

    // ============================================
    // ANTI-BAN SAFETY CHECKS
    // ============================================
    
    if (!isDryRun && !forceRun) {
      console.log("🛡️ Running anti-ban safety checks...\n");
      
      // Check 1: Daily tweet limit
      const dailyStatus = await checkDailyLimit();
      console.log(`   📊 Tweets in last 24h: ${dailyStatus.tweetsToday}/${dailyStatus.limit}`);
      
      if (!dailyStatus.canTweet) {
        console.log(`   ⛔ DAILY LIMIT REACHED! Skipping to protect account.`);
        console.log(`   💡 Will resume when oldest tweet is >24h old.`);
        return;
      }
      console.log(`   ✅ Daily limit OK (${dailyStatus.remaining} tweets remaining)`);
      
      // Check 2: Time since last tweet (spread tweets throughout day)
      const lastTweet = await getLastTweetTime();
      if (lastTweet.lastTweetTime) {
        console.log(`   ⏱️ Last tweet: ${lastTweet.hoursSince.toFixed(1)} hours ago`);
        
        // Warn if posting too frequently
        if (lastTweet.hoursSince < 0.5) { // Less than 30 minutes
          console.log(`   ⚠️ WARNING: Recent tweet detected. Adding extra delay...`);
        }
      } else {
        console.log(`   ⏱️ No previous tweets found`);
      }
      
      console.log("");
    }

    // Validate Twitter credentials
    if (!isDryRun) {
      console.log("🐦 Validating Twitter credentials...");
      const validation = await validateCredentials();
      if (!validation.valid) {
        console.error(`❌ Twitter credentials invalid: ${validation.error}`);
        process.exit(1);
      }
      console.log(`✅ Authenticated as @${validation.user.username}\n`);
    }

    // Fetch untweeted articles - respect daily limit
    const dailyStatus = await checkDailyLimit();
    const maxToFetch = isDryRun ? CONFIG.BATCH_SIZE : Math.min(CONFIG.BATCH_SIZE, dailyStatus.remaining);
    const limit = isSingle ? 1 : maxToFetch;
    
    console.log(`📊 Fetching up to ${limit} untweeted articles...`);
    const articles = await fetchUntweetedArticles(limit);

    if (articles.length === 0) {
      console.log("✅ No articles to tweet. All caught up!");
      return;
    }

    console.log(`✅ Found ${articles.length} articles to tweet:\n`);

    // Process each article
    let successCount = 0;
    let failCount = 0;
    let stoppedEarly = false;

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      const enhanced = article.enhancedContent;

      console.log(
        `\n[${i + 1}/${articles.length}] ${article.title?.substring(0, 50)}...`
      );
      console.log(`   Slug: ${article.slug}`);
      console.log(`   Tags: ${article.tags?.slice(0, 3).join(", ") || "none"}`);

      if (isDryRun) {
        // Dry run - just show what would be tweeted
        const { formatTweet } = require("../services/twitter-service");
        const tweet = formatTweet(article, enhanced);
        console.log(`   📝 Would tweet (${tweet.length} chars):`);
        console.log(`   ────────────────────────────────────`);
        tweet.split("\n").forEach((line) => console.log(`   ${line}`));
        console.log(`   ────────────────────────────────────`);
        successCount++;
      } else {
        // Live posting
        const result = await postArticleTweet(article, enhanced);

        if (result.success) {
          // Update database
          await markAsTweeted(enhanced.id, result.tweetId);
          console.log(`   📝 Saved tweet ID to database`);
          successCount++;

          // Delay before next tweet (except for last one)
          // Uses randomized delay to appear more human-like
          if (i < articles.length - 1) {
            const actualDelay = getRandomizedDelay(CONFIG.TWEET_DELAY_MS);
            const delayMins = (actualDelay / 60000).toFixed(1);
            console.log(`   ⏳ Waiting ${delayMins} minutes before next tweet (randomized)...`);
            await sleep(actualDelay);
          }
        } else {
          failCount++;
          
          // CRITICAL: Stop immediately if Twitter signals account issues
          if (result.shouldStopAll) {
            console.log(`\n   ⛔ EMERGENCY STOP - Protecting account!`);
            console.log(`   🛡️ Remaining ${articles.length - i - 1} tweets skipped.`);
            stoppedEarly = true;
            break;
          }
          
          // For duplicates, continue but don't mark as error
          if (result.isDuplicate) {
            // Mark as tweeted to avoid retry loops
            await markAsTweeted(enhanced.id, "DUPLICATE_SKIPPED");
            console.log(`   📝 Marked as skipped (duplicate)`);
          }
        }
      }
    }

    // Summary
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                     TWEET WORKER SUMMARY                   ║
║                   ${stoppedEarly ? "⚠️ STOPPED EARLY FOR SAFETY" : "                             "}           ║
╠════════════════════════════════════════════════════════════╣
║  ✅ Successful: ${successCount.toString().padEnd(40)}║
║  ❌ Failed: ${failCount.toString().padEnd(45)}║
║  📊 Total processed: ${articles.length.toString().padEnd(35)}║
╚════════════════════════════════════════════════════════════╝
`);
  } catch (error) {
    console.error("\n❌ Fatal error:", error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await closeDatabase();
    console.log("✅ Tweet worker completed.");
  }
}

// Run
main();
