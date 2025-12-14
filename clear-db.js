const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

async function clearDatabase() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    console.log('🗑️  Clearing all news articles from database...');
    const result = await prisma.newsArticle.deleteMany({});
    console.log(`✅ Deleted ${result.count} articles\n`);
    
    await prisma.$disconnect();
    await pool.end();
    
    console.log('✅ Database cleared! Ready for fresh scrape with unique descriptions.');
  } catch (error) {
    console.error('Error:', error.message);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  }
}

clearDatabase();
