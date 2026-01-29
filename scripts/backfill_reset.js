require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function resetRecent() {
    const COUNT = 10; // Number of articles to reset
    console.log(`Resetting last ${COUNT} articles for backfill...`);

    try {
        // 1. Get recent articles that have enhanced content
        const articles = await prisma.newsArticle.findMany({
            where: {
                enhancedContent: { isNot: null }
            },
            take: COUNT,
            orderBy: { createdAt: 'desc' },
            select: { id: true, title: true, slug: true }
        });

        if (articles.length === 0) {
            console.log("No enhanced articles found to reset.");
            return;
        }

        // 2. Delete their enhanced content
        const ids = articles.map(a => a.id);
        await prisma.enhancedContent.deleteMany({
            where: { articleId: { in: ids } }
        });

        // 3. Clear their tags
        await prisma.newsArticle.updateMany({
            where: { id: { in: ids } },
            data: { tags: [] }
        });

        console.log(`✅ Successfully reset ${articles.length} articles.`);
        articles.forEach(a => console.log(`   - ${a.title}`));

    } catch (e) {
        console.error("Error resetting articles:", e);
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

resetRecent();
