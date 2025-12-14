// Run scraper directly and save to database
// Used by GitHub Actions workflow

const CricbuzzNewsScraper = require('./cricbuzz-news-scraper');
const {PrismaClient} = require('@prisma/client');
const {PrismaPg} = require('@prisma/adapter-pg');
const {Pool} = require('pg');
const {parsePublishTime} = require('../utils/timeParser');

async function runScraper() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool)
  });

  const scraper = new CricbuzzNewsScraper();

  try {
    console.log('🏏 Fetching cricket news from Cricbuzz...');
    const newsArticles = await scraper.fetchLatestNewsWithDetails(20);
    
    console.log(`\n💾 Saving ${newsArticles.length} articles to database...`);
    
    let savedCount = 0;
    for (const article of newsArticles) {
      try {
        const firstParagraph = article.details?.contentParagraphs?.[0] || article.description || '';
        const uniqueDescription = firstParagraph.substring(0, 300);
        
        await prisma.newsArticle.upsert({
          where: { sourceId: article.id },
          update: {
            title: article.title,
            description: uniqueDescription,
            content: article.details?.content || null,
            imageUrl: article.imageUrl,
            thumbnailUrl: article.thumbnailUrl || article.imageUrl,
            publishedTime: parsePublishTime(article.details?.publishedTime || article.publishedTime),
            tags: article.details?.tags || [],
            relatedArticles: article.details?.relatedArticles || null,
            updatedAt: new Date()
          },
          create: {
            sourceId: article.id,
            slug: article.id,
            sport: 'cricket',
            category: 'news',
            sourceName: 'Cricbuzz',
            title: article.title,
            description: uniqueDescription,
            content: article.details?.content || null,
            imageUrl: article.imageUrl,
            thumbnailUrl: article.thumbnailUrl || article.imageUrl,
            sourceUrl: article.link,
            publishedTime: parsePublishTime(article.details?.publishedTime || article.publishedTime),
            metaTitle: article.title,
            metaDesc: uniqueDescription.substring(0, 160),
            tags: article.details?.tags || [],
            relatedArticles: article.details?.relatedArticles || null,
            scrapedAt: new Date(article.scrapedAt)
          }
        });
        savedCount++;
        console.log(`  ✅ ${savedCount}/${newsArticles.length} - ${article.title.substring(0, 50)}...`);
      } catch (error) {
        console.error(`  ❌ Error saving article ${article.id}:`, error.message);
      }
    }
    
    console.log(`\n✅ Successfully saved ${savedCount} articles to database!`);
    
    // Verify
    const count = await prisma.newsArticle.count();
    console.log(`📊 Total articles in database: ${count}`);
    
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
