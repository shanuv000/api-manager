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

  // Cached auth username (populated on first validateCredentials call)
  cachedUsername: null,

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

  // Common cricket acronyms that should stay uppercase
  const ACRONYMS = new Set([
    'icc', 'bcci', 'pcb', 'ecb', 'ca', 'nzc', 'slc', 'bcb', 'acb', 'cwi',
    'ipl', 'bbl', 'psl', 'cpl', 'bgt', 'wtc', 'odi', 't20', 't20i', 'cwc',
    'usa', 'uae', 'uk', 'nz', 'sa'
  ]);

  // Process tags: clean, format as hashtags
  const processedTags = tags
    .slice(0, 3) // Take first 3 tags, we'll dedupe to 2
    .map((tag) => {
      // Clean tag: remove special chars, spaces -> formatted
      const cleaned = tag
        .replace(/[^a-zA-Z0-9\s]/g, "") // Remove special chars
        .split(/\s+/) // Split by spaces
        .map((word) => {
          // Keep acronyms uppercase
          if (ACRONYMS.has(word.toLowerCase())) {
            return word.toUpperCase();
          }
          // PascalCase for normal words
          return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join(""); // Join

      return cleaned ? `#${cleaned}` : null;
    })
    .filter((tag) => tag && tag.length > 2 && tag.length <= 25); // Filter valid tags

  // Deduplicate hashtags (case-insensitive)
  const seen = new Set();
  const allHashtags = [...hashtags, ...processedTags];
  const uniqueHashtags = allHashtags.filter((tag) => {
    const lower = tag.toLowerCase();
    if (seen.has(lower)) return false;
    seen.add(lower);
    return true;
  });

  return uniqueHashtags.slice(0, CONFIG.MAX_HASHTAGS);
}

// ============================================
// TWEET FORMATTING
// ============================================

/**
 * Get a varied emoji based on content keywords
 * Enhanced with player names, teams, tournaments for more engaging tweets
 */
function getContentEmoji(title, tags = []) {
  const text = (title + ' ' + tags.join(' ')).toLowerCase();

  // ============================================
  // PRIORITY 1: Breaking/Urgent News
  // ============================================
  if (text.includes('break') || text.includes('record') || text.includes('historic')) return '🔥';
  if (text.includes('injury') || text.includes('ruled out') || text.includes('miss')) return '🚨';
  if (text.includes('suspend') || text.includes('ban') || text.includes('penalt')) return '⚠️';
  if (text.includes('shock') || text.includes('upset') || text.includes('stun')) return '😱';

  // ============================================
  // PRIORITY 2: Match Results & Achievements
  // ============================================
  // Use word boundary for 'win' to avoid matching 'windies'
  if (/\bwins?\b/.test(text) || text.includes('victory') || text.includes('champion')) return '🏆';
  if (text.includes('century') || text.includes('hundred') || text.includes('ton ')) return '💯';
  if (text.includes('five-fer') || text.includes('fifer') || text.includes('5 wicket')) return '🎳';
  if (text.includes('hat-trick') || text.includes('hatrick')) return '🎩';
  if (text.includes('maiden') || text.includes('first') || text.includes('debut')) return '⭐';
  if (text.includes('fastest') || text.includes('quickest')) return '⚡';
  if (text.includes('stat') || text.includes('number') || text.includes('figure')) return '📊';

  // ============================================
  // PRIORITY 3: Team-Specific (Flag Emojis)
  // ============================================
  if (text.includes('india') || text.includes('bcci') || text.includes('team india')) return '🇮🇳';
  if (text.includes('australia') || text.includes('cricket australia')) return '🇦🇺';
  if (text.includes('england') || text.includes('ecb')) return '🏴󠁧󠁢󠁥󠁮󠁧󠁿';
  if (text.includes('pakistan') || text.includes('pcb')) return '🇵🇰';
  if (text.includes('new zealand') || text.includes('blackcaps') || text.includes('black caps')) return '🇳🇿';
  if (text.includes('south africa') || text.includes('proteas')) return '🇿🇦';
  if (text.includes('west indies') || text.includes('windies')) return '🌴';
  if (text.includes('sri lanka') || text.includes('slc')) return '🇱🇰';
  if (text.includes('bangladesh') || text.includes('tigers')) return '🇧🇩';
  if (text.includes('afghanistan') || text.includes('acb')) return '🇦🇫';
  if (text.includes('zimbabwe')) return '🇿🇼';
  if (text.includes('ireland')) return '🇮🇪';
  if (text.includes('scotland')) return '🏴󠁧󠁢󠁳󠁣󠁴󠁿';
  if (text.includes('netherlands')) return '🇳🇱';

  // ============================================
  // PRIORITY 4: Star Players
  // ============================================
  const starPlayers = [
    'kohli', 'virat', 'rohit', 'sharma', 'bumrah', 'jadeja', 'pant', 'rahul', 'dhoni', 'hardik',
    'smith', 'warner', 'cummins', 'starc', 'labuschagne', 'head', 'marsh',
    'root', 'stokes', 'bairstow', 'anderson', 'broad', 'crawley', 'brook',
    'babar', 'rizwan', 'shaheen', 'naseem',
    'williamson', 'conway', 'southee', 'boult',
    'de kock', 'rabada', 'nortje', 'bavuma',
    'rashid khan', 'pooran', 'pollard', 'gayle', 'holder',
    'shakib', 'mushfiqur', 'litton',
    'mendis', 'mathews', 'hasaranga'
  ];
  if (starPlayers.some(player => text.includes(player))) return '⭐';

  // ============================================
  // PRIORITY 5: Tournaments & Series
  // ============================================
  if (text.includes('world cup') || text.includes('wc ') || text.includes('cwc')) return '🌍';
  if (text.includes('ipl') || text.includes('auction') || text.includes('sold') || text.includes('crore')) return '💰';
  if (text.includes('bgt') || text.includes('border-gavaskar') || text.includes('border gavaskar')) return '🏆';
  if (text.includes('ashes')) return '🔥';
  if (text.includes('asia cup')) return '🏆';
  if (text.includes('champions trophy')) return '🏆';
  if (text.includes('t20 blast') || text.includes('bbl') || text.includes('big bash')) return '💥';
  if (text.includes('psl') || text.includes('cpl') || text.includes('sa20')) return '🏏';
  if (text.includes('wtc') || text.includes('test championship')) return '🏆';
  if (text.includes('final') || text.includes('semi-final') || text.includes('semifinal')) return '🎯';

  // ============================================
  // PRIORITY 6: Event Types
  // ============================================
  if (text.includes('announce') || text.includes('squad') || text.includes('select')) return '📢';
  if (text.includes('retire') || text.includes('farewell') || text.includes('goodbye')) return '👏';
  if (text.includes('contract') || text.includes('sign') || text.includes('deal')) return '✍️';
  if (text.includes('preview') || text.includes('upcoming') || text.includes('ahead')) return '👀';
  if (text.includes('review') || text.includes('analysis') || text.includes('recap')) return '📝';
  if (text.includes('interview') || text.includes('says') || text.includes('speaks')) return '🎤';
  if (text.includes('controversy') || text.includes('dispute') || text.includes('row')) return '💬';
  if (text.includes('captain') || text.includes('lead')) return '👨‍✈️';
  if (text.includes('coach') || text.includes('mentor')) return '📋';

  // ============================================
  // DEFAULT: Randomized Cricket Emojis
  // ============================================
  const defaults = ['🏏', '🏏', '🏏', '🏏', '⚡', '🎯', '💪', '🔥', '✨'];
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

  // ============================================
  // A/B TEST: Tweet Format Variants
  // ============================================
  // Format A: emoji title \n\n url \n\n hashtags (default - most common)
  // Format B: hashtags \n\n emoji title \n\n url (hashtags first)
  // Format C: emoji title \n\n hashtags \n\n url (URL last)
  const formatVariants = ['A', 'A', 'A', 'B', 'C']; // 60% A, 20% B, 20% C
  const selectedFormat = formatVariants[Math.floor(Math.random() * formatVariants.length)];

  // Calculate max title length based on format (all formats have same overhead)
  const fixedLength =
    (emoji + " ").length + // Emoji + space
    "\n\n".length * 2 + // Two line breaks
    articleUrl.length +
    hashtagString.length;

  const maxTitleLength = CONFIG.MAX_TWEET_LENGTH - fixedLength - 3; // 3 for "..."

  // Truncate title if needed
  let displayTitle = title;
  if (displayTitle.length > maxTitleLength) {
    displayTitle = displayTitle.substring(0, maxTitleLength).trim() + "...";
  }

  // Build tweet based on selected format
  let tweet;
  switch (selectedFormat) {
    case 'B':
      tweet = `${hashtagString}\n\n${emoji} ${displayTitle}\n\n${articleUrl}`;
      break;
    case 'C':
      tweet = `${emoji} ${displayTitle}\n\n${hashtagString}\n\n${articleUrl}`;
      break;
    case 'A':
    default:
      tweet = `${emoji} ${displayTitle}\n\n${articleUrl}\n\n${hashtagString}`;
      break;
  }

  // Attach format info for tracking (not included in tweet text)
  tweet._format = selectedFormat;

  return tweet;
}

// ============================================
// TAKEAWAY-BASED TWEET FORMATTING
// ============================================

/**
 * Format tweet using key_takeaways from enhanced content
 * Uses the first takeaway as a hook (already has emoji from AI)
 *
 * Format:
 * [Takeaway with emoji]
 *
 * [Article URL]
 *
 * #Cricket #Tag1 #Tag2
 *
 * @param {Object} article - NewsArticle from database
 * @param {Object} enhancedContent - EnhancedContent from database
 * @returns {string|null} Formatted tweet text, or null if no takeaways
 */
function formatTweetFromTakeaway(article, enhancedContent) {
  const takeaways = enhancedContent?.keyTakeaways || [];

  if (!takeaways || takeaways.length === 0) {
    return null; // Fall back to title-based tweet
  }

  // Use first takeaway (usually the most impactful)
  let takeaway = takeaways[0];

  // Build article URL
  const articleUrl = `${CONFIG.SITE_URL}/${article.slug}`;

  // Generate hashtags from article tags
  const hashtags = generateHashtags(article.tags);
  const hashtagString = hashtags.join(" ");

  // Calculate max takeaway length
  // URL counts as 23 chars on Twitter (t.co shortening)
  const URL_CHAR_COUNT = 23;
  const fixedLength =
    "\n\n".length * 2 + // Two line breaks
    URL_CHAR_COUNT +
    hashtagString.length;

  const maxTakeawayLength = CONFIG.MAX_TWEET_LENGTH - fixedLength - 3; // 3 for "..."

  // Truncate takeaway if needed
  if (takeaway.length > maxTakeawayLength) {
    takeaway = takeaway.substring(0, maxTakeawayLength).trim() + "...";
  }

  // Build tweet: Takeaway (with emoji) + URL + Hashtags
  const tweet = `${takeaway}\n\n${articleUrl}\n\n${hashtagString}`;

  return tweet;
}

/**
 * Generate multiple tweet variants for A/B testing and variety
 * Returns 2 variants: one using takeaway, one using title
 *
 * @param {Object} article - NewsArticle from database
 * @param {Object} enhancedContent - EnhancedContent from database
 * @returns {Array} Array of { type: string, text: string } objects
 */
function generateTweetVariants(article, enhancedContent) {
  const variants = [];

  // Variant 1: Takeaway-based hook (if available)
  const takeawayTweet = formatTweetFromTakeaway(article, enhancedContent);
  if (takeawayTweet) {
    variants.push({
      type: 'takeaway',
      text: takeawayTweet,
      description: 'Hook from key takeaway',
    });
  }

  // Variant 2: Title-based (existing format)
  const titleTweet = formatTweet(article, enhancedContent);
  variants.push({
    type: 'title',
    text: titleTweet,
    description: 'Enhanced title format',
  });

  return variants;
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

    // Prefer takeaway-based tweets (more engaging hooks with emojis)
    // Fall back to title-based if no takeaways available
    const tweetText = formatTweetFromTakeaway(article, enhancedContent)
      || formatTweet(article, enhancedContent);

    console.log(`   🐦 Posting tweet (${tweetText.length} chars):`);
    console.log(`      "${tweetText.substring(0, 80)}..."`);

    const result = await client.v2.tweet(tweetText);
    // Use cached username if available, otherwise default
    const username = CONFIG.cachedUsername || 'i';
    const tweetUrl = `https://twitter.com/${username}/status/${result.data.id}`;

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
 * Validate Twitter credentials and cache username
 * @returns {Object} { valid: boolean, user?: Object, error?: string }
 */
async function validateCredentials() {
  try {
    const client = getTwitterClient();
    const result = await client.v2.me();

    // Cache the username for tweet URL generation
    if (result.data?.username) {
      CONFIG.cachedUsername = result.data.username;
    }

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

/**
 * Fetch engagement metrics for a tweet
 * Uses Twitter API v2 to get likes, retweets, replies
 * @param {string} tweetId - The tweet ID to fetch metrics for
 * @returns {Object} { success: boolean, metrics?: Object, error?: string }
 */
async function fetchTweetMetrics(tweetId) {
  try {
    const client = getTwitterClient();
    const result = await client.v2.singleTweet(tweetId, {
      'tweet.fields': ['public_metrics', 'created_at'],
    });

    const metrics = result.data?.public_metrics || {};

    return {
      success: true,
      metrics: {
        likes: metrics.like_count || 0,
        retweets: metrics.retweet_count || 0,
        replies: metrics.reply_count || 0,
        impressions: metrics.impression_count || 0,
        quotes: metrics.quote_count || 0,
      },
      createdAt: result.data?.created_at,
    };
  } catch (error) {
    return {
      success: false,
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
  formatTweetFromTakeaway,
  generateTweetVariants,
  generateHashtags,
  validateCredentials,
  getTwitterClient,
  fetchTweetMetrics,
  getContentEmoji,
  CONFIG,
};
