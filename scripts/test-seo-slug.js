#!/usr/bin/env node
/**
 * Test script to reset one article and re-run the enhancer
 * to verify SEO slug generation is working.
 */

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

async function resetOneArticle() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    try {
        // Find one Cricbuzz article to test (they have numeric slugs)
        const article = await prisma.newsArticle.findFirst({
            where: {
                sourceName: "Cricbuzz",
                content: { not: null },
            },
            orderBy: { createdAt: "desc" },
            select: { id: true, slug: true, sourceId: true, title: true },
        });

        if (!article) {
            console.log("No Cricbuzz article found");
            return;
        }

        console.log("🔄 Resetting article for test:");
        console.log("   ID:", article.id);
        console.log("   Slug:", article.slug);
        console.log("   SourceID:", article.sourceId);
        console.log("   Title:", article.title.substring(0, 60) + "...");

        // Delete the enhanced content to allow re-processing
        const deleted = await prisma.enhancedContent.deleteMany({
            where: { articleId: article.id },
        });

        console.log("✅ Enhanced content deleted:", deleted.count, "record(s)");
        console.log("\n🚀 Now run: node scrapers/content-enhancer-claude.js");
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

resetOneArticle();
