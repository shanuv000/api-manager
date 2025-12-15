/**
 * Force re-scrape all existing articles to fix corrupted content
 * This resets the content to NULL so the next scraper run will fetch fresh content
 */

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS || !!process.env.VERCEL;
const connectionString = isCI ? process.env.DATABASE_URL : (process.env.DIRECT_URL || process.env.DATABASE_URL);

async function forceRescrape() {
  const pool = new Pool({
    connectionString: connectionString,
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });

  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool)
  });

  try {
    console.log('\n🔄 === FORCE RE-SCRAPE: Clearing corrupted content ===\n');
    
    // Find articles with cookie consent content
    const badContent = "We won't sell or share your personal information";
    
    const articlesWithBadContent = await prisma.newsArticle.findMany({
      where: {
        content: {
          contains: badContent
        }
      },
      select: {
        id: true,
        title: true,
        sourceId: true
      }
    });
    
    console.log(`📊 Found ${articlesWithBadContent.length} articles with corrupted content\n`);
    
    if (articlesWithBadContent.length > 0) {
      // Clear the content and change title slightly to trigger re-scrape
      const result = await prisma.newsArticle.updateMany({
        where: {
          content: {
            contains: badContent
          }
        },
        data: {
          content: null,
          updatedAt: new Date()
        }
      });
      
      console.log(`✅ Reset content for ${result.count} articles`);
      console.log('   Next scraper run will fetch fresh content\n');
      
      // Also delete these articles so they'll be re-created
      const deleteResult = await prisma.newsArticle.deleteMany({
        where: {
          id: {
            in: articlesWithBadContent.map(a => a.id)
          }
        }
      });
      
      console.log(`🗑️  Deleted ${deleteResult.count} articles with corrupted content`);
      console.log('   They will be re-scraped with correct content on next run');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

forceRescrape();
