const prisma = require('./component/prismaClient');

async function clearAndRescrape() {
  try {
    console.log('🗑️  Deleting existing articles with duplicate descriptions...');
    
    // Delete all existing articles
    const deleted = await prisma.newsArticle.deleteMany({});
    console.log(`✅ Deleted ${deleted.count} articles`);
    
    console.log('\n🔄 Starting fresh scrape with fixed descriptions...');
    console.log('Please run: curl http://localhost:5003/api/cricket/news?limit=20\n');
    
    await prisma.$disconnect();
  } catch (error) {
    console.error('Error:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

clearAndRescrape();
