/**
 * Cleanup stale/corrupted articles
 * Removes articles that have NULL content or are known to be stale
 */

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

// Use DATABASE_URL (pooler) for all environments
// DIRECT_URL uses IPv6 which may not work on all VPS environments
const connectionString = process.env.DATABASE_URL;

async function cleanupStaleArticles() {
  const pool = new Pool({
    connectionString: connectionString,
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool),
  });

  try {
    console.log("\n🧹 === CLEANUP STALE ARTICLES ===\n");

    // Find articles with NULL or empty content
    const staleArticles = await prisma.newsArticle.findMany({
      where: {
        OR: [{ content: null }, { content: "" }],
      },
      select: {
        id: true,
        sourceId: true,
        title: true,
      },
    });

    console.log(
      `📊 Found ${staleArticles.length} articles with NULL/empty content:\n`
    );

    for (const article of staleArticles) {
      console.log(`   - ${article.title.substring(0, 50)}...`);
      console.log(`     ID: ${article.sourceId}\n`);
    }

    if (staleArticles.length > 0) {
      // Delete stale articles
      const result = await prisma.newsArticle.deleteMany({
        where: {
          OR: [{ content: null }, { content: "" }],
        },
      });

      console.log(`✅ Deleted ${result.count} stale articles`);
      console.log("   They will be re-scraped on next run");
    } else {
      console.log("✅ No stale articles found");
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

cleanupStaleArticles();
