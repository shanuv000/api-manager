/**
 * Content Enhancer using Perplexity Sonar Pro API
 *
 * Enhances scraped cricket articles with AI-generated rich content
 * Uses Perplexity's Sonar Pro model for high-quality, SEO-optimized output
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
  MODEL: "sonar", // Cost-effective model (~$2/month vs $12 for pro)
  BATCH_SIZE: 6, // Process 6 articles per run (~$0.01/run)
  CONTENT_MAX_LENGTH: 800, // Context per article
  MAX_TOKENS: 6000, // Allow longer responses for 6 articles
  TEMPERATURE: 0.7, // Balance between creativity and consistency
};

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
 * Optimized for: SEO, natural length, content uniqueness
 */
const SYSTEM_PROMPT = `You are a senior cricket journalist creating ORIGINAL content for a premium cricket blog. Your goal is to produce SEO-optimized, completely unique articles that add genuine value.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 CONTENT UNIQUENESS (CRITICAL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You must COMPLETELY REWRITE the content. Google will penalize duplicate content.

DO:
✓ Use entirely different sentence structures
✓ Add your own analysis and perspective
✓ Include context the original didn't have (cricket history, comparisons)
✓ Create original analogies and insights
✓ Rephrase all quotes with attribution

DON'T:
✗ Copy any phrases from the source
✗ Just rearrange words from original
✗ Use the same paragraph order
✗ Keep the same opening angle

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 SEO OPTIMIZATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- enhancedTitle: Include primary keyword naturally (50-60 chars)
- metaDescription: Compelling, include keyword, call-to-action (150-155 chars)
- Use ### headings with relevant keywords
- Bold important keywords naturally: **player name**, **match result**
- Natural keyword density (don't stuff)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📏 NATURAL LENGTH (NOT ARTIFICIAL PADDING)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Write the RIGHT length for each topic:
- Breaking news/short update: 300-400 words
- Match report/analysis: 500-700 words
- In-depth feature: 700-900 words

NEVER pad content. Every sentence must add value.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✍️ WRITING STYLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Expert cricket analyst voice (like Harsha Bhogle)
- Add genuine insights: historical comparisons, tactical analysis
- Use ### for 2-3 meaningful sections (not generic headers)
- > blockquotes for key quotes (use 'single quotes')
- Short paragraphs for readability
- End with forward-looking statement, not summary

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📤 OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

  return `COMPLETELY REWRITE these ${
    articles.length
  } article(s) into UNIQUE, SEO-optimized content.

SOURCE ARTICLES (use as reference only - do NOT copy phrases):
${JSON.stringify(inputData, null, 2)}

REQUIREMENTS:
1. UNIQUENESS: Rewrite completely - different structure, wording, and angle
2. LENGTH: Natural for the topic (300-500 words for news, 500-700 for analysis)
3. SEO: Include keywords naturally in title, headings, and content
4. VALUE: Add cricket insights, historical context, or tactical analysis

JSON OUTPUT ONLY:
[{"id":"${
    articles[0]?.id
  }","enhancedTitle":"SEO title 50-60 chars","enhancedContent":"### Markdown content with **bold** > quotes","metaDescription":"155 chars with keyword","keyTakeaways":["insight1","insight2","insight3"]}]`;
}

/**
 * Call Perplexity Sonar Pro API
 */
async function callPerplexityAPI(articles) {
  const userPrompt = buildUserPrompt(articles);

  console.log(`\n🤖 Calling Perplexity Sonar Pro API...`);
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
 * Save enhanced content to database
 */
async function saveEnhancedContent(enhanced, originalArticles) {
  console.log(`\n💾 Saving enhanced content...`);
  let saved = 0;

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

      console.log(`   ✅ Saved: ${item.enhancedTitle?.substring(0, 50)}...`);
      saved++;
    } catch (error) {
      console.log(`   ❌ Save error for ${item.id}: ${error.message}`);
    }
  }

  return saved;
}

/**
 * Fetch articles that need enhancement
 */
async function fetchArticlesToEnhance(limit) {
  const articles = await prisma.newsArticle.findMany({
    where: {
      enhancedContent: null,
      content: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return articles;
}

// ============================================
// MAIN FUNCTION
// ============================================

async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║     Content Enhancer - Perplexity Sonar Pro                ║
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
