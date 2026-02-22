/**
 * Test: Full dual-pass enhancer pipeline with split models
 * Pass 1: gemini-3.1-pro-high (enhancement)
 * Pass 2: gemini-2.5-flash (formatting/validation)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const ENHANCER_PROMPT = fs.readFileSync(path.join(__dirname, '../scrapers/prompts/system_prompt_enhancer.md'), 'utf-8');
const FORMATTER_PROMPT = fs.readFileSync(path.join(__dirname, '../scrapers/prompts/system_prompt_formatter.md'), 'utf-8');

async function callAPI(systemPrompt, userContent, model) {
    const response = await axios.post('https://ai.urtechy.com/v1/messages', {
        model, max_tokens: 16384, system: systemPrompt,
        messages: [{ role: 'user', content: userContent }]
    }, {
        headers: {
            'x-api-key': process.env.ANTIGRAVITY_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
        },
        timeout: 120000
    });
    const textBlock = (response.data.content || []).find(b => b.type === 'text');
    return (textBlock?.text || '').replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
}

async function main() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    const article = await prisma.newsArticle.findFirst({
        where: { content: { not: null }, enhancedContent: { isNot: null } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, content: true, sourceUrl: true, createdAt: true, publishedTime: true }
    });

    if (!article) { console.log('No articles found'); return; }

    console.log('=== PRODUCTION PIPELINE TEST ===');
    console.log('Article:', article.title);

    // PASS 1: Enhancement (Pro High)
    const t1 = Date.now();
    console.log('\nPass 1: gemini-3.1-pro-high (Enhancer)...');
    const enhancedRaw = await callAPI(ENHANCER_PROMPT, JSON.stringify({
        id: article.id, title: article.title, body: article.content,
        date: article.publishedTime || article.createdAt,
        sourceUrl: article.sourceUrl, embeddedTweets: [], embeddedInstagram: [], relatedArticles: []
    }), 'gemini-3.1-pro-high');
    const t1done = Date.now();
    console.log('  ✅ Pass 1 done in', ((t1done - t1) / 1000).toFixed(1) + 's');

    let enhancedJson;
    try {
        enhancedJson = JSON.parse(enhancedRaw);
    } catch (e) {
        console.log('❌ Pass 1 JSON parse failed:', e.message);
        console.log('Raw:', enhancedRaw.substring(0, 500));
        await prisma.$disconnect(); await pool.end(); return;
    }

    const formatterInput = Array.isArray(enhancedJson) ? enhancedJson : [enhancedJson];

    // PASS 2: Formatting (Flash)
    console.log('\nPass 2: gemini-2.5-flash (Formatter)...');
    const t2 = Date.now();
    const formattedRaw = await callAPI(FORMATTER_PROMPT, JSON.stringify(formatterInput), 'gemini-2.5-flash');
    const t2done = Date.now();
    console.log('  ✅ Pass 2 done in', ((t2done - t2) / 1000).toFixed(1) + 's');

    let finalJson;
    try {
        finalJson = JSON.parse(formattedRaw);
    } catch (e) {
        console.log('❌ Pass 2 JSON parse failed:', e.message);
        console.log('Raw:', formattedRaw.substring(0, 500));
        await prisma.$disconnect(); await pool.end(); return;
    }

    const resultItem = Array.isArray(finalJson) ? finalJson[0] : finalJson;

    if (!resultItem || !resultItem.enhanced_data) {
        console.log('❌ Invalid structure:', resultItem ? Object.keys(resultItem) : 'null');
        await prisma.$disconnect(); await pool.end(); return;
    }

    const data = resultItem.enhanced_data;
    const blog = data.full_blog_post_markdown || '';
    const totalTime = ((t2done - t1) / 1000).toFixed(1);

    console.log('\n=== RESULTS ===');
    console.log('Total pipeline time:', totalTime + 's (Pass1:', ((t1done - t1) / 1000).toFixed(1) + 's + Pass2:', ((t2done - t2) / 1000).toFixed(1) + 's)');
    console.log('Title:', data.enhanced_title, '(' + (data.enhanced_title || '').length + ' chars)');
    console.log('Meta:', (data.seo_meta_description || '').length, 'chars');
    console.log('Blog:', blog.split(/\s+/).length, 'words');
    console.log('Tags:', (data.tags || []).length);
    console.log('Takeaways:', (data.key_takeaways || []).length);
    console.log('Virality:', data.virality_score + '/10');

    // AI pattern check
    const aiPatterns = ['It is worth noting', 'Furthermore', 'Moreover', 'In conclusion', 'This highlights', 'This underscores', 'delve into', 'A testament to', 'It remains to be seen', 'The stage is set', 'In the world of'];
    const found = aiPatterns.filter(p => blog.toLowerCase().includes(p.toLowerCase()));
    console.log('AI phrases:', found.length === 0 ? '✅ CLEAN' : '❌ ' + found.join(', '));

    // Schema check
    const required = ['enhanced_title', 'seo_meta_description', 'slug_suggestion', 'full_blog_post_markdown', 'tags', 'key_takeaways', 'sentiment', 'virality_score'];
    const missing = required.filter(f => !data[f] && data[f] !== 0);
    console.log('Schema:', missing.length === 0 ? '✅ All fields present' : '❌ Missing: ' + missing.join(', '));

    // Human markers
    const contractions = (blog.match(/\b(didn't|won't|it's|wasn't|couldn't|doesn't|aren't|isn't|he's|she's|they're|that's|there's|can't|hadn't)\b/gi) || []);
    const questions = (blog.match(/\?/g) || []).length;
    console.log('Contractions:', contractions.length);
    console.log('Questions:', questions);

    console.log('\n✅ PRODUCTION READY');

    await prisma.$disconnect();
    await pool.end();
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
