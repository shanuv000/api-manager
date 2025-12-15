// Run ESPN Cricinfo scraper directly and save to database
// Used by GitHub Actions workflow
// Only saves articles that have actual content (skips empty/minimal content)

const ESPNCricinfoScraper = require('./espncricinfo-news-scraper');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const { parsePublishTime } = require('../utils/timeParser');
const { generateTags } = require('../utils/perplexityTagger');

// In CI environments (GitHub Actions, Vercel), use DATABASE_URL with PgBouncer
const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS || !!process.env.VERCEL;
const connectionString = isCI ? process.env.DATABASE_URL : (process.env.DIRECT_URL || process.env.DATABASE_URL);

// Minimum content requirements to save an article
const MIN_CONTENT_LENGTH = 100; // Minimum characters for content
const MIN_WORD_COUNT = 20; // Minimum words for content

/**
 * Validate if article has sufficient content to be saved
 * @param {Object} article - Article object with details
 * @returns {Object} - { valid: boolean, reason: string }
 */
function validateContent(article) {
  const content = article.details?.content || '';
  const wordCount = article.details?.wordCount || 0;
  
  // Check if content exists and is substantial
  if (!content || content.trim().length < MIN_CONTENT_LENGTH) {
    return { 
      valid: false, 
      reason: `Content too short (${content.length} chars, min: ${MIN_CONTENT_LENGTH})` 
    };
  }
  
  if (wordCount < MIN_WORD_COUNT) {
    return { 
      valid: false, 
      reason: `Word count too low (${wordCount} words, min: ${MIN_WORD_COUNT})` 
    };
  }
  
  // Check for boilerplate/cookie consent content
  const boilerplatePatterns = [
    'cookie',
    'privacy policy',
    'terms of use',
    'accept cookies',
    'consent',
    'gdpr',
    'personal information',
  ];
  
  const lowerContent = content.toLowerCase();
  for (const pattern of boilerplatePatterns) {
    if (lowerContent.includes(pattern) && content.length < 300) {
      return { 
        valid: false, 
        reason: `Likely boilerplate content (contains "${pattern}")` 
      };
    }
  }
  
  return { valid: true, reason: 'Content validated' };
}

/**
 * Generate a unique SEO meta description
 */
function generateMetaDescription(title, content, description) {
  if (content && content.length > 160) {
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);
    if (sentences.length > 1) {
      const metaBase = sentences[1]?.trim() || sentences[0]?.trim();
      return metaBase.substring(0, 155).trim() + '...';
    }
  }
  
  const titleWords = title.split(' ').slice(0, 3).join(' ');
  const descStart = (description || '').substring(0, 120);
  return `${titleWords}: ${descStart}`.substring(0, 155).trim() + '...';
}

/**
 * Clean and normalize title (remove extra metadata from ESPN format)
 */
function cleanTitle(rawTitle) {
  // ESPN Cricinfo concatenates title with description, time, and author
  // Example: "TitleDescriptionDate • Time•Author"
  // We need to extract just the title
  
  // Split by common patterns and take first meaningful part
  const patterns = [
    /\d{1,2}-\w{3}-\d{4}/,  // Date pattern: "14-Dec-2025"
    /\d+ hrs? ago/i,        // "12 hrs ago"
    /\d+ mins? ago/i,       // "35 mins ago"
    /•/,                    // Bullet separator
  ];
  
  let cleanedTitle = rawTitle;
  
  for (const pattern of patterns) {
    const match = cleanedTitle.match(pattern);
    if (match && match.index) {
      cleanedTitle = cleanedTitle.substring(0, match.index).trim();
      break;
    }
  }
  
  return cleanedTitle || rawTitle;
}

/**
 * Generate ESPN Cricinfo specific sourceId
 */
function generateSourceId(article) {
  // Use the ID from URL slug, prefixed with source
  return `espncricinfo-${article.id}`;
}

async function runESPNCricinfoScraper() {
  const pool = new Pool({
    connectionString: connectionString,
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });

  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool)
  });

  const scraper = new ESPNCricinfoScraper();
  const useAutoTagging = !!process.env.PERPLEXITY_API_KEY;

  try {
    console.log('🏏 ESPN Cricinfo News Scraper - Database Integration');
    console.log('━'.repeat(60));
    
    // STEP 1: Fetch articles with details
    console.log('\n📡 Fetching news with detailed content...');
    const limit = 15; // Fetch top 15 articles
    const articlesWithDetails = await scraper.fetchLatestNewsWithDetails(limit);
    console.log(`   Fetched ${articlesWithDetails.length} articles with details\n`);

    // STEP 2: Pre-fetch existing articles from DB
    const sourceIds = articlesWithDetails.map(a => generateSourceId(a));
    const existingArticles = await prisma.newsArticle.findMany({
      where: {
        sourceId: { in: sourceIds }
      },
      select: { sourceId: true, title: true, tags: true }
    });
    
    const existingMap = new Map();
    for (const article of existingArticles) {
      existingMap.set(article.sourceId, { 
        title: article.title, 
        tags: article.tags 
      });
    }
    console.log(`   Found ${existingMap.size} existing articles in DB\n`);

    // STEP 3: Process articles with content validation
    let savedCount = 0;
    let skippedNoContent = 0;
    let skippedDuplicate = 0;
    let updatedCount = 0;
    let errorCount = 0;

    console.log('📝 Processing articles...\n');

    for (let i = 0; i < articlesWithDetails.length; i++) {
      const article = articlesWithDetails[i];
      const sourceId = generateSourceId(article);
      const cleanedTitle = cleanTitle(article.title);
      
      console.log(`${i + 1}/${articlesWithDetails.length} - ${cleanedTitle.substring(0, 50)}...`);

      // VALIDATION: Check if content is available
      const validation = validateContent(article);
      if (!validation.valid) {
        console.log(`   ⏭️  Skipped: ${validation.reason}`);
        skippedNoContent++;
        continue;
      }

      try {
        const existing = existingMap.get(sourceId);
        
        // Check for unchanged duplicates
        if (existing && existing.title === cleanedTitle) {
          console.log(`   ⏭️  Skipped: Already exists (unchanged)`);
          skippedDuplicate++;
          continue;
        }

        // Prepare data
        const details = article.details || {};
        const content = details.content || '';
        const description = details.description || article.description || '';
        const metaDescription = generateMetaDescription(cleanedTitle, content, description);

        // Generate or preserve tags
        let tags = [];
        if (existing?.tags && existing.tags.length > 0) {
          tags = existing.tags;
        } else if (details.tags && details.tags.length > 0) {
          tags = details.tags;
        } else if (details.keywords && details.keywords.length > 0) {
          tags = details.keywords;
        } else if (useAutoTagging) {
          tags = await generateTags(cleanedTitle, content || description);
          if (tags.length > 0) {
            console.log(`   🏷️  Generated tags: ${tags.join(', ')}`);
          }
        }

        if (existing) {
          // UPDATE existing article (title changed)
          await prisma.newsArticle.update({
            where: { sourceId: sourceId },
            data: {
              title: cleanedTitle,
              description: description.substring(0, 500),
              content: content,
              imageUrl: details.mainImage || article.imageUrl,
              thumbnailUrl: article.thumbnailUrl || details.mainImage,
              publishedTime: parsePublishTime(details.publishedTime || article.publishedTime),
              ...(tags.length > 0 && (!existing.tags || existing.tags.length === 0) ? { tags } : {}),
              relatedArticles: details.relatedArticles || null,
              updatedAt: new Date()
            }
          });
          updatedCount++;
          console.log(`   🔄 Updated`);
        } else {
          // CREATE new article
          await prisma.newsArticle.create({
            data: {
              sourceId: sourceId,
              slug: article.id, // Use ESPN slug as our slug
              sport: 'cricket',
              category: 'news',
              sourceName: 'ESPN Cricinfo',
              title: cleanedTitle,
              description: description.substring(0, 500),
              content: content,
              imageUrl: details.mainImage || article.imageUrl,
              thumbnailUrl: article.thumbnailUrl || details.mainImage,
              sourceUrl: article.url,
              publishedTime: parsePublishTime(details.publishedTime || article.publishedTime),
              metaTitle: cleanedTitle,
              metaDesc: metaDescription,
              tags: tags,
              relatedArticles: details.relatedArticles || null,
              scrapedAt: new Date()
            }
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
    console.log('\n' + '━'.repeat(60));
    console.log('📊 ESPN CRICINFO SCRAPER SUMMARY:');
    console.log('━'.repeat(60));
    console.log(`   ✅ New articles saved:      ${savedCount}`);
    console.log(`   🔄 Updated articles:        ${updatedCount}`);
    console.log(`   ⏭️  Skipped (no content):   ${skippedNoContent}`);
    console.log(`   ⏭️  Skipped (duplicate):    ${skippedDuplicate}`);
    console.log(`   ❌ Errors:                  ${errorCount}`);
    
    // Verify total
    const cricbuzzCount = await prisma.newsArticle.count({
      where: { sourceName: 'Cricbuzz' }
    });
    const espnCount = await prisma.newsArticle.count({
      where: { sourceName: 'ESPN Cricinfo' }
    });
    const totalCount = await prisma.newsArticle.count();
    
    console.log('━'.repeat(60));
    console.log('📚 DATABASE TOTALS:');
    console.log(`   Cricbuzz articles:      ${cricbuzzCount}`);
    console.log(`   ESPN Cricinfo articles: ${espnCount}`);
    console.log(`   Total articles:         ${totalCount}`);
    console.log('━'.repeat(60));

  } catch (error) {
    console.error('❌ Error running ESPN Cricinfo scraper:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

runESPNCricinfoScraper();
