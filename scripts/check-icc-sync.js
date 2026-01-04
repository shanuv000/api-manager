#!/usr/bin/env node
/**
 * ICC Scraper & Enhancer Sync Check
 *
 * Verifies that ICC articles are properly scraped and synchronized with the content enhancer.
 *
 * Usage: node scripts/check-icc-sync.js
 */

require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkICCSync() {
  const client = await pool.connect();

  try {
    console.log("");
    console.log(
      "╔══════════════════════════════════════════════════════════════╗"
    );
    console.log(
      "║          ICC SCRAPER & ENHANCER SYNC ANALYSIS                ║"
    );
    console.log(
      "╚══════════════════════════════════════════════════════════════╝"
    );
    console.log("");

    // 1. Get counts by source (using news_articles + enhanced_content join)
    const sourceStats = await client.query(`
      SELECT 
        na."sourceName" as source,
        COUNT(na.id) as total,
        COUNT(ec.id) as enhanced,
        COUNT(na.id) - COUNT(ec.id) as pending
      FROM news_articles na
      LEFT JOIN enhanced_content ec ON na.id = ec."articleId"
      GROUP BY na."sourceName"
      ORDER BY total DESC
    `);

    console.log("📊 ARTICLES BY SOURCE:");
    console.log(
      "─────────────────────────────────────────────────────────────────"
    );
    console.log("Source               │ Total  │ Enhanced │ Pending │ Rate");
    console.log(
      "─────────────────────────────────────────────────────────────────"
    );

    sourceStats.rows.forEach((row) => {
      const rate = (
        (parseInt(row.enhanced) / parseInt(row.total)) *
        100
      ).toFixed(1);
      const source = (row.source || "Unknown").padEnd(20);
      const total = row.total.toString().padStart(6);
      const enhanced = row.enhanced.toString().padStart(8);
      const pending = row.pending.toString().padStart(7);
      console.log(`${source} │ ${total} │ ${enhanced} │ ${pending} │ ${rate}%`);
    });
    console.log(
      "─────────────────────────────────────────────────────────────────"
    );
    console.log("");

    // 2. Get ICC-specific analysis
    const iccTotal = await client.query(`
      SELECT COUNT(*) as count FROM news_articles WHERE "sourceName" = 'ICC Cricket'
    `);

    const iccEnhanced = await client.query(`
      SELECT COUNT(*) as count FROM news_articles na
      JOIN enhanced_content ec ON na.id = ec."articleId"
      WHERE na."sourceName" = 'ICC Cricket'
    `);

    const iccWithContent = await client.query(`
      SELECT COUNT(*) as count FROM news_articles 
      WHERE "sourceName" = 'ICC Cricket' AND content IS NOT NULL AND LENGTH(content) > 100
    `);

    const iccNoContent = await client.query(`
      SELECT COUNT(*) as count FROM news_articles 
      WHERE "sourceName" = 'ICC Cricket' AND (content IS NULL OR LENGTH(content) <= 100)
    `);

    const totalCount = parseInt(iccTotal.rows[0].count);
    const enhancedCount = parseInt(iccEnhanced.rows[0].count);
    const enhancementRate =
      totalCount > 0 ? ((enhancedCount / totalCount) * 100).toFixed(1) : "0";

    console.log("🏏 ICC CRICKET DEEP ANALYSIS:");
    console.log(
      "─────────────────────────────────────────────────────────────────"
    );
    console.log(`   Total ICC articles:      ${iccTotal.rows[0].count}`);
    console.log(`   With scraped content:    ${iccWithContent.rows[0].count}`);
    console.log(`   Missing/short content:   ${iccNoContent.rows[0].count}`);
    console.log(`   Enhanced by Perplexity:  ${iccEnhanced.rows[0].count}`);
    console.log(`   Enhancement rate:        ${enhancementRate}%`);
    console.log("");

    // 3. Get recent ICC articles
    const recentICC = await client.query(`
      SELECT 
        na.id, 
        na.title, 
        na."publishedTime",
        na."createdAt",
        LENGTH(na.content) as content_len, 
        LENGTH(ec.content) as enhanced_len,
        ec.status as enhancement_status,
        na."sourceUrl"
      FROM news_articles na
      LEFT JOIN enhanced_content ec ON na.id = ec."articleId"
      WHERE na."sourceName" = 'ICC Cricket' 
      ORDER BY na."createdAt" DESC 
      LIMIT 10
    `);

    console.log("📰 RECENT ICC ARTICLES (Last 10):");
    console.log(
      "─────────────────────────────────────────────────────────────────"
    );

    recentICC.rows.forEach((a, i) => {
      const hasContent = a.content_len && a.content_len > 100;
      const hasEnhanced = a.enhanced_len && a.enhanced_len > 100;
      const contentStatus = hasContent
        ? `✅ ${a.content_len} chars`
        : "❌ Missing";
      const enhancedStatus = hasEnhanced
        ? `✅ ${a.enhanced_len} chars`
        : "⏳ Pending";

      console.log(
        `${(i + 1).toString().padStart(2)}. ${a.title.substring(0, 55)}...`
      );
      console.log(
        `    Created: ${
          a.createdAt
            ? new Date(a.createdAt).toISOString().split("T")[0]
            : "N/A"
        }`
      );
      console.log(
        `    Content: ${contentStatus} | Enhanced: ${enhancedStatus}`
      );
      console.log(`    Status: ${a.enhancement_status || "pending"}`);
      console.log("");
    });

    // 4. Check for sync issues
    console.log("🔍 SYNC HEALTH CHECK:");
    console.log(
      "─────────────────────────────────────────────────────────────────"
    );

    // Articles with content but no enhancement
    const pendingEnhancement = await client.query(`
      SELECT COUNT(*) as count FROM news_articles na
      LEFT JOIN enhanced_content ec ON na.id = ec."articleId"
      WHERE na."sourceName" = 'ICC Cricket' 
        AND na.content IS NOT NULL 
        AND LENGTH(na.content) > 100
        AND ec.id IS NULL
    `);

    // Articles scraped in last 24 hours
    const last24h = await client.query(`
      SELECT COUNT(*) as count FROM news_articles 
      WHERE "sourceName" = 'ICC Cricket' 
        AND "createdAt" > NOW() - INTERVAL '24 hours'
    `);

    // Articles enhanced in last 24 hours
    const enhanced24h = await client.query(`
      SELECT COUNT(*) as count FROM news_articles na
      JOIN enhanced_content ec ON na.id = ec."articleId"
      WHERE na."sourceName" = 'ICC Cricket' 
        AND ec."createdAt" > NOW() - INTERVAL '24 hours'
    `);

    const pendingCount = parseInt(pendingEnhancement.rows[0].count);
    const syncStatus =
      pendingCount < 10
        ? "✅ HEALTHY"
        : pendingCount < 20
        ? "⚠️ MODERATE BACKLOG"
        : "❌ NEEDS ATTENTION";

    console.log(`   Sync Status:             ${syncStatus}`);
    console.log(`   Pending enhancement:     ${pendingCount} articles`);
    console.log(
      `   Scraped (last 24h):      ${last24h.rows[0].count} articles`
    );
    console.log(
      `   Enhanced (last 24h):     ${enhanced24h.rows[0].count} articles`
    );
    console.log("");

    // 5. Sample enhanced article
    const sampleEnhanced = await client.query(`
      SELECT na.title as original_title, 
             ec.title as enhanced_title, 
             LEFT(na.content, 200) as content_preview,
             LEFT(ec.content, 300) as enhanced_preview
      FROM news_articles na
      JOIN enhanced_content ec ON na.id = ec."articleId"
      WHERE na."sourceName" = 'ICC Cricket'
      ORDER BY ec."createdAt" DESC
      LIMIT 1
    `);

    if (sampleEnhanced.rows.length > 0) {
      const sample = sampleEnhanced.rows[0];
      console.log("📝 SAMPLE ENHANCED ARTICLE:");
      console.log(
        "─────────────────────────────────────────────────────────────────"
      );
      console.log(`Original Title: ${sample.original_title}`);
      console.log(`Enhanced Title: ${sample.enhanced_title || "N/A"}`);
      console.log("");
      console.log("Original Content Preview:");
      console.log(`   ${sample.content_preview || "N/A"}...`);
      console.log("");
      console.log("Enhanced Content Preview:");
      console.log(`   ${sample.enhanced_preview || "N/A"}...`);
      console.log("");
    }

    console.log(
      "═══════════════════════════════════════════════════════════════════"
    );
    console.log("✅ ICC Sync Check Complete");
    console.log(
      "═══════════════════════════════════════════════════════════════════"
    );
  } catch (error) {
    console.error("❌ Error:", error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

checkICCSync().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
