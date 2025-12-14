// Quick script to clear all news articles
const {PrismaClient} = require('@prisma/client');
const {PrismaPg} = require('@prisma/adapter-pg');
const {Pool} = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const prisma = new PrismaClient({
  adapter: new PrismaPg(pool)
});

async function clearDatabase() {
  try {
    const result = await prisma.newsArticle.deleteMany({});
    console.log(`✅ Cleared ${result.count} articles from database`);
    await prisma.$disconnect();
    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

clearDatabase();
