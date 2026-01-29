require('dotenv').config();
const prisma = require('../component/prismaClient');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_BASE_URL = 'https://ai.urtechy.com';
const API_KEY = 'agp_9dS82kP1J7xWmQZs';
const MODEL = 'claude-opus-4-5-thinking';

async function main() {
    try {
        const articles = await prisma.newsArticle.findMany({
            where: {
                content: { not: null }
            },
            take: 2,
            orderBy: { createdAt: 'desc' }
        });

        if (articles.length === 0) {
            console.log("No articles found in DB.");
            return;
        }

        const results = [];

        for (const article of articles) {
            console.log(`Processing article: ${article.slug}`);
            const payload = {
                model: MODEL,
                max_tokens: 8192, // Increased from default/implicit
                system: "You are a data validation assistant. Your task is to confirm the input data structure, validate fields, and return them in a specific JSON format without modification or enrichment.",
                messages: [
                    {
                        role: "user",
                        content: JSON.stringify({
                            id: article.id,
                            title: article.title,
                            body: article.content, // FULL content, no substring limitation
                            date: article.publishedTime || article.createdAt,
                            sourceUrl: article.sourceUrl
                        })
                    }
                ]
            };

            try {
                const response = await axios.post(`${API_BASE_URL}/v1/messages`, payload, {
                    headers: {
                        'x-api-key': API_KEY,
                        'anthropic-version': '2023-06-01',
                        'content-type': 'application/json'
                    }
                });

                // Extract content
                const rContent = response.data.content?.[0]?.text || JSON.stringify(response.data);

                // Clean markdown code blocks if present
                let cleanContent = rContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');

                try {
                    const json = JSON.parse(cleanContent);
                    results.push({
                        status: "success",
                        original_slug: article.slug,
                        data: json
                    });
                } catch (e) {
                    results.push({
                        status: "parse_error",
                        raw_content: rContent
                    });
                }

            } catch (err) {
                results.push({
                    status: "api_error",
                    error: err.message,
                    details: err.response?.data
                });
            }
        }

        // Save to demo file
        const demoPath = path.join(__dirname, 'demo_result.json');
        fs.writeFileSync(demoPath, JSON.stringify(results, null, 2));
        console.log(`\nDemo output saved to: ${demoPath}`);

    } catch (error) {
        console.error("Script Error:", error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
