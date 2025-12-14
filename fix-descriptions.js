const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

async function fixDescriptions() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    console.log('🔧 Fixing descriptions from article content...\n');
    
    // Get all articles
    const articles = await prisma.newsArticle.findMany({});
    console.log(`Found ${articles.length} articles`);
    
    let fixed = 0;
    for (const article of articles) {
      if (article.content) {
        // Get first paragraph from content
        const firstParagraph = article.content.split('\\n\\n')[0] || article.content.substring(0, 300);
        const newDescription = firstParagraph.substring(0, 300);
        
        // Update the article
        await prisma.newsArticle.update({
          where: { id: article.id },
          data: { 
            description: newDescription,
            metaDesc: newDescription.substring(0, 160)
          }
        });
        
        console.log(`✅ Fixed: ${article.title.substring(0, 60)}...`);
        fixed++;
      }
    }
    
    console.log(`\n🎉 Fixed ${fixed} article descriptions!`);
    
    await prisma.$disconnect();
    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  }
}

fixDescriptions();
