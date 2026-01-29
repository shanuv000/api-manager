require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function checkTags() {
    try {
        const slug = "psl-moves-from-drafts-to-auctions-from-next-season-1520136";
        console.log(`Checking article: ${slug}`);

        const article = await prisma.newsArticle.findUnique({
            where: { slug },
            select: {
                title: true,
                tags: true,
                enhancedContent: {
                    select: {
                        keyTakeaways: true
                    }
                }
            }
        });

        if (article) {
            console.log(`\nTitle: ${article.title}`);
            console.log(`NewsArticle.tags (${article.tags.length}):`, article.tags);
            console.log(`EnhancedContent.keyTakeaways (${article.enhancedContent?.keyTakeaways.length || 0}):`, article.enhancedContent?.keyTakeaways);
        } else {
            console.log("❌ Article not found with that slug.");
        }

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

checkTags();
