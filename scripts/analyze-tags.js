/**
 * Analyze tag distribution across articles
 */

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

async function analyzeTags() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
  });

  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool),
  });

  try {
    // Get all articles with tags
    const articles = await prisma.newsArticle.findMany({
      select: {
        id: true,
        title: true,
        sourceName: true,
        tags: true,
      },
      orderBy: { createdAt: "desc" },
    });

    console.log("\n=== TAG ANALYSIS REPORT ===\n");
    console.log(`Total articles: ${articles.length}\n`);

    // Group by source
    const bySources = {};
    articles.forEach((a) => {
      const source = a.sourceName || "Unknown";
      if (!bySources[source]) bySources[source] = [];
      bySources[source].push(a);
    });

    // Analyze each source
    Object.keys(bySources).forEach((source) => {
      const sourceArticles = bySources[source];
      const tagCounts = sourceArticles.map((a) => (a.tags || []).length);
      const avgTags =
        tagCounts.reduce((a, b) => a + b, 0) / tagCounts.length || 0;
      const maxTags = Math.max(...tagCounts);
      const minTags = Math.min(...tagCounts);

      console.log(`\n📰 ${source}:`);
      console.log(`   Articles: ${sourceArticles.length}`);
      console.log(`   Avg tags: ${avgTags.toFixed(1)}`);
      console.log(`   Min/Max: ${minTags} - ${maxTags}`);

      // Show articles with excessive tags (>8)
      const excessiveTagArticles = sourceArticles.filter(
        (a) => (a.tags || []).length > 8
      );
      if (excessiveTagArticles.length > 0) {
        console.log(`\n   ⚠️  Articles with excessive tags (>8):`);
        excessiveTagArticles.slice(0, 5).forEach((a) => {
          console.log(
            `      - [${a.tags.length} tags] ${a.title.substring(0, 50)}...`
          );
          console.log(`        Tags: ${a.tags.join(", ")}`);
        });
      }
    });

    // Overall distribution
    console.log("\n\n=== TAG COUNT DISTRIBUTION ===\n");
    const distribution = {};
    articles.forEach((a) => {
      const count = (a.tags || []).length;
      if (!distribution[count]) distribution[count] = 0;
      distribution[count]++;
    });

    Object.keys(distribution)
      .sort((a, b) => parseInt(a) - parseInt(b))
      .forEach((count) => {
        const bar = "█".repeat(Math.min(50, distribution[count]));
        console.log(
          `   ${count.padStart(2)} tags: ${bar} (${distribution[count]})`
        );
      });
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

analyzeTags();
