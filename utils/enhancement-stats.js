/**
 * Enhancement Stats Utility
 *
 * Calculates and returns statistics about content enhancement coverage.
 * Used by API endpoint and VPS scrape script for monitoring.
 */

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

let pool;
let prisma;

/**
 * Initialize database connection
 */
async function initDatabase() {
  if (prisma) return prisma;

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
  });
  prisma = new PrismaClient({
    adapter: new PrismaPg(pool),
  });
  return prisma;
}

/**
 * Close database connection
 */
async function closeDatabase() {
  if (prisma) await prisma.$disconnect();
  if (pool) await pool.end();
  prisma = null;
  pool = null;
}

/**
 * Get enhancement statistics
 * @param {Object} options - Options for stats calculation
 * @param {number} options.recentDays - Number of days for "recent" stats (default: 7)
 * @returns {Promise<Object>} Enhancement statistics
 */
async function getEnhancementStats(options = {}) {
  const recentDays = options.recentDays || 7;

  await initDatabase();

  const recentDate = new Date();
  recentDate.setDate(recentDate.getDate() - recentDays);

  // Get all-time stats
  const [totalArticles, enhancedArticles, failedEnhancements] =
    await Promise.all([
      prisma.newsArticle.count({
        where: { content: { not: null } },
      }),
      prisma.enhancedContent.count({
        where: { status: "published" },
      }),
      prisma.enhancedContent.count({
        where: { status: "failed" },
      }),
    ]);

  // Get recent stats (last N days)
  const [recentTotal, recentEnhanced] = await Promise.all([
    prisma.newsArticle.count({
      where: {
        content: { not: null },
        createdAt: { gte: recentDate },
      },
    }),
    prisma.enhancedContent.count({
      where: {
        status: "published",
        createdAt: { gte: recentDate },
      },
    }),
  ]);

  // Calculate coverage percentages
  const allTimeCoverage =
    totalArticles > 0
      ? ((enhancedArticles / totalArticles) * 100).toFixed(1)
      : "0.0";
  const recentCoverage =
    recentTotal > 0
      ? ((recentEnhanced / recentTotal) * 100).toFixed(1)
      : "0.0";

  // Get pending count (articles without enhanced content)
  const pendingArticles = totalArticles - enhancedArticles;

  // Get source breakdown
  const sourceBreakdown = await prisma.newsArticle.groupBy({
    by: ["sourceName"],
    _count: true,
    where: { content: { not: null } },
  });

  // Get enhanced count by source
  const enhancedBySource = await prisma.$queryRaw`
    SELECT na."sourceName", COUNT(ec.id) as "enhancedCount"
    FROM news_articles na
    LEFT JOIN enhanced_content ec ON na.id = ec."articleId" AND ec.status = 'published'
    WHERE na.content IS NOT NULL
    GROUP BY na."sourceName"
  `;

  // Build source stats
  const sourceStats = sourceBreakdown.map((s) => {
    const enhanced =
      enhancedBySource.find((e) => e.sourceName === s.sourceName)
        ?.enhancedCount || 0;
    return {
      source: s.sourceName,
      total: s._count,
      enhanced: Number(enhanced),
      pending: s._count - Number(enhanced),
      coverage: ((Number(enhanced) / s._count) * 100).toFixed(1) + "%",
    };
  });

  return {
    allTime: {
      total: totalArticles,
      enhanced: enhancedArticles,
      pending: pendingArticles,
      failed: failedEnhancements,
      coveragePercent: parseFloat(allTimeCoverage),
    },
    recent: {
      days: recentDays,
      total: recentTotal,
      enhanced: recentEnhanced,
      pending: recentTotal - recentEnhanced,
      coveragePercent: parseFloat(recentCoverage),
    },
    bySource: sourceStats,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get a simple one-line stats summary for Discord
 * @returns {Promise<string>} One-line stats summary
 */
async function getStatsSummary() {
  const stats = await getEnhancementStats({ recentDays: 7 });
  return `📊 Enhanced: ${stats.allTime.enhanced}/${stats.allTime.total} (${stats.allTime.coveragePercent}%) | Pending: ${stats.allTime.pending} | 7d: ${stats.recent.coveragePercent}%`;
}

/**
 * Analyze coverage stats and return alerts based on thresholds
 * @param {Object} stats - Stats from getEnhancementStats()
 * @returns {Object} { level: 'ok'|'warning'|'critical', alerts: [], summary: string }
 */
function getCoverageAlerts(stats) {
  const alerts = [];

  // All-time coverage thresholds
  if (stats.allTime.coveragePercent < 60) {
    alerts.push({
      level: "critical",
      msg: `🚨 All-time coverage CRITICAL: ${stats.allTime.coveragePercent}% (<60%)`,
    });
  } else if (stats.allTime.coveragePercent < 75) {
    alerts.push({
      level: "warning",
      msg: `⚠️ All-time coverage LOW: ${stats.allTime.coveragePercent}% (<75%)`,
    });
  }

  // Recent 7-day coverage thresholds
  if (stats.recent.coveragePercent < 50) {
    alerts.push({
      level: "critical",
      msg: `🚨 7-day coverage CRITICAL: ${stats.recent.coveragePercent}% (<50%)`,
    });
  } else if (stats.recent.coveragePercent < 70) {
    alerts.push({
      level: "warning",
      msg: `⚠️ 7-day coverage LOW: ${stats.recent.coveragePercent}% (<70%)`,
    });
  }

  // Pending articles threshold
  if (stats.allTime.pending > 100) {
    alerts.push({
      level: "warning",
      msg: `📥 Backlog high: ${stats.allTime.pending} articles pending`,
    });
  }

  const level = alerts.some((a) => a.level === "critical")
    ? "critical"
    : alerts.some((a) => a.level === "warning")
    ? "warning"
    : "ok";

  return {
    level,
    alerts,
    summary: alerts.map((a) => a.msg).join("; ") || "✅ Coverage healthy",
  };
}

/**
 * Get coverage status for CLI/bash parsing
 * Output format: LEVEL|SUMMARY|DETAILS (pipe-separated for easy bash parsing)
 */
async function getCoverageStatus() {
  const stats = await getEnhancementStats({ recentDays: 7 });
  const alertInfo = getCoverageAlerts(stats);

  const details = `All-time: ${stats.allTime.coveragePercent}% (${stats.allTime.enhanced}/${stats.allTime.total}) | 7d: ${stats.recent.coveragePercent}% | Pending: ${stats.allTime.pending}`;

  // Output pipe-separated for bash parsing
  console.log(`${alertInfo.level}|${alertInfo.summary}|${details}`);
  return { level: alertInfo.level, summary: alertInfo.summary, details };
}

// CLI execution for VPS script
if (require.main === module) {
  (async () => {
    try {
      // Check if --status flag is passed for coverage status
      if (process.argv.includes("--status")) {
        await getCoverageStatus();
      } else {
        const summary = await getStatsSummary();
        console.log(summary);
      }
    } catch (error) {
      console.error("Error getting stats:", error.message);
    } finally {
      await closeDatabase();
    }
  })();
}

module.exports = {
  getEnhancementStats,
  getStatsSummary,
  getCoverageAlerts,
  getCoverageStatus,
  initDatabase,
  closeDatabase,
};

