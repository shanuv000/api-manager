/**
 * Content Enhancer - Gemini 3.1 Pro High Dual-Pass Pipeline
 *
 * 1. Enhancement Pass: Generates SEO content, analysis, and metadata using Gemini 3.1 Pro High.
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
    API_KEY: process.env.ANTIGRAVITY_API_KEY,
    ENHANCER_MODEL: 'gemini-3.1-pro-high',   // High intelligence for rich editorial content
    FORMATTER_MODEL: 'gemini-2.5-flash',      // Fast model for JSON validation/cleanup
    BATCH_SIZE: 5, // Process 5 at a time for stability
    MAX_TOKENS: 16384,

    // Artifact Paths
    ENHANCER_PROMPT_PATH: path.join(__dirname, 'prompts', 'system_prompt_enhancer.md'),
    FORMATTER_PROMPT_PATH: path.join(__dirname, 'prompts', 'system_prompt_formatter.md'),
};

// Fail fast if API key is missing
if (!CONFIG.API_KEY) {
    console.error('❌ ANTIGRAVITY_API_KEY environment variable is not set. Exiting.');
    process.exit(1);
}

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

// ============================================
// CONTEXT INJECTION — Informational Gain Layer
// ============================================

/**
 * Build supplementary context packet for AI enhancement.
 * Aggregates historical articles, ICC rankings, and cross-source coverage
 * so the AI can synthesize original analytical insights.
 * All data comes from existing DB/Redis — zero external API cost.
 */
async function buildContextPacket(article, prisma) {
    const context = {
        historicalArticles: [],
        rankings: null,
        crossSourceCoverage: [],
    };

    try {
        // 1. HISTORICAL ARTICLES — same entities, last 60 days
        const entityTags = (article.tags || []).slice(0, 5);

        if (entityTags.length > 0) {
            const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

            // Fetch more candidates, then rank by relevance (tag overlap count)
            const historical = await prisma.newsArticle.findMany({
                where: {
                    id: { not: article.id },
                    tags: { hasSome: entityTags },
                    createdAt: { gte: sixtyDaysAgo },
                },
                take: 10,
                orderBy: { createdAt: 'desc' },
                select: {
                    title: true,        // Original source title (not AI-enhanced)
                    description: true,   // Original source description
                    publishedTime: true,
                    tags: true,
                    sourceName: true,
                },
            });

            // Rank by entity overlap relevance (most shared tags first)
            context.historicalArticles = historical
                .map(h => {
                    const sharedTags = entityTags.filter(t => (h.tags || []).includes(t));
                    return {
                        title: h.title,
                        summary: (h.description || '').slice(0, 200),
                        date: h.publishedTime,
                        source: h.sourceName,
                        sharedTags,
                        relevance: sharedTags.length,
                    };
                })
                .sort((a, b) => b.relevance - a.relevance)
                .slice(0, 5);
        }

        // 2. ICC RANKINGS — from Redis cache only (zero API cost)
        try {
            const { getCache } = require('../../component/redisClient');

            for (const format of ['test', 'odi', 't20']) {
                for (const category of ['batsmen', 'bowlers']) {
                    const cacheKey = `cricket:stats:rankings:${category}:${format}`;
                    const cached = await getCache(cacheKey);
                    if (cached?.data) {
                        if (!context.rankings) context.rankings = {};
                        const relevant = summarizeRankings(cached.data, entityTags);
                        if (relevant) {
                            context.rankings[`${format}_${category}`] = relevant;
                        }
                    }
                }
            }
        } catch (e) {
            // Rankings are optional — don't fail if unavailable
            console.log('   \u2139\ufe0f Rankings cache miss — skipping stats context');
        }

        // 3. CROSS-SOURCE COVERAGE — same event from different source
        if (article.sourceName) {
            const titleWords = article.title.toLowerCase().split(/\s+/)
                .filter(w => w.length > 4)
                .slice(0, 4);

            if (titleWords.length >= 2) {
                const crossSource = await prisma.newsArticle.findMany({
                    where: {
                        id: { not: article.id },
                        sourceName: { not: article.sourceName },
                        OR: titleWords.map(word => ({
                            title: { contains: word, mode: 'insensitive' },
                        })),
                    },
                    take: 2,
                    orderBy: { createdAt: 'desc' },
                    select: {
                        title: true,
                        description: true,
                        sourceName: true,
                        publishedTime: true,
                    },
                });

                context.crossSourceCoverage = crossSource.map(c => ({
                    title: c.title,
                    summary: (c.description || '').slice(0, 200),
                    source: c.sourceName,
                    date: c.publishedTime,
                }));
            }
        }
    } catch (err) {
        console.warn(`   \u26a0\ufe0f Context building partially failed: ${err.message}`);
        // Return whatever we got — context is supplementary, not required
    }

    return context;
}

/**
 * Extract relevant ranking entries matching article entities.
 * Returns null if no matches found.
 */
function summarizeRankings(rankingsData, entityTags) {
    try {
        const ranks = rankingsData?.rank || rankingsData?.ranks || [];
        if (!Array.isArray(ranks)) return null;

        const lowerTags = entityTags.map(t => t.toLowerCase());
        const relevant = ranks
            .filter(r => {
                const name = (r.name || r.teamName || '').toLowerCase();
                return lowerTags.some(tag => name.includes(tag) || tag.includes(name));
            })
            .slice(0, 3)
            .map(r => ({
                name: r.name || r.teamName,
                rank: r.rank,
                rating: r.rating,
                points: r.points,
            }));

        return relevant.length > 0 ? relevant : null;
    } catch { return null; }
}

async function callClaudeAPI(systemPrompt, userContent, model, retryCount = 0) {
    const MAX_RETRIES = 3;
    const FALLBACK_MODEL = 'gemini-2.5-flash'; // Fast fallback if primary model is exhausted

    try {
        const payload = {
            model: model,
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
            },
            timeout: 90000 // 90s timeout — prevents hanging API calls from killing the pipeline
        });

        // Robustly extract content - handle both thinking and non-thinking models
        // Response may have: [{type: 'thinking', thinking: '...'}, {type: 'text', text: '...'}]
        // or just: [{type: 'text', text: '...'}]
        const contentBlocks = response.data.content || [];

        // Find the text block (skip thinking blocks)
        const textBlock = contentBlocks.find(block => block.type === 'text');
        let rContent = textBlock?.text || '';

        // Fallback: if no text block, try first block's text property
        if (!rContent && contentBlocks.length > 0) {
            rContent = contentBlocks[0]?.text || JSON.stringify(response.data);
        }

        // Strip markdown code blocks if present
        return rContent.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();

    } catch (err) {
        const status = err.response?.status;
        const isRetryable = status === 403 || status === 429 || status >= 500;

        if (isRetryable && retryCount < MAX_RETRIES) {
            const backoffMs = Math.min(5000 * Math.pow(2, retryCount), 30000);
            console.warn(`   ⚠️ API ${status} on attempt ${retryCount + 1}/${MAX_RETRIES} (model: ${model}). Retrying in ${backoffMs / 1000}s...`);
            await sleep(backoffMs);
            return callClaudeAPI(systemPrompt, userContent, model, retryCount + 1);
        }

        // All retries exhausted with primary model — try fallback model once
        if (isRetryable && retryCount >= MAX_RETRIES && model !== FALLBACK_MODEL) {
            console.warn(`   🔄 Primary model ${model} exhausted. Falling back to ${FALLBACK_MODEL}...`);
            return callClaudeAPI(systemPrompt, userContent, FALLBACK_MODEL, 0);
        }

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
║     Content Enhancer - Gemini 3.1 Pro High Dual-Pass       ║
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

                // --- BUILD CONTEXT PACKET FOR INFORMATIONAL GAIN ---
                console.log("   \ud83d\udcca Building context packet...");
                const contextPacket = await buildContextPacket(article, prisma);
                const contextSummary = [
                    contextPacket.historicalArticles.length + ' historical',
                    contextPacket.rankings ? 'rankings \u2713' : 'no rankings',
                    contextPacket.crossSourceCoverage.length + ' cross-source',
                ].join(', ');
                console.log(`   \ud83d\udcca Context: ${contextSummary}`);

                // --- PASS 1: ENHANCEMENT ---
                console.log("   Brain: Enhancing content...");
                const enhanceInput = JSON.stringify({
                    id: article.id,
                    title: article.title,
                    body: article.content,
                    date: article.publishedTime || article.createdAt,
                    sourceUrl: article.sourceUrl,
                    sourceName: article.sourceName,
                    embeddedTweets: article.embeddedTweets || [],
                    embeddedInstagram: article.embeddedInstagram || [],
                    relatedArticles: relatedArticles,
                    // Context for original analysis (informational gain)
                    context: {
                        recentCoverage: contextPacket.historicalArticles,
                        rankings: contextPacket.rankings,
                        otherSourcePerspectives: contextPacket.crossSourceCoverage,
                    },
                });

                const enhancedRaw = await callClaudeAPI(ENHANCER_PROMPT, enhanceInput, CONFIG.ENHANCER_MODEL);
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

                const formattedRaw = await callClaudeAPI(FORMATTER_PROMPT, JSON.stringify(formatterInput), CONFIG.FORMATTER_MODEL);
                let finalJson;
                try {
                    finalJson = JSON.parse(formattedRaw);
                } catch (e) {
                    console.error("   ❌ Formatting JSON parse failed. Skipping.");
                    continue;
                }

                // Get the single item
                const resultItem = Array.isArray(finalJson) ? finalJson[0] : finalJson;

                // DEBUG: Log structure to understand failures
                if (!resultItem || !resultItem.enhanced_data) {
                    console.error("   ❌ Invalid final structure. Skipping.");
                    console.error("   DEBUG resultItem keys:", resultItem ? Object.keys(resultItem) : 'null');
                    console.error("   DEBUG raw response (first 500 chars):", formattedRaw.substring(0, 500));
                    continue;
                }

                const data = resultItem.enhanced_data;
                console.log("   \ud83d\udd0d Raw Enhancer Output:");
                console.log("      tags:", JSON.stringify(data.tags));
                console.log("      key_takeaways:", JSON.stringify(data.key_takeaways));

                // --- QUALITY GATE ---
                const wordCount = (data.full_blog_post_markdown || '').split(/\s+/).length;
                if (wordCount < 600) {
                    console.error(`   \u274c QUALITY GATE: ${wordCount}w (min 600). Skipping.`);
                    continue;
                }
                console.log(`   \ud83d\udccf Quality: ${wordCount} words`);

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
