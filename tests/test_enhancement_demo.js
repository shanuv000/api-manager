require('dotenv').config();
const prisma = require('../component/prismaClient');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_BASE_URL = 'https://ai.urtechy.com';
const API_KEY = 'agp_9dS82kP1J7xWmQZs';
const MODEL = 'claude-opus-4-5-thinking';

// Load system prompt
const SYSTEM_PROMPT_PATH = '/home/dev/.gemini/antigravity/brain/d878ff10-ddbe-40fd-973c-6d13f2d4ba6d/system_prompt_enhancer.md';
const SYSTEM_PROMPT = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8');

async function main() {
  try {
    const articles = await prisma.newsArticle.findMany({
      where: { content: { not: null } },
      take: 1,
      orderBy: { createdAt: 'desc' }
    });

    if (articles.length === 0) {
      console.log("No articles found in DB.");
      return;
    }

    const results = [];

    for (const article of articles) {
      console.log(`Enhancing article: ${article.slug} with Strict System Prompt...`);

      const payload = {
        model: MODEL,
        max_tokens: 8192,
        system: SYSTEM_PROMPT, // Validated system prompt
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              id: article.id,
              title: article.title,
              body: article.content, // Pass full content
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

        // Extract and Clean
        const rContent = response.data.content?.[0]?.text || JSON.stringify(response.data);
        const cleanContent = rContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');

        try {
          const json = JSON.parse(cleanContent);
          if (Array.isArray(json)) {
            results.push(...json); // Flatten array
          } else {
            results.push(json);
          }
        } catch (e) {
          results.push({
            status: "parse_error",
            raw_content: rContent
          });
        }

      } catch (err) {
        results.push({ error: err.message });
      }
    }

    // Save output
    const demoPath = path.join(__dirname, 'final_enhanced_result.json');
    fs.writeFileSync(demoPath, JSON.stringify(results, null, 2));
    console.log(`\nFinal Enhanced Output saved to: ${demoPath}`);

  } catch (error) {
    console.error("Script Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
