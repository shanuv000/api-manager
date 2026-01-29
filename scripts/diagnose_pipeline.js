require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function diagnose() {
    const TWENTY_FOUR_HOURS_AGO = new Date(Date.now() - 24 * 60 * 60 * 1000);

    console.log("diagnose_pipeline: Starting analysis...");
    console.log(`Checking data since: ${TWENTY_FOUR_HOURS_AGO.toISOString()}`);

    try {
        // 1. Scraper Output
        const recentArticles = await prisma.newsArticle.findMany({
            where: {
                createdAt: { gte: TWENTY_FOUR_HOURS_AGO }
            },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                title: true,
                sourceName: true,
                createdAt: true,
                enhancedContent: { select: { id: true, status: true, title: true } }
            }
        });

        console.log(`\n1. Scraper Output (Last 24h): ${recentArticles.length} articles`);
        const sourceStats = {};
        if (recentArticles.length > 0) {
            console.log("   Latest 5 Articles:");
            recentArticles.slice(0, 5).forEach(a => console.log(`   - [${a.createdAt.toISOString()}] ${a.title}`));
        }
        recentArticles.forEach(a => {
            sourceStats[a.sourceName] = (sourceStats[a.sourceName] || 0) + 1;
        });
        console.log("   Breakdown by Source:", JSON.stringify(sourceStats));

        // 2. Enhancer Output
        const recentEnhanced = await prisma.enhancedContent.findMany({
            where: {
                createdAt: { gte: TWENTY_FOUR_HOURS_AGO }
            },
            orderBy: { createdAt: 'desc' },
            select: { id: true, title: true, status: true, createdAt: true, articleId: true }
        });

        console.log(`\n2. Enhancer Output (Last 24h): ${recentEnhanced.length} enhanced articles`);

        // 3. Gap Analysis
        const unenhanced = recentArticles.filter(a => !a.enhancedContent);
        console.log(`\n3. GAP: ${unenhanced.length} articles from last 24h NOT enhanced.`);
        if (unenhanced.length > 0) {
            console.log("   Sample unenhanced:");
            unenhanced.slice(0, 3).forEach(a => console.log(`   - [${a.sourceName}] ${a.title}`));
        }

        // 4. Failed Enhancements?
        const failed = recentEnhanced.filter(e => e.status !== 'completed' && e.status !== 'published');
        if (failed.length > 0) {
            console.log(`\n4. FAILED Enhancements: ${failed.length}`);
            failed.forEach(e => console.log(`   - ${e.title} (${e.status})`));
        }

    } catch (e) {
        console.error("Diagnosis failed:", e);
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

diagnose();
