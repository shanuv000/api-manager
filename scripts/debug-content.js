/**
 * Debug script to check for duplicate content in the database
 * Run via GitHub Actions to diagnose content issues
 */

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS || !!process.env.VERCEL;
const connectionString = isCI ? process.env.DATABASE_URL : (process.env.DIRECT_URL || process.env.DATABASE_URL);

async function debugContent() {
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
    console.log('\n🔍 === DATABASE CONTENT DEBUG ===\n');
    
    // Fetch all articles
    const articles = await prisma.newsArticle.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        sourceId: true,
        title: true,
        content: true,
        description: true,
        createdAt: true
      }
    });
    
    console.log(`📚 Total articles in database: ${articles.length}\n`);
    
    // Check each article
    const contentMap = new Map();
    
    articles.forEach((article, index) => {
      const contentPreview = (article.content || 'NULL').substring(0, 100);
      const contentLength = article.content?.length || 0;
      
      console.log(`${index + 1}. ${article.title.substring(0, 60)}...`);
      console.log(`   📏 Content length: ${contentLength} chars`);
      console.log(`   📝 Preview: ${contentPreview.substring(0, 80)}...`);
      console.log(`   🆔 Source ID: ${article.sourceId}`);
      console.log('');
      
      // Track content duplicates
      if (article.content) {
        const key = article.content.substring(0, 200);
        if (!contentMap.has(key)) {
          contentMap.set(key, []);
        }
        contentMap.get(key).push(article.title);
      }
    });
    
    // Report duplicates
    console.log('\n🔴 === DUPLICATE CONTENT CHECK ===\n');
    let hasDuplicates = false;
    
    for (const [contentKey, titles] of contentMap.entries()) {
      if (titles.length > 1) {
        hasDuplicates = true;
        console.log(`⚠️  DUPLICATE CONTENT found in ${titles.length} articles:`);
        titles.forEach(title => console.log(`   - ${title.substring(0, 50)}...`));
        console.log(`   Content: ${contentKey.substring(0, 100)}...`);
        console.log('');
      }
    }
    
    if (!hasDuplicates) {
      console.log('✅ No duplicate content detected!');
    }
    
    // Check for NULL content
    const nullContent = articles.filter(a => !a.content || a.content.length === 0);
    if (nullContent.length > 0) {
      console.log(`\n⚠️  Articles with NULL/empty content: ${nullContent.length}`);
      nullContent.forEach(a => console.log(`   - ${a.title.substring(0, 50)}...`));
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

debugContent();
