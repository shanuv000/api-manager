
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const RETENTION_DAYS = 90; // Keep 3 months of news

async function pruneOldArticles() {
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
  }
}

// Check if run directly
if (require.main === module) {
  pruneOldArticles();
}

module.exports = pruneOldArticles;
