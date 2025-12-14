/**
 * Backfill tags for existing articles using Perplexity AI
 * Run this once to add tags to all existing articles
 * 
 * Usage: node scripts/backfill-tags.js
 */

require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const { generateTags } = require('../utils/perplexityTagger');

async function backfillTags() {
  if (!process.env.PERPLEXITY_API_KEY) {
    console.error('❌ PERPLEXITY_API_KEY not set in environment');
    console.log('Add to .env: PERPLEXITY_API_KEY=pplx-xxx...');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool)
  });

  try {
    // Get all articles without tags
    const articles = await prisma.newsArticle.findMany({
      where: {
        OR: [
          { tags: { equals: [] } },
          { tags: { equals: null } }
        ]
      },
      select: {
        id: true,
        title: true,
        content: true
      }
    });

    console.log(`📰 Found ${articles.length} articles without tags\n`);

    if (articles.length === 0) {
      console.log('✅ All articles already have tags!');
      return;
    }

    let updated = 0;
    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      console.log(`${i + 1}/${articles.length} - ${article.title.substring(0, 50)}...`);

      const tags = await generateTags(article.title, article.content);
      
      if (tags.length > 0) {
        await prisma.newsArticle.update({
          where: { id: article.id },
          data: { tags }
        });
        console.log(`   ✅ Tags: ${tags.join(', ')}`);
        updated++;
      } else {
        console.log(`   ⚠️ No tags generated`);
      }

      // Rate limit: wait 1.5 seconds between API calls
      if (i < articles.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }

    console.log(`\n✅ Updated ${updated}/${articles.length} articles with tags`);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

backfillTags();
