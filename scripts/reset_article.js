require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function resetArticle() {
    try {
        const slug = "under-19-world-cup-2026-raza-usman-steer-pakistan-to-victory-over-scotland-1520173";
        console.log(`Resetting: ${slug}`);

        // Delete EnhancedContent
        const article = await prisma.newsArticle.findUnique({ where: { slug } });
        if (article) {
            await prisma.enhancedContent.deleteMany({
                where: { articleId: article.id }
            });
            // Clear tags
            await prisma.newsArticle.update({
                where: { id: article.id },
                data: { tags: [] }
            });
            console.log("✅ EnhancedContent deleted and tags cleared.");
        } else {
            console.log("Article not found.");
        }

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

resetArticle();
