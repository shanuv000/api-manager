// Run Cricbuzz Cricket scraper and save to database
// Used by GitHub Actions workflow or manual execution
// Only saves articles that have actual content

require("dotenv").config();

const CricbuzzNewsScraper = require("./cricbuzz-news-scraper");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");
const { parsePublishTime } = require("../utils/timeParser");
const { generateTags } = require("../utils/perplexityTagger");

const connectionString = process.env.DATABASE_URL;

// Minimum content requirements
const MIN_CONTENT_LENGTH = 100;
const MIN_WORD_COUNT = 20;

/**
 * Validate if article has sufficient content
 */
function validateContent(article) {
  const content = article.details?.content || "";
  const wordCount = content.split(/\s+/).filter((w) => w).length || 0;

  if (!content || content.trim().length < MIN_CONTENT_LENGTH) {
    return {
      valid: false,
      reason: `Content too short (${content.length} chars, min: ${MIN_CONTENT_LENGTH})`,
    };
  }

  if (wordCount < MIN_WORD_COUNT) {
    return {
      valid: false,
      reason: `Word count too low (${wordCount} words, min: ${MIN_WORD_COUNT})`,
    };
  }

  const boilerplatePatterns = [
    "cookie",
    "privacy policy",
    "terms of use",
    "consent",
    "gdpr",
  ];

  const lowerContent = content.toLowerCase();
  for (const pattern of boilerplatePatterns) {
    if (lowerContent.includes(pattern) && content.length < 300) {
      return {
        valid: false,
        reason: `Likely boilerplate content (contains "${pattern}")`,
      };
    }
  }

  return { valid: true, reason: "Content validated" };
}

/**
 * Generate SEO meta description
 */
function generateMetaDescription(title, content, description) {
  if (content && content.length > 160) {
    const sentences = content
      .split(/[.!?]+/)
      .filter((s) => s.trim().length > 20);
    if (sentences.length > 1) {
      const metaBase = sentences[1]?.trim() || sentences[0]?.trim();
      return metaBase.substring(0, 155).trim() + "...";
    }
  }

  const titleWords = title.split(" ").slice(0, 3).join(" ");
  const descStart = (description || "").substring(0, 120);
  return `${titleWords}: ${descStart}`.substring(0, 155).trim() + "...";
}

/**
 * Parse Cricbuzz date formats
 * Handles: "Sun, Dec 14, 2025 • 9:09 AM", relative times, etc.
 */
function parseCricbuzzPublishTime(timeString) {
  if (!timeString) return null;

  const trimmed = timeString.trim();

  // Try standard parsePublishTime first
  const standardParse = parsePublishTime(trimmed);
  if (standardParse) return standardParse;

  // Handle Cricbuzz format: "Sun, Dec 14, 2025 • 9:09 AM"
  const cricbuzzMatch = trimmed.match(
    /(\w{3}),\s+(\w{3})\s+(\d{1,2}),\s+(\d{4})/
  );
  if (cricbuzzMatch) {
    try {
      const dateStr = `${cricbuzzMatch[2]} ${cricbuzzMatch[3]}, ${cricbuzzMatch[4]}`;
      const dateObj = new Date(dateStr);
      if (!isNaN(dateObj.getTime())) {
        return dateObj.toISOString();
      }
    } catch (e) { }
  }

  // Handle relative format: "5h ago", "2d ago"
  const relMatch = trimmed.match(/^(\d+)\s*(h|d|hr|hrs|day|days)\s*ago?$/i);
  if (relMatch) {
    const value = parseInt(relMatch[1], 10);
    const unit = relMatch[2].toLowerCase();
    const now = new Date();

    if (unit.startsWith("h")) {
      now.setHours(now.getHours() - value);
    } else if (unit.startsWith("d")) {
      now.setDate(now.getDate() - value);
    }
    return now.toISOString();
  }

  // Final fallback
  try {
    const dateObj = new Date(trimmed);
    if (!isNaN(dateObj.getTime())) {
      return dateObj.toISOString();
    }
  } catch (e) { }

  return null;
}

/**
 * Generate Cricbuzz specific sourceId
 */
function generateSourceId(article) {
  return article.id;
}

async function runCricbuzzScraper() {
  const pool = new Pool({
    connectionString: connectionString,
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool),
  });

  const scraper = new CricbuzzNewsScraper({
    VERBOSE_LOGGING: true,
  });

  const useAutoTagging = !!process.env.PERPLEXITY_API_KEY;

  try {
    console.log("🌐 Cricbuzz News Scraper - Database Integration");
    console.log("━".repeat(60));

    if (useAutoTagging) {
      console.log("🏷️  Perplexity AI tagging: ENABLED");
    } else {
      console.log(
        "⚠️  Perplexity AI tagging: DISABLED (set PERPLEXITY_API_KEY to enable)"
      );
    }

    // PHASE 1: Fetch article listing only (1 page load)
    console.log("\n📡 Phase 1: Fetching article listing...");
    const limit = 10;
    const LISTING_BUFFER = 2;
    const articleList = await scraper.fetchLatestNews();
    const limitedList = articleList.slice(0, limit + LISTING_BUFFER);
    console.log(
      `   Found ${articleList.length} articles in listing, processing top ${limitedList.length}\n`
    );

    // PHASE 2: DB pre-scan to identify new/changed articles
    console.log("🔍 Phase 2: DB pre-scan...");
    const sourceIds = limitedList.map((a) => generateSourceId(a));
    const existingArticles = await prisma.newsArticle.findMany({
      where: {
        sourceId: { in: sourceIds },
        sourceName: "Cricbuzz",
      },
      select: { sourceId: true, title: true, tags: true },
    });

    const existingMap = new Map();
    for (const article of existingArticles) {
      existingMap.set(article.sourceId, {
        title: article.title,
        tags: article.tags,
      });
    }
    console.log(`   Found ${existingMap.size} existing articles in DB`);

    // Filter to only articles needing detail fetch
    const articlesNeedingDetails = limitedList.filter((article) => {
      const sourceId = generateSourceId(article);
      const existing = existingMap.get(sourceId);
      return !existing || existing.title !== article.title;
    });

    // Count pre-filtered duplicates
    let skippedDuplicate = limitedList.length - articlesNeedingDetails.length;
    console.log(
      `   ${articlesNeedingDetails.length} articles need detail fetching (${skippedDuplicate} unchanged duplicates skipped)\n`
    );

    // PHASE 3: Fetch details ONLY for new/changed articles
    const articlesWithDetails = [];
    if (articlesNeedingDetails.length > 0) {
      console.log(
        `📚 Phase 3: Fetching details for ${articlesNeedingDetails.length} articles...\n`
      );
      for (let i = 0; i < articlesNeedingDetails.length; i++) {
        const article = articlesNeedingDetails[i];
        console.log(
          `   [${i + 1}/${articlesNeedingDetails.length}] ${article.title.substring(0, 60)}...`
        );
        try {
          const details = await scraper.fetchArticleDetails(article.link);
          articlesWithDetails.push({ ...article, details });
          if (i < articlesNeedingDetails.length - 1) {
            await scraper.delay(2000); // Rate limiting between detail fetches
          }
        } catch (error) {
          console.error(`   ⚠️ Failed to fetch details: ${error.message}`);
          // Skip articles without details - don't save incomplete data
        }
      }
      console.log(
        `   Fetched details for ${articlesWithDetails.length}/${articlesNeedingDetails.length} articles\n`
      );
    } else {
      console.log("✅ All articles already exist and are unchanged — no detail fetching needed\n");
    }

    // STEP 4: Process articles with details
    let savedCount = 0;
    let skippedNoContent = 0;
    let updatedCount = 0;
    let errorCount = 0;

    if (articlesWithDetails.length > 0) {
      console.log("📝 Processing articles...\n");
    }

    for (let i = 0; i < articlesWithDetails.length; i++) {
      const article = articlesWithDetails[i];
      const sourceId = generateSourceId(article);
      const title = article.details?.title || article.title;

      console.log(
        `${i + 1}/${articlesWithDetails.length} - ${title.substring(0, 50)}...`
      );

      // Validate content
      const validation = validateContent(article);
      if (!validation.valid) {
        console.log(`   ⏭️  Skipped: ${validation.reason}`);
        skippedNoContent++;
        continue;
      }

      try {
        const existing = existingMap.get(sourceId);

        // Check for unchanged duplicates
        if (existing && existing.title === title) {
          console.log(`   ⏭️  Skipped: Already exists (unchanged)`);
          skippedDuplicate++;
          continue;
        }

        // Prepare data
        const details = article.details || {};
        const content = details.content || "";
        const description = details.seoDescription || article.description || "";
        const metaDescription = generateMetaDescription(
          title,
          content,
          description
        );

        // Parse published time
        const publishedTime = parseCricbuzzPublishTime(
          details.publishedTime || article.publishedTime
        );

        // Generate or preserve tags - ALWAYS use Perplexity AI for new articles
        let tags = [];
        if (existing?.tags && existing.tags.length > 0) {
          // Preserve existing tags from DB
          tags = existing.tags;
        } else if (useAutoTagging) {
          // Always generate with AI for consistent SEO tags
          tags = await generateTags(title, content || description);
          if (tags.length > 0) {
            console.log(`   🏷️  AI tags: ${tags.join(", ")}`);
          }
        }

        // Prepare related articles JSON
        const relatedArticles =
          details.relatedArticles && details.relatedArticles.length > 0
            ? details.relatedArticles
            : null;

        if (existing) {
          // UPDATE existing article
          await prisma.newsArticle.update({
            where: { sourceId: sourceId },
            data: {
              title: title,
              description: description.substring(0, 500),
              content: content,
              imageUrl: details.mainImage || article.imageUrl,
              thumbnailUrl: article.thumbnailUrl || details.mainImage,
              publishedTime: publishedTime,
              ...(tags.length > 0 &&
                (!existing.tags || existing.tags.length === 0)
                ? { tags }
                : {}),
              relatedArticles: relatedArticles,
              updatedAt: new Date(),
            },
          });
          updatedCount++;
          console.log(`   🔄 Updated`);
        } else {
          // CREATE new article
          await prisma.newsArticle.create({
            data: {
              sourceId: sourceId,
              slug: article.id,
              sport: "cricket",
              category: "news",
              sourceName: "Cricbuzz",
              title: title,
              description: description.substring(0, 500),
              content: content,
              imageUrl: details.mainImage || article.imageUrl,
              thumbnailUrl: article.thumbnailUrl || details.mainImage,
              sourceUrl: article.link,
              publishedTime: publishedTime,
              metaTitle: title,
              metaDesc: metaDescription,
              tags: tags,
              relatedArticles: relatedArticles,
              scrapedAt: new Date(),
            },
          });
          savedCount++;
          console.log(`   ✅ Saved`);
        }

        // Rate limiting
        await scraper.delay(500);
      } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
        errorCount++;
      }
    }

    // STEP 4: Summary
    console.log("\n" + "━".repeat(60));
    console.log("📊 CRICBUZZ SCRAPER SUMMARY:");
    console.log("━".repeat(60));
    console.log(`   ✅ New articles saved:      ${savedCount}`);
    console.log(`   🔄 Updated articles:        ${updatedCount}`);
    console.log(`   ⏭️  Skipped (no content):   ${skippedNoContent}`);
    console.log(`   ⏭️  Skipped (duplicate):    ${skippedDuplicate}`);
    console.log(`   ❌ Errors:                  ${errorCount}`);

    // Verify totals by source
    const cricbuzzCount = await prisma.newsArticle.count({
      where: { sourceName: "Cricbuzz" },
    });
    const iccCount = await prisma.newsArticle.count({
      where: { sourceName: "ICC Cricket" },
    });
    const bbcCount = await prisma.newsArticle.count({
      where: { sourceName: "BBC Sport" },
    });
    const espnCount = await prisma.newsArticle.count({
      where: { sourceName: "ESPN Cricinfo" },
    });
    const totalCount = await prisma.newsArticle.count();

    console.log("━".repeat(60));
    console.log("📚 DATABASE TOTALS:");
    console.log(`   Cricbuzz articles:      ${cricbuzzCount}`);
    console.log(`   ICC Cricket articles:   ${iccCount}`);
    console.log(`   BBC Sport articles:     ${bbcCount}`);
    console.log(`   ESPN Cricinfo articles: ${espnCount}`);
    console.log(`   Total articles:         ${totalCount}`);
    console.log("━".repeat(60));

    // STEP 5: Invalidate news cache if new articles were saved
    if (savedCount > 0 || updatedCount > 0) {
      console.log("\n🗑️  Invalidating news cache...");
      const { invalidateNewsCache } = require("../component/redisClient");
      await invalidateNewsCache();
    }
  } catch (error) {
    console.error("❌ Error running Cricbuzz scraper:", error);
    process.exit(1);
  } finally {
    await scraper.closeBrowser();
    await prisma.$disconnect();
    await pool.end();
  }
}

runCricbuzzScraper();
