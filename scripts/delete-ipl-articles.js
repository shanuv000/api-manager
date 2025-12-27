// Delete all IPL T20 articles from database
// Run with: node scripts/delete-ipl-articles.js

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;

async function deleteIPLArticles() {
  const pool = new Pool({
    connectionString: connectionString,
    max: 2,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    console.log("🗑️  Deleting all IPL T20 articles...");

    const count = await prisma.newsArticle.count({
      where: { sourceName: "IPL T20" },
    });
    console.log(`   Found ${count} IPL T20 articles`);

    if (count > 0) {
      const result = await prisma.newsArticle.deleteMany({
        where: { sourceName: "IPL T20" },
      });
      console.log(`   ✅ Deleted ${result.count} IPL T20 articles`);
    } else {
      console.log("   ℹ️  No IPL T20 articles to delete");
    }

    // Show remaining counts
    const remaining = await prisma.newsArticle.count();
    console.log(`   📊 Total articles remaining: ${remaining}`);
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

deleteIPLArticles();
