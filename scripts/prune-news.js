const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const RETENTION_DAYS = 90; // Keep 3 months of news

// In CI environments (GitHub Actions, Vercel), use DATABASE_URL with PgBouncer
// DIRECT_URL uses IPv6 which is unreachable from GitHub Actions runners
const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS || !!process.env.VERCEL;
const connectionString = isCI ? process.env.DATABASE_URL : (process.env.DIRECT_URL || process.env.DATABASE_URL);

async function pruneOldArticles() {
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
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

    console.log(`🧹 Starting cleanup of articles older than ${RETENTION_DAYS} days (${cutoffDate.toISOString()})...`);

    const { count } = await prisma.newsArticle.deleteMany({
      where: {
        createdAt: {
            lt: cutoffDate
        }
      }
    });

    console.log(`✅ Cleanup complete. Deleted ${count} old articles.`);
  } catch (error) {
    console.error('❌ Error pruning database:', error);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

// Check if run directly
if (require.main === module) {
  pruneOldArticles();
}

module.exports = pruneOldArticles;
