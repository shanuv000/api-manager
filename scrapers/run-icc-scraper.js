// Run ICC Cricket scraper and save to database
// Used by GitHub Actions workflow or manual execution
// Only saves articles that have actual content

require("dotenv").config();

const ICCNewsScraper = require("./icc-news-scraper");
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
  const wordCount = article.details?.wordCount || 0;

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
 * Parse ICC date formats
 * Handles: "22 December, 2025", "5h", "20h", "1d", etc.
 */
function parseICCPublishTime(timeString) {
  if (!timeString) return null;

  const trimmed = timeString.trim();

  // Try standard parsePublishTime first
  const standardParse = parsePublishTime(trimmed);
  if (standardParse) return standardParse;

  // Handle ICC relative format: "5h", "20h", "1d", "2d"
  const relMatch = trimmed.match(/^(\d+)([hd])$/i);
  if (relMatch) {
    const value = parseInt(relMatch[1], 10);
    const unit = relMatch[2].toLowerCase();
    const now = new Date();

    if (unit === "h") {
      now.setHours(now.getHours() - value);
    } else if (unit === "d") {
      now.setDate(now.getDate() - value);
    }
    return now.toISOString();
  }

  // Handle "22 December, 2025" format
  const dateMatch = trimmed.match(/^(\d{1,2})\s+(\w+),?\s+(\d{4})$/);
  if (dateMatch) {
    try {
      const dateObj = new Date(
        `${dateMatch[2]} ${dateMatch[1]}, ${dateMatch[3]}`
      );
      if (!isNaN(dateObj.getTime())) {
        return dateObj.toISOString();
      }
    } catch (e) {}
  }

  // Final fallback
  try {
    const dateObj = new Date(trimmed);
    if (!isNaN(dateObj.getTime())) {
      return dateObj.toISOString();
    }
  } catch (e) {}

  return null;
}

/**
 * Generate ICC specific sourceId
 */
function generateSourceId(article) {
  return `icc-${article.id}`;
}

async function runICCScraper() {
  const pool = new Pool({
    connectionString: connectionString,
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool),
  });

  const scraper = new ICCNewsScraper({
    VERBOSE_LOGGING: true,
  });

  const useAutoTagging = !!process.env.PERPLEXITY_API_KEY;

  try {
    console.log("🌐 ICC Cricket News Scraper - Database Integration");
    console.log("━".repeat(60));

    // STEP 1: Fetch articles with details
    console.log("\n📡 Fetching news with detailed content...");
    const limit = 15;
    const articlesWithDetails = await scraper.fetchLatestNewsWithDetails(limit);
    console.log(
      `   Fetched ${articlesWithDetails.length} articles with details\n`
    );

    // STEP 2: Pre-fetch existing articles from DB
    const sourceIds = articlesWithDetails.map((a) => generateSourceId(a));
    const existingArticles = await prisma.newsArticle.findMany({
      where: {
        sourceId: { in: sourceIds },
        sourceName: "ICC Cricket",
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
    console.log(`   Found ${existingMap.size} existing articles in DB\n`);

    // STEP 3: Process articles
    let savedCount = 0;
    let skippedNoContent = 0;
    let skippedDuplicate = 0;
    let updatedCount = 0;
    let errorCount = 0;

    console.log("📝 Processing articles...\n");

    for (let i = 0; i < articlesWithDetails.length; i++) {
      const article = articlesWithDetails[i];
      const sourceId = generateSourceId(article);
      const title = article.title;

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
        const publishedTime = parseICCPublishTime(
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

        if (existing) {
          // UPDATE existing article
          await prisma.newsArticle.update({
            where: { sourceId: sourceId },
            data: {
              title: title,
              description: description.substring(0, 500),
              content: content,
              imageUrl: details.mainImage || article.imageUrl,
              thumbnailUrl: article.imageUrl || details.mainImage,
              publishedTime: publishedTime,
              ...(tags.length > 0 &&
              (!existing.tags || existing.tags.length === 0)
                ? { tags }
                : {}),
              relatedArticles: details.relatedArticles || null,
              embeddedTweets: details.embeddedTweets?.map((t) => t.id) || [],
              embeddedInstagram:
                details.embeddedInstagram?.map((ig) => ig.id) || [],
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
              category: article.category || "news",
              sourceName: "ICC Cricket",
              title: title,
              description: description.substring(0, 500),
              content: content,
              imageUrl: details.mainImage || article.imageUrl,
              thumbnailUrl: article.imageUrl || details.mainImage,
              sourceUrl: article.link,
              publishedTime: publishedTime,
              metaTitle: title,
              metaDesc: metaDescription,
              tags: tags,
              relatedArticles: details.relatedArticles || null,
              embeddedTweets: details.embeddedTweets?.map((t) => t.id) || [],
              embeddedInstagram:
                details.embeddedInstagram?.map((ig) => ig.id) || [],
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
    console.log("📊 ICC CRICKET SCRAPER SUMMARY:");
    console.log("━".repeat(60));
    console.log(`   ✅ New articles saved:      ${savedCount}`);
    console.log(`   🔄 Updated articles:        ${updatedCount}`);
    console.log(`   ⏭️  Skipped (no content):   ${skippedNoContent}`);
    console.log(`   ⏭️  Skipped (duplicate):    ${skippedDuplicate}`);
    console.log(`   ❌ Errors:                  ${errorCount}`);

    // Verify totals
    const cricbuzzCount = await prisma.newsArticle.count({
      where: { sourceName: "Cricbuzz" },
    });
    const espnCount = await prisma.newsArticle.count({
      where: { sourceName: "ESPN Cricinfo" },
    });
    const iccCount = await prisma.newsArticle.count({
      where: { sourceName: "ICC Cricket" },
    });
    const totalCount = await prisma.newsArticle.count();

    console.log("━".repeat(60));
    console.log("📚 DATABASE TOTALS:");
    console.log(`   Cricbuzz articles:      ${cricbuzzCount}`);
    console.log(`   ESPN Cricinfo articles: ${espnCount}`);
    console.log(`   ICC Cricket articles:   ${iccCount}`);
    console.log(`   Total articles:         ${totalCount}`);
    console.log("━".repeat(60));

    // STEP 5: Invalidate news cache if new articles were saved
    if (savedCount > 0 || updatedCount > 0) {
      console.log("\n🗑️  Invalidating news cache...");
      const { invalidateNewsCache } = require("../component/redisClient");
      await invalidateNewsCache();
    }
  } catch (error) {
    console.error("❌ Error running ICC Cricket scraper:", error);
    process.exit(1);
  } finally {
    await scraper.closeBrowser();
    await prisma.$disconnect();
    await pool.end();
  }
}

runICCScraper();
