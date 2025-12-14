// Run scraper directly and save to database
// Used by GitHub Actions workflow

const CricbuzzNewsScraper = require('./cricbuzz-news-scraper');
const {PrismaClient} = require('@prisma/client');
const {PrismaPg} = require('@prisma/adapter-pg');
const {Pool} = require('pg');
const {parsePublishTime} = require('../utils/timeParser');
const {generateTags} = require('../utils/perplexityTagger');

// Use DIRECT_URL for direct PostgreSQL connection (bypasses PgBouncer for stability)
// Falls back to DATABASE_URL if DIRECT_URL is not set
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;

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

/**
 * Check if article content has meaningfully changed
 */
function hasContentChanged(existing, newData) {
  if (!existing) return true;
  
  // Check if key fields have changed
  const titleChanged = existing.title !== newData.title;
  const contentChanged = existing.content !== newData.content;
  
  return titleChanged || contentChanged;
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
    console.log('🏏 Fetching cricket news from Cricbuzz...');
    const newsArticles = await scraper.fetchLatestNewsWithDetails(20);
    
    console.log(`\n💾 Processing ${newsArticles.length} articles...`);
    if (useAutoTagging) {
      console.log('🏷️  Auto-tagging enabled (Perplexity AI)\n');
    } else {
      console.log('⚠️  Auto-tagging disabled (no PERPLEXITY_API_KEY)\n');
    }
    
    let savedCount = 0;
    let skippedCount = 0;
    let updatedCount = 0;
    
    for (const article of newsArticles) {
      try {
        // Get short description from listing (different from content)
        const listingDescription = (article.description || '').substring(0, 200).trim();
        
        // Full article content
        const fullContent = article.details?.content || null;
        
        // Generate unique SEO meta description
        const metaDescription = generateMetaDescription(
          article.title,
          fullContent,
          listingDescription
        );
        
        // Check if article already exists
        const existing = await prisma.newsArticle.findUnique({
          where: { sourceId: article.id },
          select: { id: true, title: true, content: true, tags: true }
        });
        
        const newData = {
          title: article.title,
          content: fullContent
        };
        
        // Skip if no meaningful changes
        if (existing && !hasContentChanged(existing, newData)) {
          skippedCount++;
          console.log(`  ⏭️  ${skippedCount} skipped - No changes: ${article.title.substring(0, 40)}...`);
          continue;
        }
        
        // Preserve existing tags if they exist, otherwise generate new ones
        let tags = [];
        if (existing?.tags && existing.tags.length > 0) {
          tags = existing.tags; // Keep existing tags
        } else if (article.details?.tags && article.details.tags.length > 0) {
          tags = article.details.tags; // Use scraped tags
        } else if (useAutoTagging) {
          // Generate new tags only if none exist
          tags = await generateTags(article.title, fullContent || listingDescription);
          if (tags.length > 0) {
            console.log(`  🏷️  Generated tags: ${tags.join(', ')}`);
          }
        }
        
        if (existing) {
          // Update existing article (only changed fields)
          await prisma.newsArticle.update({
            where: { sourceId: article.id },
            data: {
              title: article.title,
              description: listingDescription || existing.description,
              content: fullContent,
              imageUrl: article.imageUrl,
              thumbnailUrl: article.thumbnailUrl || article.imageUrl,
              publishedTime: parsePublishTime(article.details?.publishedTime || article.publishedTime),
              // Don't overwrite tags if they already exist
              ...(tags.length > 0 && (!existing.tags || existing.tags.length === 0) ? { tags } : {}),
              relatedArticles: article.details?.relatedArticles || null,
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
              publishedTime: parsePublishTime(article.details?.publishedTime || article.publishedTime),
              metaTitle: article.title,
              metaDesc: metaDescription,
              tags: tags,
              relatedArticles: article.details?.relatedArticles || null,
              scrapedAt: new Date(article.scrapedAt)
            }
          });
          savedCount++;
          console.log(`  ✅ New: ${article.title.substring(0, 50)}...`);
        }
      } catch (error) {
        console.error(`  ❌ Error processing article ${article.id}:`, error.message);
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
