/**
 * Twitter Service for Auto-Posting Enhanced Cricket News
 *
 * Posts newly enhanced articles to Twitter with optimized formatting
 * Uses existing AI-generated tags from articles for hashtags
 *
 * Usage:
 *   const { postArticleTweet, formatTweet } = require('./services/twitter-service');
 *   await postArticleTweet(article, enhancedContent);
 */

require("dotenv").config({ path: ".env.local" });
const { TwitterApi } = require("twitter-api-v2");

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  // Twitter API credentials
  API_KEY: process.env.TWITTER_API_KEY,
  API_SECRET: process.env.TWITTER_API_SECRET,
  ACCESS_TOKEN: process.env.TWITTER_ACCESS_TOKEN,
  ACCESS_TOKEN_SECRET: process.env.TWITTER_ACCESS_TOKEN_SECRET,

  // Tweet settings
  SITE_URL: process.env.TWEET_SITE_URL || "https://play.urtechy.com/news",
  DEFAULT_HASHTAG: process.env.TWEET_DEFAULT_HASHTAG || "#Cricket",
  MAX_HASHTAGS: 3, // #Cricket + 2 from tags
  MAX_TWEET_LENGTH: 280,
  ENABLED: process.env.TWEET_ENABLED === "true",

  // Discord notifications
  DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL,

  // Cutoff date - only tweet articles enhanced after this date
  START_DATE: process.env.TWEET_START_DATE
    ? new Date(process.env.TWEET_START_DATE)
    : new Date(),
};

// ============================================
// DISCORD NOTIFICATIONS
// ============================================

/**
 * Send notification to Discord when tweet is posted
 * @param {Object} data - Tweet data
 */
async function notifyDiscord(data) {
  if (!CONFIG.DISCORD_WEBHOOK_URL) return;
  
  try {
    await fetch(CONFIG.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title: '🐦 Tweet Posted',
          description: data.tweetText?.substring(0, 200),
          color: 0x1DA1F2, // Twitter blue
          fields: [
            { name: '📎 Tweet URL', value: data.tweetUrl || 'N/A', inline: false },
            { name: '📰 Article', value: data.articleUrl || 'N/A', inline: false },
          ],
          timestamp: new Date().toISOString(),
        }],
      }),
    });
  } catch (err) {
    // Silent fail - don't break tweeting for Discord errors
  }
}

// ============================================
// TWITTER CLIENT
// ============================================

let twitterClient = null;

/**
 * Get or create Twitter client (singleton)
 * @returns {TwitterApi} Twitter API client
 */
function getTwitterClient() {
  if (!twitterClient) {
    if (
      !CONFIG.API_KEY ||
      !CONFIG.API_SECRET ||
      !CONFIG.ACCESS_TOKEN ||
      !CONFIG.ACCESS_TOKEN_SECRET
    ) {
      throw new Error(
        "Twitter API credentials not configured in .env.local"
      );
    }

    twitterClient = new TwitterApi({
      appKey: CONFIG.API_KEY,
      appSecret: CONFIG.API_SECRET,
      accessToken: CONFIG.ACCESS_TOKEN,
      accessSecret: CONFIG.ACCESS_TOKEN_SECRET,
    });
  }
  return twitterClient;
}

// ============================================
// HASHTAG GENERATION
// ============================================

/**
 * Generate hashtags from article tags
 * Returns #Cricket + first 2 valid tags as hashtags
 *
 * @param {string[]} tags - Article tags array
 * @returns {string[]} Array of hashtags (max 3)
 */
function generateHashtags(tags = []) {
  const hashtags = [CONFIG.DEFAULT_HASHTAG];

  if (!tags || tags.length === 0) {
    return hashtags;
  }

  // Process tags: clean, format as hashtags
  const processedTags = tags
    .slice(0, 2) // Take first 2 tags only
    .map((tag) => {
      // Clean tag: remove special chars, spaces -> camelCase
      const cleaned = tag
        .replace(/[^a-zA-Z0-9\s]/g, "") // Remove special chars
        .split(/\s+/) // Split by spaces
        .map((word, i) =>
          i === 0
            ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
            : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        )
        .join(""); // Join as PascalCase

      return cleaned ? `#${cleaned}` : null;
    })
    .filter((tag) => tag && tag.length > 2 && tag.length <= 25); // Filter valid tags

  return [...hashtags, ...processedTags].slice(0, CONFIG.MAX_HASHTAGS);
}

// ============================================
// TWEET FORMATTING
// ============================================

/**
 * Get a varied emoji based on content keywords
 * Makes tweets look more natural and engaging
 */
function getContentEmoji(title, tags = []) {
  const text = (title + ' ' + tags.join(' ')).toLowerCase();
  
  // Priority-based emoji selection
  if (text.includes('break') || text.includes('record') || text.includes('historic')) return '🔥';
  if (text.includes('injury') || text.includes('ruled out') || text.includes('miss')) return '🚨';
  if (text.includes('win') || text.includes('victory') || text.includes('champion')) return '🏆';
  if (text.includes('century') || text.includes('wicket') || text.includes('stat')) return '📊';
  if (text.includes('debut') || text.includes('announce') || text.includes('squad')) return '📢';
  if (text.includes('ipl') || text.includes('auction') || text.includes('sold')) return '💰';
  if (text.includes('world cup') || text.includes('final')) return '🌍';
  if (text.includes('retire') || text.includes('farewell')) return '👏';
  
  // Default cricket emojis (randomized)
  const defaults = ['🏏', '🏏', '🏏', '⚡', '🎯', '💪'];
  return defaults[Math.floor(Math.random() * defaults.length)];
}

/**
 * Format article for Twitter
 *
 * Format:
 * 🏏 [Enhanced Title]
 *
 * [Article URL]
 *
 * #Cricket #Tag1 #Tag2
 *
 * @param {Object} article - NewsArticle from database
 * @param {Object} enhancedContent - EnhancedContent from database
 * @returns {string} Formatted tweet text
 */
function formatTweet(article, enhancedContent) {
  // Use enhanced title, fallback to original
  const title = enhancedContent?.title || article.title;

  // Build article URL
  const articleUrl = `${CONFIG.SITE_URL}/${article.slug}`;

  // Generate hashtags from article tags
  const hashtags = generateHashtags(article.tags);
  const hashtagString = hashtags.join(" ");
  
  // Get content-aware emoji
  const emoji = getContentEmoji(title, article.tags);

  // Calculate available space for title
  // Format: [emoji] [title]\n\n[url]\n\n[hashtags]
  const fixedLength =
    (emoji + " ").length + // Emoji + space
    "\n\n".length + // After title
    articleUrl.length +
    "\n\n".length + // After URL
    hashtagString.length;

  const maxTitleLength = CONFIG.MAX_TWEET_LENGTH - fixedLength - 3; // 3 for "..."

  // Truncate title if needed
  let displayTitle = title;
  if (displayTitle.length > maxTitleLength) {
    displayTitle = displayTitle.substring(0, maxTitleLength).trim() + "...";
  }

  // Build tweet with dynamic emoji
  const tweet = `${emoji} ${displayTitle}\n\n${articleUrl}\n\n${hashtagString}`;

  return tweet;
}

// ============================================
// TWEET POSTING
// ============================================

/**
 * Post article to Twitter
 *
 * @param {Object} article - NewsArticle from database (with tags, slug)
 * @param {Object} enhancedContent - EnhancedContent from database (with title)
 * @returns {Object} { success: boolean, tweetId?: string, error?: string }
 */
async function postArticleTweet(article, enhancedContent) {
  // Check if tweeting is enabled
  if (!CONFIG.ENABLED) {
    console.log("   ⏸️  Twitter posting disabled (TWEET_ENABLED=false)");
    return { success: false, error: "Tweeting disabled" };
  }

  // Check cutoff date
  const enhancedDate = new Date(enhancedContent.createdAt);
  if (enhancedDate < CONFIG.START_DATE) {
    console.log(
      `   ⏭️  Skipping old article (enhanced: ${enhancedDate.toISOString()}, cutoff: ${CONFIG.START_DATE.toISOString()})`
    );
    return { success: false, error: "Article before cutoff date" };
  }

  try {
    const client = getTwitterClient();
    const tweetText = formatTweet(article, enhancedContent);

    console.log(`   🐦 Posting tweet (${tweetText.length} chars):`);
    console.log(`      "${tweetText.substring(0, 80)}..."`);

    const result = await client.v2.tweet(tweetText);
    const tweetUrl = `https://twitter.com/Onlyblogs_/status/${result.data.id}`;

    console.log(`   ✅ Tweet posted! ID: ${result.data.id}`);

    // Send Discord notification
    await notifyDiscord({
      tweetText,
      tweetUrl,
      articleUrl: `${CONFIG.SITE_URL}/${article.slug}`,
    });

    return {
      success: true,
      tweetId: result.data.id,
      tweetUrl,
    };
  } catch (error) {
    console.error(`   ❌ Tweet failed: ${error.message}`);

    // Detailed error handling to prevent bans
    const errorCode = error.code || error.data?.status;
    
    // Rate limiting - STOP immediately
    if (errorCode === 429) {
      console.log("   ⛔ RATE LIMITED! Stopping all tweets to protect account.");
      console.log("   💡 Wait at least 15 minutes before retrying.");
      return {
        success: false,
        error: "Rate limited - stop posting",
        code: 429,
        shouldStopAll: true, // Signal to stop the entire batch
      };
    }
    
    // Duplicate tweet - skip but continue
    if (errorCode === 403 && error.message?.includes("duplicate")) {
      console.log("   ⚠️ Duplicate tweet detected. Skipping...");
      return {
        success: false,
        error: "Duplicate tweet",
        code: 403,
        isDuplicate: true,
      };
    }
    
    // Account suspended/locked - STOP immediately
    if (errorCode === 403 || errorCode === 401) {
      console.log("   ⛔ ACCOUNT ISSUE DETECTED! Stopping to protect account.");
      console.log("   💡 Check your Twitter account status manually.");
      return {
        success: false,
        error: "Account issue - check Twitter",
        code: errorCode,
        shouldStopAll: true,
      };
    }
    
    // Over daily limit
    if (errorCode === 403 && error.message?.includes("limit")) {
      console.log("   ⛔ DAILY LIMIT REACHED by Twitter! Stopping.");
      return {
        success: false,
        error: "Twitter daily limit reached",
        code: 403,
        shouldStopAll: true,
      };
    }

    return {
      success: false,
      error: error.message,
      code: errorCode,
    };
  }
}

/**
 * Validate Twitter credentials
 * @returns {Object} { valid: boolean, user?: Object, error?: string }
 */
async function validateCredentials() {
  try {
    const client = getTwitterClient();
    const result = await client.v2.me();
    return {
      valid: true,
      user: result.data,
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message,
    };
  }
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  postArticleTweet,
  formatTweet,
  generateHashtags,
  validateCredentials,
  getTwitterClient,
  CONFIG,
};
