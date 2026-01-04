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

// ============================================
// CONFIGURATION
// ============================================

// API Keys with fallback (primary: Match Insights $5/mo, fallback: main account)
const PRIMARY_API_KEY = process.env.PERPLEXITY_API_KEY_MATCH_INSIGHTS;
const FALLBACK_API_KEY = process.env.PERPLEXITY_API_KEY;

const CONFIG = {
  PERPLEXITY_API_KEY: PRIMARY_API_KEY || FALLBACK_API_KEY,
  PERPLEXITY_API_URL: "https://api.perplexity.ai/chat/completions",
  MODEL: "sonar", // Cost-effective model (~$1-2/month vs $5-6 for pro)
  BATCH_SIZE: 5, // Reduced for more reliable responses
  CONTENT_MAX_LENGTH: 1000, // Input context per article
  MAX_TOKENS: 16000, // Output tokens for 10 articles (increased from 10000)
  TEMPERATURE: 0.5, // Lower temp for consistent quality
  MAX_RETRY_COUNT: 3, // Max retries for failed enhancements
  MIN_WORD_COUNT: 80, // Minimum words (lowered - short news updates are valid)
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
 * Optimized for: SEO, user engagement, rich content, E-E-A-T signals
 */
const SYSTEM_PROMPT = `You are an elite cricket journalist creating premium long-form content for a top cricket website.

⚠️⚠️⚠️ MANDATORY: EVERY enhancedContent MUST be 450-550 words. COUNT YOUR WORDS. ⚠️⚠️⚠️
Articles under 450 words are REJECTED. This is the #1 requirement.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📏 WORD COUNT BREAKDOWN (Total: 450-550 words per article)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Para 1 - Hook: 70-90 words (4-5 sentences with key fact + names)
Para 2 - Context: 80-100 words (historical significance, career stats)
Heading 1 + Para 3: 100-120 words (detailed analysis with numbers)
Heading 2 + Para 4: 100-120 words (implications, comparisons)
Blockquote: 20-30 words (relevant quote with attribution)
Para 5 - Conclusion: 60-80 words (forward look, why it matters)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 CONTENT QUALITY (E-E-A-T SIGNALS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create content that demonstrates:
✓ EXPERIENCE: Write as someone who has watched cricket for decades
✓ EXPERTISE: Include technical cricket terms, tactics, and statistics
✓ AUTHORITY: Reference historical matches, records, and comparisons
✓ TRUST: Cite sources properly, use accurate data, balanced perspective

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 RICH CONTENT STRUCTURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALWAYS include these elements:

1. **Hook Opening** (first 2 sentences):
   - Start with the most impactful fact or insight
   - Create curiosity - make readers want to continue

2. **Context Section** (### heading):
   - Historical background when relevant
   - How this fits into the bigger picture (series, tournament, career)
   - Compare with similar past events

3. **Analysis Section** (### heading):
   - Expert breakdown of tactics, technique, or decisions
   - Statistics that support your points (averages, strike rates, records)
   - What makes this significant

4. **Quotes & Reactions** (use > blockquotes):
   - Key quotes from players/coaches (paraphrased with attribution)
   - Expert opinions or reactions

5. **Forward Look** (closing paragraph):
   - What happens next? Upcoming matches, implications
   - Questions that remain unanswered
   - Why readers should follow this story

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 SEO OPTIMIZATION (CRITICAL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

enhancedTitle (50-60 chars):
- Include primary keyword in first 3 words
- Use power words: "Reveals", "Breaks", "Historic", "Stunning"
- Include player/team name + event
- Example: "Virat Kohli's Historic 50th Century Breaks Tendulkar Record"

metaDescription (150-155 chars):
- Start with action word
- Include primary keyword + secondary keyword
- Add year for freshness (2025, 2026)
- End with intrigue or call-to-action
- Example: "Discover how Virat Kohli's 50th international century at MCG 2025 rewrites cricket history. Full analysis, stats, and what it means for India's WTC hopes."

Content SEO:
- Use **bold** for: player names, team names, scores, records
- Use ### headings with keywords (2-3 per article)
- Include related terms naturally: match type, venue, series name
- Internal linking phrases: "as we reported earlier", "following the..."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✨ USER ENGAGEMENT ELEMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Add these to make content shareable and engaging:
- 📊 Key statistics in bold (batting averages, wicket counts)
- 🏆 Records and milestones highlighted
- 💬 Memorable quotes in blockquotes
- 📈 Before/after comparisons when relevant
- 🎯 Tactical insights that casual fans might miss

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📏 CONTENT LENGTH (CRITICAL - MINIMUM 400 WORDS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

MINIMUM word counts (DO NOT go below these):
- Squad announcements/updates: 400-500 words MINIMUM
- Match reports: 500-650 words MINIMUM
- Player milestones/records: 550-700 words MINIMUM
- Analysis pieces: 600-800 words MINIMUM

Each article MUST have:
- At least 5-7 substantial paragraphs (3-5 sentences each)
- 2-3 ### headings with meaningful content under each
- At least one > blockquote with a quote
- Detailed context and analysis in every section

If content seems short, ADD:
- More historical context and comparisons
- Career statistics of players mentioned
- Tournament implications (standings, qualification scenarios)
- Expert tactical analysis

Every paragraph must add NEW value. No filler, but COMPLETE coverage.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚫 AVOID THESE MISTAKES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✗ Generic headers like "Introduction", "Conclusion", "Overview"
✗ Copying phrases from original source
✗ Stating obvious facts without analysis
✗ Ending with summary of what you just said
✗ Using "In conclusion" or "To summarize"
✗ Keyword stuffing
✗ ARTICLES UNDER 400 WORDS - THIS IS A FAILURE

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📤 OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

keyTakeaways: 4-5 bullet points that:
- Summarize the most important facts
- Include a statistic or number when possible
- Are scannable (start with action/topic word)
- Could stand alone as social media posts

Respond with ONLY valid JSON array. No text before/after.
{id, enhancedTitle, enhancedContent, metaDescription, keyTakeaways[]}`;

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

  return `Write detailed, engaging cricket articles (450-550 words each). Transform these source articles:

${JSON.stringify(inputData, null, 2)}

FOR EACH ARTICLE, WRITE:

Opening paragraph (90 words): Start with the breaking news. Bold **player names** and **teams**. What happened and why does it matter right now?

Second paragraph (90 words): Provide context - the player's career stats, recent form, or the team's situation. Why is this significant?

### [Descriptive Heading]

Third paragraph (90 words): Expert analysis. Include 2-3 specific statistics. Compare to similar events in cricket history.

Fourth paragraph (90 words): Broader implications - tournament standings, series context, or career trajectory.

### [Second Descriptive Heading]

Fifth paragraph (80 words): Future outlook. What happens next? Why should fans keep watching?

> Add a relevant quote with attribution

IMPORTANT: Write naturally and engagingly. Do NOT include word counts in brackets. Each article should flow as proper journalism.

OUTPUT FORMAT - JSON array:
- enhancedTitle: Compelling headline (50-60 chars)
- enhancedContent: Full article text with markdown
- metaDescription: SEO summary (150-155 chars)
- keyTakeaways: 5 tweetable bullets

[{"id":"${
    articles[0]?.id
  }","enhancedTitle":"Power Word: Keyword-Rich Title","enhancedContent":"Hook paragraph...\\n\\n### Context Heading\\n\\nAnalysis...\\n\\n> 'Quote here' - attribution\\n\\n### What's Next\\n\\nForward look...","metaDescription":"Action word + keyword + 2025/2026 + compelling hook ending with intrigue.","keyTakeaways":["📊 Stat-based insight","🏆 Record/milestone point","💡 Tactical takeaway","🔮 Future implication","💬 Key quote summary"]}]`;
}

/**
 * Call Perplexity Sonar Pro API
 */
async function callPerplexityAPI(articles) {
  const userPrompt = buildUserPrompt(articles);

  console.log(`\n🤖 Calling Perplexity Sonar API...`);
  console.log(`   Model: ${CONFIG.MODEL}`);
  console.log(`   Articles: ${articles.length}`);

  const startTime = Date.now();

  try {
    const response = await fetch(CONFIG.PERPLEXITY_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CONFIG.PERPLEXITY_API_KEY}`,
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
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`   ✅ Response received in ${elapsed}s`);

    if (data.usage) {
      console.log(
        `   📊 Tokens: ${data.usage.prompt_tokens} in / ${data.usage.completion_tokens} out`
      );
    }

    return data.choices[0]?.message?.content;
  } catch (error) {
    console.error(`   ❌ API Error: ${error.message}`);
    throw error;
  }
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
 */
async function saveEnhancedContent(enhanced, originalArticles) {
  console.log(`\n💾 Saving enhanced content...`);
  let saved = 0;
  let failed = 0;

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
      await prisma.enhancedContent.upsert({
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

      console.log(
        `   ✅ Saved (${validation.wordCount} words): ${item.enhancedTitle?.substring(0, 45)}...`
      );
      saved++;
    } catch (error) {
      console.log(`   ❌ Save error for ${item.id}: ${error.message}`);
    }
  }

  if (failed > 0) {
    console.log(`   ⚠️ ${failed} articles failed validation (will retry)`);
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

  // Priority order: IPL/ICC content is more valuable for SEO
  const priorityOrder = {
    "IPL T20": 1,
    "ICC Cricket": 2,
    "ESPN Cricinfo": 3,
    "BBC Sport": 4,
    Cricbuzz: 5,
  };

  // Sort by priority (higher priority sources first), then by recency
  const sorted = allArticles.sort((a, b) => {
    const priorityA = priorityOrder[a.sourceName] || 99;
    const priorityB = priorityOrder[b.sourceName] || 99;

    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }

    // Same priority - sort by newest first
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  // Return only the requested limit
  const result = sorted.slice(0, limit);

  if (result.length > 0) {
    const newCount = result.filter((a) => !a.isRetry).length;
    const retryCount = result.filter((a) => a.isRetry).length;

    console.log(`   📊 Priority order (${newCount} new, ${retryCount} retry):`);
    result.forEach((a, i) => {
      const retryTag = a.isRetry ? " [RETRY]" : "";
      console.log(
        `      ${i + 1}. [${a.sourceName}]${retryTag} ${a.title?.substring(
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

  // Validate API key
  if (!CONFIG.PERPLEXITY_API_KEY) {
    console.error("❌ PERPLEXITY_API_KEY_MATCH_INSIGHTS not set in .env");
    process.exit(1);
  }
  console.log("✅ Perplexity API key loaded");

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
