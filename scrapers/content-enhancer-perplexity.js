/**
 * Content Enhancer using Perplexity Sonar API
 *
 * Enhances scraped cricket articles with AI-generated rich content
 * Uses Perplexity's Sonar model for high-quality, SEO-optimized output
 *
 * Usage: node scrapers/content-enhancer-perplexity.js
 */

require("dotenv").config();
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");
const {
  invalidateArticleCache,
  invalidateNewsCache,
} = require("../component/redisClient");
const {
  postArticleTweet,
  CONFIG: TWITTER_CONFIG,
} = require("../services/twitter-service");

// ============================================
// CONFIGURATION
// ============================================

// API Keys with fallback (primary: Match Insights, fallback: main account)
// Fallback is used automatically on API errors (rate limit, quota exceeded, etc.)
const PRIMARY_API_KEY = process.env.PERPLEXITY_API_KEY_MATCH_INSIGHTS;
const FALLBACK_API_KEY = process.env.PERPLEXITY_API_KEY;

const CONFIG = {
  PRIMARY_API_KEY: PRIMARY_API_KEY,
  FALLBACK_API_KEY: FALLBACK_API_KEY,
  PERPLEXITY_API_URL: "https://api.perplexity.ai/chat/completions",
  MODEL: "sonar-pro", // Better quality model for enhanced content
  BATCH_SIZE: 5, // Reduced for more reliable responses
  CONTENT_MAX_LENGTH: 1000, // Input context per article
  MAX_TOKENS: 16000, // Output tokens for batch
  TEMPERATURE: 0.5, // Lower temp for consistent quality
  MAX_RETRY_COUNT: 3, // Max retries for failed enhancements
  MIN_WORD_COUNT: 80, // Minimum words (allow short news updates)
  MAX_WORD_COUNT: 700, // Maximum words (allow some buffer above 550)
};

// ============================================
// CONTENT VALIDATION
// ============================================

/**
 * Validate enhanced content meets quality requirements
 * @param {Object} item - Enhanced content item
 * @returns {Object} { valid: boolean, reason?: string }
 */
function validateEnhancedContent(item) {
  if (!item.enhancedContent) {
    return { valid: false, reason: "No content" };
  }

  const content = item.enhancedContent;

  // Check word count
  const wordCount = content.split(/\s+/).filter((w) => w.length > 0).length;
  if (wordCount < CONFIG.MIN_WORD_COUNT) {
    return {
      valid: false,
      reason: `Word count too low: ${wordCount} (min: ${CONFIG.MIN_WORD_COUNT})`,
    };
  }
  if (wordCount > CONFIG.MAX_WORD_COUNT) {
    return {
      valid: false,
      reason: `Word count too high: ${wordCount} (max: ${CONFIG.MAX_WORD_COUNT})`,
    };
  }

  // Check for required markdown elements
  const hasHeadings = /###/.test(content);
  const hasBold = /\*\*/.test(content);
  const hasBlockquote = />/.test(content);

  if (!hasHeadings) {
    return { valid: false, reason: "Missing ### headings" };
  }
  if (!hasBold) {
    return { valid: false, reason: "Missing **bold** text" };
  }

  // Check for minimum paragraphs (at least 3 double-newline separations)
  const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 20);
  if (paragraphs.length < 3) {
    return {
      valid: false,
      reason: `Too few paragraphs: ${paragraphs.length} (min: 3)`,
    };
  }

  // Check title
  if (!item.enhancedTitle || item.enhancedTitle.length < 20) {
    return { valid: false, reason: "Title too short or missing" };
  }

  // Check meta description
  if (!item.metaDescription || item.metaDescription.length < 50) {
    return { valid: false, reason: "Meta description too short or missing" };
  }

  return {
    valid: true,
    wordCount,
    hasHeadings,
    hasBold,
    hasBlockquote,
    paragraphCount: paragraphs.length,
  };
}

/**
 * Determine if an article should be enhanced based on content quality/value
 * Skips low-value content to save API costs
 * @param {Object} article - Article from database
 * @returns {Object} { enhance: boolean, reason?: string }
 */
function shouldEnhanceArticle(article) {
  const content = article.content || "";
  const wordCount = content.split(/\s+/).filter((w) => w.length > 0).length;

  // Skip very short news (likely wire stories with minimal value-add from enhancement)
  if (wordCount < 100) {
    return {
      enhance: false,
      reason: `Too short for meaningful enhancement (${wordCount} words, min: 100)`,
    };
  }

  // Check if content is already well-structured (has headings and quotes)
  const headingCount = (content.match(/^#{1,4}\s/gm) || []).length;
  const quoteCount = (content.match(/^>/gm) || []).length;
  const hasBoldNames = (content.match(/\*\*[A-Z][a-z]+\s[A-Z][a-z]+\*\*/g) || []).length;

  // Skip if already rich content (2+ headings AND 2+ quotes AND bolded names)
  // These are likely already well-formatted feature articles
  if (headingCount >= 2 && quoteCount >= 2 && hasBoldNames >= 3 && wordCount > 500) {
    return {
      enhance: false,
      reason: `Already well-structured (${headingCount} headings, ${quoteCount} quotes, ${hasBoldNames} bold names)`,
    };
  }

  // Skip match scorecards and pure statistical content
  const tableCount = (content.match(/\|.*\|/g) || []).length;
  if (tableCount > 10 && wordCount < 300) {
    return {
      enhance: false,
      reason: `Scorecard/table content (${tableCount} table rows, ${wordCount} words)`,
    };
  }

  return { enhance: true, wordCount };
}

// ============================================
// DATABASE SETUP
// ============================================

let pool;
let prisma;

async function initDatabase() {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
  });
  prisma = new PrismaClient({
    adapter: new PrismaPg(pool),
  });
  console.log("   ✅ Database connected");
}

async function closeDatabase() {
  if (prisma) await prisma.$disconnect();
  if (pool) await pool.end();
}

// ============================================
// PERPLEXITY API FUNCTIONS
// ============================================

/**
 * System prompt for cricket content enhancement
 * Optimized for: Indian cricket fans, SEO, flexible length, clean markdown, no citations
 */
const SYSTEM_PROMPT = `You are an elite cricket journalist writing original content for play.urtechy.com, a premium Indian cricket platform.

⚠️ CRITICAL RULES:
1. NO CITATIONS - Never include [1], [2], [3] or any reference numbers
2. NO source attributions - No "According to..." or "reports suggest"
3. Write as original journalism with natural authority
4. Use Indian cricket fan perspective and terminology

📏 DYNAMIC LENGTH (Match depth to content significance):
┌──────────────────────────────────────┬────────────────┐
│ Content Type                         │ Target Length  │
├──────────────────────────────────────┼────────────────┤
│ Breaking news / Quick updates        │ 150-250 words  │
│ Squad changes / Injury updates       │ 250-350 words  │
│ Match previews / Post-match reports  │ 350-500 words  │
│ Player milestones / Feature stories  │ 450-600 words  │
│ Historical deep-dives / Analysis     │ 500-700 words  │
└──────────────────────────────────────┴────────────────┘

📝 MARKDOWN STYLING:

**Bold** for emphasis:
- Player names (first mention): **Virat Kohli**, **Jasprit Bumrah**
- Team names: **Team India**, **Mumbai Indians**, **RCB**
- Key stats: **156 runs**, **5/27**, **fastest century**
- Tournament names: **IPL 2026**, **T20 World Cup**

### Subheadings (Max 2-3):
- Make them engaging: "### Rohit's Captaincy Masterclass" ✓
- Avoid generic: "### Match Analysis" ✗
- Skip: "Introduction", "Conclusion", "Overview"

> Blockquotes for quotes:
- Player/coach quotes only: > "This win means everything." — Rohit Sharma
- Limit: 1-2 quotes per article
- No made-up quotes - use only if present in source

Paragraph flow:
- **Lead (40-60 words)**: Hook + key news + bolded names
- **Body (2-4 paragraphs)**: Context, stats, historical comparison
- **Close (30-40 words)**: What's next / Stakes / Anticipation

🎯 SEO OPTIMIZATION:

enhancedTitle (50-65 characters):
- Primary keyword in first 3 words
- Include: Player/team name + action + context
- Power words: Breaks, Stuns, Reveals, Dominates, Slams, Historic
- Examples:
  ✓ "Kohli Smashes Record 50th ODI Century Against Australia"
  ✓ "IPL 2026: RCB Signs Rashid Khan in Mega Auction Shocker"
  ✗ "Virat Kohli Scores Another Century" (too bland)

metaDescription (150-160 characters):
- Action verb start (Discover, Learn, Find out)
- Primary + secondary keywords
- Include year (2026) and tournament name
- End with intrigue

keyTakeaways (Exactly 4 bullets):
- Format: Emoji + concise insight (under 100 chars)
- Required emojis: 📊 (stat), 🏆 (achievement), 💡 (insight), 🔮 (future)
- Example:
  • 📊 Kohli now has 50 ODI centuries, 8 behind Tendulkar's record
  • 🏆 Fastest player to reach 13,000 ODI runs in just 267 innings
  • 💡 His average in Australia stands at an impressive 58.6
  • 🔮 Next milestone: 14,000 ODI runs expected in March 2026

🇮🇳 INDIAN CRICKET FAN VOICE:
- Use passionate but professional tone
- Reference iconic moments: "Dhoni-style finish", "Kohli-esque cover drive"
- Cultural context: IPL craze, India-Pakistan rivalry, fan emotions
- Local terms: "Men in Blue", "King Kohli", "Hitman Rohit"

❌ NEVER INCLUDE:
✗ Citation numbers [1] [2] or reference markers
✗ "According to sources/reports/ESPN/Cricinfo"
✗ Phrases like "It is reported that..." or "Studies show..."
✗ Generic conclusions: "In conclusion", "To sum up"
✗ Exact copied sentences from source
✗ Word count mentions in output
✗ Multiple exclamation marks!!!
✗ ALL CAPS words (except IPL, ODI, T20)

📤 OUTPUT FORMAT:
Return valid JSON array. enhancedContent must use \\n\\n for paragraph breaks.

[{"id":"article-id","enhancedTitle":"SEO Title","enhancedContent":"**Virat Kohli** smashed...\\n\\n### Record Performance\\n\\nThe **Indian captain**...\\n\\n> \\"This innings means everything.\\" — Virat Kohli\\n\\nWith this century...","metaDescription":"160-char description","keyTakeaways":["📊 Stat","🏆 Achievement","💡 Insight","🔮 Future"]}]

REMEMBER: Write with the authority of someone who watched the match, not someone reading about it. NO citations anywhere.`;

/**
 * Build the user prompt with article data
 */
function buildUserPrompt(articles) {
  const inputData = articles.map((a) => ({
    id: a.id,
    title: a.title,
    source: a.sourceName || "Unknown",
    content: (a.content || a.description || "").substring(
      0,
      CONFIG.CONTENT_MAX_LENGTH
    ),
  }));

  return `Transform these cricket articles. Match length to content depth:

${JSON.stringify(inputData, null, 2)}

RULES:
1. NO CITATIONS [1][2] - Write as original journalism
2. FLEXIBLE LENGTH - Short news = 150-250 words, in-depth = 400-600 words
3. Bold **player names**, **teams**, **scores** on first mention
4. Max 2 ### headings per article (descriptive, not generic)
5. Max 1 blockquote per article (player/coach quote)

OUTPUT FORMAT - JSON array only:
[{"id":"${articles[0]?.id}","enhancedTitle":"Keyword-Rich Title (50-65 chars)","enhancedContent":"Opening hook with **bold names**...\\n\\n### Descriptive Heading\\n\\nBody with stats...\\n\\n> \"Quote\" — Player\\n\\nClosing paragraph.","metaDescription":"SEO summary 150-160 chars with year","keyTakeaways":["📊 Stat insight","🏆 Key point","💡 Takeaway"]}]`;
}

/**
 * Call Perplexity Sonar Pro API with automatic fallback
 * Uses primary API key first, falls back to secondary on errors
 */
async function callPerplexityAPI(articles) {
  const userPrompt = buildUserPrompt(articles);
  const apiKeys = [
    { key: CONFIG.PRIMARY_API_KEY, name: "Primary (Match Insights)" },
    { key: CONFIG.FALLBACK_API_KEY, name: "Fallback (Main Account)" },
  ].filter((k) => k.key); // Only include configured keys

  console.log(`\n🤖 Calling Perplexity Sonar Pro API...`);
  console.log(`   Model: ${CONFIG.MODEL}`);
  console.log(`   Articles: ${articles.length}`);
  console.log(`   API Keys available: ${apiKeys.length}`);

  let lastError = null;

  for (let i = 0; i < apiKeys.length; i++) {
    const { key, name } = apiKeys[i];
    const startTime = Date.now();

    console.log(`   🔑 Trying ${name}...`);

    try {
      const response = await fetch(CONFIG.PERPLEXITY_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: CONFIG.MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          max_tokens: CONFIG.MAX_TOKENS,
          temperature: CONFIG.TEMPERATURE,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const errorCode = response.status;
        
        // Determine if we should try fallback
        const shouldFallback = [429, 402, 403, 500, 502, 503].includes(errorCode);
        
        if (shouldFallback && i < apiKeys.length - 1) {
          console.log(`   ⚠️ ${name} failed (${errorCode}), trying fallback...`);
          lastError = new Error(`API error ${errorCode}: ${errorText}`);
          continue; // Try next key
        }
        
        throw new Error(`API error ${errorCode}: ${errorText}`);
      }

      const data = await response.json();
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      console.log(`   ✅ Response received in ${elapsed}s using ${name}`);

      if (data.usage) {
        console.log(
          `   📊 Tokens: ${data.usage.prompt_tokens} in / ${data.usage.completion_tokens} out`
        );
      }

      return data.choices[0]?.message?.content;
    } catch (error) {
      lastError = error;
      
      // If this is not the last key and it's a retriable error, continue
      if (i < apiKeys.length - 1 && error.message.includes("API error")) {
        console.log(`   ⚠️ ${name} error: ${error.message}`);
        continue;
      }
      
      console.error(`   ❌ API Error: ${error.message}`);
      throw error;
    }
  }

  // If we exhausted all keys
  throw lastError || new Error("All API keys exhausted");
}

/**
 * Parse JSON response from Perplexity
 */
function parseResponse(response) {
  if (!response) {
    console.log("   ❌ Empty response");
    return null;
  }

  console.log(`\n📥 Parsing response (${response.length} chars)...`);

  try {
    // Try direct parse first
    try {
      const direct = JSON.parse(response);
      if (Array.isArray(direct)) {
        console.log(`   ✅ Parsed ${direct.length} articles`);
        return direct;
      }
    } catch {}

    // Extract JSON array from text
    const jsonMatch = response.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (jsonMatch) {
      let jsonStr = jsonMatch[0];

      // Fix common Sonar model issues:
      // 1. Missing comma between objects: }{ -> },{
      jsonStr = jsonStr.replace(/\}\s*\{/g, "},{");

      // 2. Wrong closing bracket in keyTakeaways: "]} -> "]
      // (Sonar sometimes uses } instead of ] for arrays)
      jsonStr = jsonStr.replace(
        /"keyTakeaways"\s*:\s*\[(.*?)\}/g,
        (match, content) => {
          // Replace trailing } with ]
          return `"keyTakeaways":[${content}]`;
        }
      );

      // Fix common issues: escape newlines in strings
      let fixed = "";
      let inString = false;

      for (let i = 0; i < jsonStr.length; i++) {
        const char = jsonStr[i];
        const prevChar = i > 0 ? jsonStr[i - 1] : "";

        if (char === '"' && prevChar !== "\\") {
          inString = !inString;
          fixed += char;
          continue;
        }

        if (inString) {
          if (char === "\n") fixed += "\\n";
          else if (char === "\r") fixed += "\\r";
          else if (char === "\t") fixed += "\\t";
          else fixed += char;
        } else {
          fixed += char;
        }
      }

      const parsed = JSON.parse(fixed);
      if (Array.isArray(parsed)) {
        console.log(`   ✅ Parsed ${parsed.length} articles (after fix)`);
        return parsed;
      }
    }

    console.log("   ❌ Could not extract JSON array");
    return null;
  } catch (error) {
    console.log(`   ❌ Parse error: ${error.message}`);

    // Save for debugging
    const fs = require("fs");
    const debugPath = path.join(
      __dirname,
      "../debug-screenshots/perplexity-response.txt"
    );
    fs.writeFileSync(debugPath, response);
    console.log(`   📄 Response saved to: ${debugPath}`);

    return null;
  }
}

/**
 * Save enhanced content to database with validation
 * Also invalidates Redis cache for enhanced articles to ensure fresh data
 */
async function saveEnhancedContent(enhanced, originalArticles) {
  console.log(`\n💾 Saving enhanced content...`);
  let saved = 0;
  let failed = 0;
  const enhancedSlugs = []; // Track slugs for cache invalidation

  for (const item of enhanced) {
    try {
      // Find matching original article
      let article = originalArticles.find((a) => a.id === item.id);

      // Fallback: partial ID match
      if (!article) {
        article = originalArticles.find(
          (a) =>
            a.id.startsWith(item.id.substring(0, 8)) ||
            item.id.startsWith(a.id.substring(0, 8))
        );
      }

      // Fallback: position-based
      if (!article && enhanced.indexOf(item) < originalArticles.length) {
        article = originalArticles[enhanced.indexOf(item)];
      }

      if (!article) {
        console.log(`   ⚠️ No match for ID: ${item.id}`);
        continue;
      }

      // Validate content quality
      const validation = validateEnhancedContent(item);

      if (!validation.valid) {
        console.log(
          `   ⚠️ Validation failed for ${item.id}: ${validation.reason}`
        );

        // Get current retry count
        const existing = await prisma.enhancedContent.findUnique({
          where: { articleId: article.id },
        });

        // Mark as failed with incremented retry count
        await prisma.enhancedContent.upsert({
          where: { articleId: article.id },
          update: {
            status: "failed",
          },
          create: {
            articleId: article.id,
            title: item.enhancedTitle || "Failed",
            content: item.enhancedContent || "",
            metaDescription: item.metaDescription || "",
            keyTakeaways: item.keyTakeaways || [],
            status: "failed",
          },
        });
        failed++;
        continue;
      }

      // Save valid content
      const savedContent = await prisma.enhancedContent.upsert({
        where: { articleId: article.id },
        update: {
          title: item.enhancedTitle,
          content: item.enhancedContent,
          metaDescription: item.metaDescription,
          keyTakeaways: item.keyTakeaways,
          status: "published",
        },
        create: {
          articleId: article.id,
          title: item.enhancedTitle,
          content: item.enhancedContent,
          metaDescription: item.metaDescription,
          keyTakeaways: item.keyTakeaways,
          status: "published",
        },
      });

      // Track slug for cache invalidation
      if (article.slug) {
        enhancedSlugs.push(article.slug);
      }

      console.log(
        `   ✅ Saved (${validation.wordCount} words): ${item.enhancedTitle?.substring(0, 45)}...`
      );

      // Auto-tweet newly enhanced article (with daily limit check)
      if (TWITTER_CONFIG.ENABLED) {
        try {
          // Check daily limit before tweeting
          const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const todaysTweets = await prisma.enhancedContent.count({
            where: { tweetedAt: { gte: twentyFourHoursAgo } },
          });
          
          const MAX_DAILY_TWEETS = 10;
          if (todaysTweets >= MAX_DAILY_TWEETS) {
            console.log(`   ⏸️ Daily tweet limit reached (${todaysTweets}/${MAX_DAILY_TWEETS}). Will tweet later.`);
          } else {
            const tweetResult = await postArticleTweet(article, savedContent);
            if (tweetResult.success) {
              // Update database with tweet info
              await prisma.enhancedContent.update({
                where: { id: savedContent.id },
                data: {
                  tweetedAt: new Date(),
                  tweetId: tweetResult.tweetId,
                },
              });
              console.log(`   🐦 Tweeted: ${tweetResult.tweetUrl}`);
            } else if (tweetResult.shouldStopAll) {
              // Stop tweeting for this batch if rate limited
              console.log(`   ⛔ Twitter limit hit - skipping remaining tweets for this batch`);
            }
          }
        } catch (tweetError) {
          // Tweet failure shouldn't break enhancement flow
          console.log(`   ⚠️ Tweet failed (will retry later): ${tweetError.message}`);
        }
      }

      saved++;
    } catch (error) {
      console.log(`   ❌ Save error for ${item.id}: ${error.message}`);
    }
  }

  if (failed > 0) {
    console.log(`   ⚠️ ${failed} articles failed validation (will retry)`);
  }

  // Invalidate Redis cache for all enhanced articles
  // This ensures fresh enhanced content is served instead of stale cached data
  if (enhancedSlugs.length > 0) {
    console.log(`\n🗑️  Invalidating cache for ${enhancedSlugs.length} enhanced articles...`);
    for (const slug of enhancedSlugs) {
      try {
        await invalidateArticleCache(slug);
      } catch (cacheError) {
        console.log(`   ⚠️ Cache invalidation failed for ${slug}: ${cacheError.message}`);
      }
    }
    
    // Also invalidate news list cache to reflect hasEnhancedContent changes
    try {
      await invalidateNewsCache();
      console.log(`   ✅ News list cache invalidated`);
    } catch (cacheError) {
      console.log(`   ⚠️ News list cache invalidation failed: ${cacheError.message}`);
    }
  }

  return saved;
}

/**
 * Fetch articles that need enhancement
 * Prioritizes high-value sources (IPL, ICC) over generic sources
 * Also includes failed articles for retry (up to MAX_RETRY_COUNT attempts)
 */
async function fetchArticlesToEnhance(limit) {
  // Get articles without any enhanced content
  const newArticles = await prisma.newsArticle.findMany({
    where: {
      enhancedContent: null,
      content: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: limit * 2,
  });

  // Get failed articles for retry (created in last 7 days, not exceeding retry limit)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const failedArticles = await prisma.newsArticle.findMany({
    where: {
      enhancedContent: {
        status: "failed",
        createdAt: { gte: sevenDaysAgo },
      },
      content: { not: null },
    },
    include: {
      enhancedContent: true,
    },
    orderBy: { createdAt: "desc" },
    take: Math.floor(limit / 2), // Reserve some slots for retries
  });

  // Combine and deduplicate
  const allArticles = [...newArticles];
  for (const fa of failedArticles) {
    if (!allArticles.find((a) => a.id === fa.id)) {
      // Mark as retry for logging
      fa.isRetry = true;
      allArticles.push(fa);
    }
  }

  // Pure recency-based sorting: always newest articles first
  const now = Date.now();

  const sorted = allArticles.sort((a, b) => {
    // Newest first (smallest age = highest priority)
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  // Apply smart filtering to skip low-value content
  const filtered = [];
  const skipped = [];

  for (const article of sorted) {
    const check = shouldEnhanceArticle(article);
    if (check.enhance) {
      filtered.push(article);
    } else {
      skipped.push({ title: article.title, reason: check.reason });
    }
    
    // Stop once we have enough qualifying articles
    if (filtered.length >= limit) break;
  }

  // Log skipped articles (for visibility into cost savings)
  if (skipped.length > 0) {
    console.log(`   💰 Smart filter: Skipped ${skipped.length} low-value articles:`);
    skipped.slice(0, 5).forEach((s) => {
      console.log(`      ⏭️  ${s.title?.substring(0, 40)}... - ${s.reason}`);
    });
    if (skipped.length > 5) {
      console.log(`      ... and ${skipped.length - 5} more`);
    }
  }

  // Return only the requested limit
  const result = filtered.slice(0, limit);

  if (result.length > 0) {
    const newCount = result.filter((a) => !a.isRetry).length;
    const retryCount = result.filter((a) => a.isRetry).length;

    console.log(`   📊 Newest-first order (${newCount} new, ${retryCount} retry):`);
    result.forEach((a, i) => {
      const ageHours = ((now - new Date(a.createdAt).getTime()) / (1000 * 60 * 60)).toFixed(1);
      const retryTag = a.isRetry ? " [RETRY]" : "";
      console.log(
        `      ${i + 1}. [${a.sourceName}] ${ageHours}h ago${retryTag} - ${a.title?.substring(
          0,
          35
        )}...`
      );
    });
  }

  return result;
}

// ============================================
// MAIN FUNCTION
// ============================================

async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║     Content Enhancer - Perplexity Sonar                    ║
╠════════════════════════════════════════════════════════════╣
║  Started: ${new Date().toISOString()}              ║
╚════════════════════════════════════════════════════════════╝
`);

  // Validate API keys
  const hasApiKey = CONFIG.PRIMARY_API_KEY || CONFIG.FALLBACK_API_KEY;
  if (!hasApiKey) {
    console.error("❌ No Perplexity API keys set in .env (PERPLEXITY_API_KEY_MATCH_INSIGHTS or PERPLEXITY_API_KEY)");
    process.exit(1);
  }
  console.log(`✅ Perplexity API keys loaded (${CONFIG.PRIMARY_API_KEY ? 'Primary' : ''}${CONFIG.PRIMARY_API_KEY && CONFIG.FALLBACK_API_KEY ? ' + ' : ''}${CONFIG.FALLBACK_API_KEY ? 'Fallback' : ''})`);

  try {
    // Initialize database
    console.log("\n🔌 Connecting to database...");
    await initDatabase();

    // Fetch articles
    console.log(
      `\n📊 Fetching up to ${CONFIG.BATCH_SIZE} unprocessed articles...`
    );
    const articles = await fetchArticlesToEnhance(CONFIG.BATCH_SIZE);

    if (articles.length === 0) {
      console.log("✅ No articles to enhance. All caught up!");
      return;
    }

    console.log(`✅ Found ${articles.length} articles to enhance\n`);
    articles.forEach((a, i) => {
      console.log(
        `   ${i + 1}. [${a.id.substring(0, 8)}...] ${a.title?.substring(
          0,
          50
        )}...`
      );
    });

    // Call Perplexity API
    const response = await callPerplexityAPI(articles);

    // Parse response
    const enhanced = parseResponse(response);

    if (!enhanced || enhanced.length === 0) {
      console.log("\n❌ Failed to get enhanced content");
      return;
    }

    // Save to database
    const saved = await saveEnhancedContent(enhanced, articles);

    // Summary
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                    ENHANCEMENT SUMMARY                      ║
╠════════════════════════════════════════════════════════════╣
║  ✅ Successfully enhanced: ${saved.toString().padEnd(30)}║
║  📊 Total processed: ${articles.length.toString().padEnd(35)}║
╚════════════════════════════════════════════════════════════╝
`);
  } catch (error) {
    console.error("\n❌ Fatal error:", error.message);
    console.error(error.stack);
  } finally {
    await closeDatabase();
    console.log("✅ Content enhancer completed.");
  }
}

// Run
main();
