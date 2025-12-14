// Run scraper directly and save to database
// Used by GitHub Actions workflow

const CricbuzzNewsScraper = require('./cricbuzz-news-scraper');
const {PrismaClient} = require('@prisma/client');
const {PrismaPg} = require('@prisma/adapter-pg');
const {Pool} = require('pg');
const {parsePublishTime} = require('../utils/timeParser');
const {generateTags} = require('../utils/perplexityTagger');

// In CI environments (GitHub Actions, Vercel), use DATABASE_URL with PgBouncer
// DIRECT_URL uses IPv6 which is unreachable from GitHub Actions runners
// For local dev, DIRECT_URL is preferred for long-running operations
const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS || !!process.env.VERCEL;
const connectionString = isCI ? process.env.DATABASE_URL : (process.env.DIRECT_URL || process.env.DATABASE_URL);

/**
 * Generate a unique SEO meta description
 * Different from the regular description - focuses on SEO keywords
 */
function generateMetaDescription(title, content, description) {
  // Use a different approach: Create a summary that includes the title context
  if (content && content.length > 160) {
    // Find the second or third sentence for variety
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);
    if (sentences.length > 1) {
      // Use second sentence if available, or combine first two
      const metaBase = sentences[1]?.trim() || sentences[0]?.trim();
      return metaBase.substring(0, 155).trim() + '...';
    }
  }
  
  // Fallback: Create from title + truncated description
  const titleWords = title.split(' ').slice(0, 3).join(' ');
  const descStart = (description || '').substring(0, 120);
  return `${titleWords}: ${descStart}`.substring(0, 155).trim() + '...';
}

async function runScraper() {
  const pool = new Pool({
    connectionString: connectionString,
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });

  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool)
  });

  const scraper = new CricbuzzNewsScraper();
  const useAutoTagging = !!process.env.PERPLEXITY_API_KEY;

  try {
    // STEP 1: Fetch article list from Cricbuzz (just metadata, no details yet)
    console.log('🏏 Fetching cricket news list from Cricbuzz...');
    const articleList = await scraper.fetchLatestNews();
    const limit = 20;
    const limitedList = articleList.slice(0, limit);
    console.log(`   Fetched ${limitedList.length} articles from listing page\n`);

    // STEP 2: Pre-fetch existing articles from DB (sourceId + title)
    // This enables early skip detection before expensive detail scraping
    // 2. Fetch existing articles from DB that match these IDs (Batch Query)
    // This optimization prevents loading the entire database into memory
    const sourceIds = limitedList.map(n => n.id);
    const existingArticles = await prisma.newsArticle.findMany({
      where: {
        sourceId: { in: sourceIds }
      },
      select: { sourceId: true, title: true, tags: true },
    });
    
    // Create a map for O(1) lookup
    const existingMap = new Map(existingArticles.map(a => [a.sourceId, a]));
    for (const article of existingArticles) {
      existingMap.set(article.sourceId, { 
        title: article.title, 
        tags: article.tags 
      });
    }
    console.log(`   Found ${existingMap.size} existing articles in DB\n`);
    
    // List already fetched in Step 1

    
    // STEP 3: Filter - only fetch details for NEW or CHANGED articles
    const articlesToProcess = [];
    const skippedArticles = [];
    
    for (const article of limitedList) {
      const existing = existingMap.get(article.id);
      if (existing && existing.title === article.title) {
        // Title matches - skip detail fetch (article unchanged)
        skippedArticles.push(article);
      } else {
        // New article OR title changed - need to fetch details
        articlesToProcess.push(article);
      }
    }
    
    console.log(`📊 Pre-scan results:`);
    console.log(`   ⏭️  ${skippedArticles.length} articles unchanged (will skip)`);
    console.log(`   🔍 ${articlesToProcess.length} articles need processing\n`);
    
    let savedCount = 0;
    let skippedCount = skippedArticles.length;
    let updatedCount = 0;
    
    // Log skipped articles
    for (const article of skippedArticles) {
      console.log(`  ⏭️  Skipped: ${article.title.substring(0, 50)}...`);
    }
    
    // STEP 4: Fetch details ONLY for articles that need processing
    if (articlesToProcess.length > 0) {
      console.log(`\n📚 Fetching details for ${articlesToProcess.length} new/changed articles...\n`);
      
      for (let i = 0; i < articlesToProcess.length; i++) {
        const article = articlesToProcess[i];
        console.log(`${i + 1}/${articlesToProcess.length} - ${article.title}`);
        
        try {
          // Fetch article details
          const details = await scraper.fetchArticleDetails(article.link);
          
          // Get short description from listing (different from content)
          const listingDescription = (article.description || '').substring(0, 200).trim();
          
          // Full article content
          const fullContent = details?.content || null;
          
          // Generate unique SEO meta description
          const metaDescription = generateMetaDescription(
            article.title,
            fullContent,
            listingDescription
          );
          
          // Check if exists (for update vs create)
          const existingData = existingMap.get(article.id);
          
          // Preserve existing tags if they exist, otherwise generate new ones
          let tags = [];
          if (existingData?.tags && existingData.tags.length > 0) {
            tags = existingData.tags; // Keep existing tags
          } else if (details?.tags && details.tags.length > 0) {
            tags = details.tags; // Use scraped tags
          } else if (useAutoTagging) {
            // Generate new tags only if none exist
            tags = await generateTags(article.title, fullContent || listingDescription);
            if (tags.length > 0) {
              console.log(`  🏷️  Generated tags: ${tags.join(', ')}`);
            }
          }
          
          if (existingData) {
            // Update existing article (title changed)
            await prisma.newsArticle.update({
              where: { sourceId: article.id },
              data: {
                title: article.title,
                description: listingDescription,
                content: fullContent,
                imageUrl: article.imageUrl,
                thumbnailUrl: article.thumbnailUrl || article.imageUrl,
                publishedTime: parsePublishTime(details?.publishedTime || article.publishedTime),
                // Don't overwrite tags if they already exist
                ...(tags.length > 0 && (!existingData.tags || existingData.tags.length === 0) ? { tags } : {}),
                relatedArticles: details?.relatedArticles || null,
                updatedAt: new Date()
              }
            });
            updatedCount++;
            console.log(`  🔄 Updated: ${article.title.substring(0, 50)}...`);
          } else {
            // Create new article
            await prisma.newsArticle.create({
              data: {
                sourceId: article.id,
                slug: article.id,
                sport: 'cricket',
                category: 'news',
                sourceName: 'Cricbuzz',
                title: article.title,
                description: listingDescription,
                content: fullContent,
                imageUrl: article.imageUrl,
                thumbnailUrl: article.thumbnailUrl || article.imageUrl,
                sourceUrl: article.link,
                publishedTime: parsePublishTime(details?.publishedTime || article.publishedTime),
                metaTitle: article.title,
                metaDesc: metaDescription,
                tags: tags,
                relatedArticles: details?.relatedArticles || null,
                scrapedAt: new Date(article.scrapedAt)
              }
            });
            savedCount++;
            console.log(`  ✅ New: ${article.title.substring(0, 50)}...`);
          }
          
          // Add delay to avoid rate limiting
          await scraper.delay(1000);
          
        } catch (error) {
          console.error(`  ❌ Error processing article ${article.id}:`, error.message);
        }
      }
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`   ✅ New articles: ${savedCount}`);
    console.log(`   🔄 Updated: ${updatedCount}`);
    console.log(`   ⏭️  Skipped (no changes): ${skippedCount}`);
    
    // Verify total
    const count = await prisma.newsArticle.count();
    console.log(`   📚 Total in database: ${count}`);
    
  } catch (error) {
    console.error('❌ Error running scraper:', error);
    process.exit(1);
  } finally {
    await scraper.closeBrowser();
    await prisma.$disconnect();
    await pool.end();
  }
}

runScraper();
