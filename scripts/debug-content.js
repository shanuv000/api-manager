/**
 * Content validation and health check script
 * Runs after each scrape to detect issues early
 */

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS || !!process.env.VERCEL;
const connectionString = isCI ? process.env.DATABASE_URL : (process.env.DIRECT_URL || process.env.DATABASE_URL);

// Thresholds for validation
const MIN_CONTENT_LENGTH = 100;
const SUSPICIOUS_CONTENT_PATTERNS = [
  'we won\'t sell or share your personal information',
  'cookie',
  'privacy policy',
  'gdpr',
  'accept all',
  'manage preferences'
];

async function validateContent() {
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
    console.log('\n📊 === SCRAPE HEALTH CHECK ===\n');
    
    const articles = await prisma.newsArticle.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        sourceId: true,
        title: true,
        content: true,
        createdAt: true
      }
    });
    
    // Metrics
    const metrics = {
      total: articles.length,
      withContent: 0,
      nullContent: 0,
      shortContent: 0,        // < 100 chars
      suspiciousContent: 0,   // matches bad patterns
      healthyContent: 0,      // good content
      avgContentLength: 0,
      contentLengths: []
    };
    
    const issues = [];
    
    articles.forEach((article, index) => {
      const contentLength = article.content?.length || 0;
      const contentLower = (article.content || '').toLowerCase();
      
      // Track content length for average
      if (contentLength > 0) {
        metrics.contentLengths.push(contentLength);
        metrics.withContent++;
      }
      
      // Check for NULL content
      if (!article.content || contentLength === 0) {
        metrics.nullContent++;
        issues.push({
          type: '🔴 NULL',
          title: article.title.substring(0, 50),
          sourceId: article.sourceId,
          reason: 'No content extracted'
        });
        return;
      }
      
      // Check for short content
      if (contentLength < MIN_CONTENT_LENGTH) {
        metrics.shortContent++;
        issues.push({
          type: '🟡 SHORT',
          title: article.title.substring(0, 50),
          sourceId: article.sourceId,
          reason: `Only ${contentLength} chars (min: ${MIN_CONTENT_LENGTH})`
        });
        return;
      }
      
      // Check for suspicious patterns (cookie consent etc)
      const hasSuspiciousContent = SUSPICIOUS_CONTENT_PATTERNS.some(
        pattern => contentLower.includes(pattern)
      );
      
      if (hasSuspiciousContent) {
        metrics.suspiciousContent++;
        issues.push({
          type: '🟠 SUSPICIOUS',
          title: article.title.substring(0, 50),
          sourceId: article.sourceId,
          reason: 'Contains cookie/privacy patterns'
        });
        return;
      }
      
      // Content is healthy
      metrics.healthyContent++;
    });
    
    // Calculate average content length
    if (metrics.contentLengths.length > 0) {
      metrics.avgContentLength = Math.round(
        metrics.contentLengths.reduce((a, b) => a + b, 0) / metrics.contentLengths.length
      );
    }
    
    // Calculate health score (0-100)
    const healthScore = metrics.total > 0 
      ? Math.round((metrics.healthyContent / metrics.total) * 100) 
      : 0;
    
    // Print summary
    console.log('📈 METRICS:');
    console.log(`   Total articles: ${metrics.total}`);
    console.log(`   With content: ${metrics.withContent}`);
    console.log(`   Average content length: ${metrics.avgContentLength} chars`);
    console.log('');
    
    console.log('✅ HEALTH BREAKDOWN:');
    console.log(`   Healthy: ${metrics.healthyContent} articles`);
    console.log(`   NULL content: ${metrics.nullContent} articles`);
    console.log(`   Short content: ${metrics.shortContent} articles`);
    console.log(`   Suspicious: ${metrics.suspiciousContent} articles`);
    console.log('');
    
    // Health score with emoji
    let healthEmoji = '🟢';
    if (healthScore < 90) healthEmoji = '🟡';
    if (healthScore < 70) healthEmoji = '🟠';
    if (healthScore < 50) healthEmoji = '🔴';
    
    console.log(`${healthEmoji} HEALTH SCORE: ${healthScore}%`);
    console.log('');
    
    // Print issues if any
    if (issues.length > 0) {
      console.log('⚠️  ISSUES DETECTED:');
      issues.forEach(issue => {
        console.log(`   ${issue.type}: ${issue.title}...`);
        console.log(`      Reason: ${issue.reason}`);
        console.log(`      ID: ${issue.sourceId}`);
      });
      console.log('');
    }
    
    // Duplicate content check
    console.log('🔍 DUPLICATE CHECK:');
    const contentMap = new Map();
    articles.forEach(article => {
      if (article.content && article.content.length > 50) {
        const key = article.content.substring(0, 200);
        if (!contentMap.has(key)) {
          contentMap.set(key, []);
        }
        contentMap.get(key).push(article.title);
      }
    });
    
    let hasDuplicates = false;
    for (const [contentKey, titles] of contentMap.entries()) {
      if (titles.length > 1) {
        hasDuplicates = true;
        console.log(`   ⚠️  ${titles.length} articles share same content:`);
        titles.forEach(t => console.log(`      - ${t.substring(0, 40)}...`));
      }
    }
    
    if (!hasDuplicates) {
      console.log('   ✅ No duplicates detected');
    }
    
    console.log('\n=============================\n');
    
    // Exit with error code if health score is critical
    if (healthScore < 50) {
      console.log('❌ CRITICAL: Health score below 50%. Check scraper logic.');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

validateContent();
