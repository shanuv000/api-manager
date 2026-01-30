/**
 * Content Enhancer - Claude Opus Dual-Pass Pipeline
 *
 * 1. Enhancement Pass: Generates SEO content, analysis, and metadata using Claude Opus.
 * 2. Formatting Pass: Polishes Markdown and ensures production-ready structure.
 *
 * Usage: node scrapers/content-enhancer-claude.js
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require('axios');
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");
const {
    invalidateArticleCache,
    invalidateNewsCache,
} = require("../component/redisClient");

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
    API_BASE_URL: 'https://ai.urtechy.com',
    API_KEY: 'agp_9dS82kP1J7xWmQZs', // In production, use process.env.ANTIGRAVITY_API_KEY
    MODEL: 'claude-opus-4-5-thinking',
    BATCH_SIZE: 5, // High intelligence model, process 5 at a time for stability
    MAX_TOKENS: 8192,

    // Artifact Paths
    // Artifact Paths
    ENHANCER_PROMPT_PATH: path.join(__dirname, 'prompts', 'system_prompt_enhancer.md'),
    FORMATTER_PROMPT_PATH: path.join(__dirname, 'prompts', 'system_prompt_formatter.md'),
};

// ============================================
// HELPERS
// ============================================

// ============================================

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Generate SEO-friendly slug from AI suggestion + source ID
 * - Normalizes to lowercase, hyphens only
 * - Truncates base slug to 50 chars max
 * - Appends unique suffix to guarantee uniqueness:
 *   - Numeric IDs: append full ID (e.g., "136890")
 *   - Descriptive IDs: append short hash (last 8 chars) for uniqueness
 * @param {string} slugSuggestion - AI-generated slug suggestion
 * @param {string} sourceId - Original source ID (e.g., "136890" or "descriptive-slug")
 * @returns {string} SEO slug like "virat-kohli-scores-century-136890"
 */
function generateSeoSlug(slugSuggestion, sourceId) {
    if (!slugSuggestion || typeof slugSuggestion !== 'string') {
        return sourceId; // Fallback to original if no suggestion
    }

    // Normalize: lowercase, replace spaces/underscores with hyphens, remove special chars
    let baseSlug = slugSuggestion
        .toLowerCase()
        .trim()
        .replace(/[\s_]+/g, '-')           // spaces/underscores to hyphens
        .replace(/[^a-z0-9-]/g, '')        // remove non-alphanumeric except hyphens
        .replace(/-+/g, '-')               // collapse multiple hyphens
        .replace(/^-|-$/g, '');            // trim leading/trailing hyphens

    // Truncate base slug to 50 chars max (leaving room for suffix)
    if (baseSlug.length > 50) {
        baseSlug = baseSlug.substring(0, 50).replace(/-$/, '');
    }

    // Generate unique suffix based on source ID type
    const isNumericId = /^\d+$/.test(sourceId);

    if (isNumericId) {
        // Numeric IDs (Cricbuzz): append full ID
        return baseSlug ? `${baseSlug}-${sourceId}` : sourceId;
    } else {
        // Descriptive IDs (ESPN/ICC/BBC): append short hash for uniqueness
        // Use last 8 chars of sourceId as a fingerprint
        const shortHash = sourceId.slice(-8).replace(/[^a-z0-9]/gi, '').toLowerCase();
        return baseSlug ? `${baseSlug}-${shortHash}` : sourceId;
    }
}

async function callClaudeAPI(systemPrompt, userContent) {
    try {
        const payload = {
            model: CONFIG.MODEL,
            max_tokens: CONFIG.MAX_TOKENS,
            system: systemPrompt,
            messages: [
                {
                    role: "user",
                    content: userContent
                }
            ]
        };

        const response = await axios.post(`${CONFIG.API_BASE_URL}/v1/messages`, payload, {
            headers: {
                'x-api-key': CONFIG.API_KEY,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            }
        });

        // robustly extract content
        const rContent = response.data.content?.[0]?.text || JSON.stringify(response.data);
        // strip markdown code blocks
        return rContent.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();

    } catch (err) {
        if (err.response) {
            throw new Error(`API Error ${err.response.status}: ${JSON.stringify(err.response.data)}`);
        }
        throw err;
    }
}

// ============================================
// MAIN LOGIC
// ============================================

async function main() {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║     Content Enhancer - Claude Opus Dual-Pass               ║
╠════════════════════════════════════════════════════════════╣
║  Started: ${new Date().toISOString()}              ║
╚════════════════════════════════════════════════════════════╝
`);

    // DB Setup
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    // Load Prompts
    if (!fs.existsSync(CONFIG.ENHANCER_PROMPT_PATH) || !fs.existsSync(CONFIG.FORMATTER_PROMPT_PATH)) {
        console.error("❌ System prompt artifacts not found. Please regenerate them.");
        process.exit(1);
    }
    const ENHANCER_PROMPT = fs.readFileSync(CONFIG.ENHANCER_PROMPT_PATH, 'utf-8');
    const FORMATTER_PROMPT = fs.readFileSync(CONFIG.FORMATTER_PROMPT_PATH, 'utf-8');

    try {
        // 1. Fetch Candidates
        const articles = await prisma.newsArticle.findMany({
            where: {
                enhancedContent: null,
                content: { not: null }
            },
            take: CONFIG.BATCH_SIZE,
            orderBy: { createdAt: 'desc' }
        });

        if (articles.length === 0) {
            console.log("✅ No articles to enhance.");
            return;
        }

        console.log(`Processing ${articles.length} articles...`);

        for (const article of articles) {
            console.log(`\n🔹 Processing: ${article.slug}`);

            try {
                // --- FETCH RELATED ARTICLES FOR INTERNAL LINKING ---
                let relatedArticles = [];
                if (article.tags && article.tags.length > 0) {
                    const related = await prisma.newsArticle.findMany({
                        where: {
                            id: { not: article.id },
                            enhancedContent: { isNot: null },
                            tags: { hasSome: article.tags }
                        },
                        take: 5,
                        select: { title: true, slug: true },
                        orderBy: { createdAt: 'desc' }
                    });
                    relatedArticles = related.map(a => ({
                        title: a.title,
                        url: `/news/${a.slug}`
                    }));
                    if (relatedArticles.length > 0) {
                        console.log(`   🔗 Found ${relatedArticles.length} related articles for internal linking`);
                    }
                }

                // --- PASS 1: ENHANCEMENT ---
                console.log("   Brain: Enhancing content...");
                const enhanceInput = JSON.stringify({
                    id: article.id,
                    title: article.title,
                    body: article.content,
                    date: article.publishedTime || article.createdAt,
                    sourceUrl: article.sourceUrl,
                    embeddedTweets: article.embeddedTweets || [],
                    embeddedInstagram: article.embeddedInstagram || [],
                    relatedArticles: relatedArticles
                });

                const enhancedRaw = await callClaudeAPI(ENHANCER_PROMPT, enhanceInput);
                let enhancedJson;
                try {
                    enhancedJson = JSON.parse(enhancedRaw);
                } catch (e) {
                    console.error("   ❌ Enhancement JSON parse failed. Skipping.");
                    continue;
                }

                // --- PASS 2: FORMATTING ---
                console.log("   Brain: Formatting & Polishing...");
                // Ensure input is array as expected by formatter
                const formatterInput = Array.isArray(enhancedJson) ? enhancedJson : [enhancedJson];

                const formattedRaw = await callClaudeAPI(FORMATTER_PROMPT, JSON.stringify(formatterInput));
                let finalJson;
                try {
                    finalJson = JSON.parse(formattedRaw);
                } catch (e) {
                    console.error("   ❌ Formatting JSON parse failed. Skipping.");
                    continue;
                }

                // Get the single item
                const resultItem = Array.isArray(finalJson) ? finalJson[0] : finalJson;
                if (!resultItem || !resultItem.enhanced_data) {
                    console.error("   ❌ Invalid final structure. Skipping.");
                    continue;
                }

                const data = resultItem.enhanced_data;
                console.log("   🔍 Raw Enhancer Output:");
                console.log("      tags:", JSON.stringify(data.tags));
                console.log("      key_takeaways:", JSON.stringify(data.key_takeaways));

                // --- SAVE TO DB ---
                // --- SAVE TO DB ---
                // 1. Update EnhancedContent
                await prisma.enhancedContent.upsert({
                    where: { articleId: article.id },
                    update: {
                        title: data.enhanced_title,
                        content: data.full_blog_post_markdown,
                        metaDescription: data.seo_meta_description,
                        keyTakeaways: data.key_takeaways || data.tags || [], // Fallback to tags if key_takeaways missing (old prompt)
                        status: "published",
                    },
                    create: {
                        articleId: article.id,
                        title: data.enhanced_title,
                        content: data.full_blog_post_markdown,
                        metaDescription: data.seo_meta_description,
                        keyTakeaways: data.key_takeaways || data.tags || [],
                        status: "published"
                    }
                });

                // 2. Update NewsArticle tags if provided
                // The new prompt provides data.tags as keywords.
                // We check if data.tags contains emojis to distinguish from old prompt format just in case.
                const hasEmojis = (str) => /[\u{1F300}-\u{1F6FF}]/u.test(str);

                // If we have distinct key_takeaways, then data.tags are likely the real keywords
                let keywords = [];
                if (data.key_takeaways && Array.isArray(data.tags)) {
                    keywords = data.tags;
                } else if (Array.isArray(data.tags)) {
                    // Fallback: mixed bag. Filter out emoji strings for tags
                    keywords = data.tags.filter(t => !hasEmojis(t));
                }

                if (keywords.length > 0) {
                    await prisma.newsArticle.update({
                        where: { id: article.id },
                        data: {
                            tags: keywords
                        }
                    });
                    console.log(`   🏷️  Updated ${keywords.length} tags on NewsArticle`);
                }

                // 3. Update NewsArticle slug with SEO version
                const oldSlug = article.slug;
                const newSlug = generateSeoSlug(data.slug_suggestion, article.sourceId || oldSlug);
                if (newSlug !== oldSlug) {
                    await prisma.newsArticle.update({
                        where: { id: article.id },
                        data: { slug: newSlug }
                    });
                    console.log(`   🔗 Slug updated: ${oldSlug} → ${newSlug}`);
                }

                console.log(`   ✅ Saved Enhanced Article: "${data.enhanced_title}"`);

                // Cache Invalidation - invalidate both old and new slugs
                if (oldSlug) {
                    await invalidateArticleCache(oldSlug);
                }
                if (newSlug && newSlug !== oldSlug) {
                    await invalidateArticleCache(newSlug);
                }
                await invalidateNewsCache();
                console.log("   🗑️  Cache invalidated");

            } catch (err) {
                console.error(`   ❌ Failed to process article: ${err.message}`);
            }

            // Sleep 30s between items (not after the last one)
            if (article !== articles[articles.length - 1]) {
                console.log("   ⏳ Sleeping 30s before next article...");
                await sleep(30000);
            }
        }

    } catch (error) {
        console.error("Fatal Error:", error);
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

main();
