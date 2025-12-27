/**
 * Perplexity AI Tag Generator
 * Uses Perplexity API to generate SEO-friendly tags for articles
 */

const axios = require("axios");

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";

/**
 * Generate tags for a cricket news article using Perplexity AI
 * @param {string} title - Article title
 * @param {string} content - Article content (first 500 chars is enough)
 * @returns {Promise<string[]>} Array of tags
 */
async function generateTags(title, content, retryCount = 0) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  const MAX_RETRIES = 1;
  const TIMEOUT_MS = 30000; // 30 seconds

  if (!apiKey) {
    console.warn("⚠️ PERPLEXITY_API_KEY not set, skipping tag generation");
    return [];
  }

  try {
    const prompt = `Generate exactly 5 highly specific SEO tags for this cricket news article.

Title: ${title}
Content: ${(content || "").substring(0, 800)}

REQUIRED TAG TYPES (include at least 3):
1. PLAYER NAMES - Full names of cricketers mentioned (e.g., "Virat Kohli", "Pat Cummins")
2. TEAM NAMES - Cricket teams involved (e.g., "India", "Mumbai Indians", "England")
3. TOURNAMENT/SERIES - ALWAYS include year (e.g., "IPL 2025", "Ashes 2025-26", "T20 World Cup 2026")
4. VENUE/LOCATION - Match location if mentioned (e.g., "MCG", "Lords", "Wankhede Stadium")
5. TRENDING TOPIC - Current event buzz (e.g., "Hat-trick", "Century Record", "Retirement Announcement")

FORBIDDEN (do NOT include):
- Generic: "cricket", "sports", "news", "latest"
- Common words: "match", "game", "update"
- Source names: "ICC", "ESPN", "BBC"

Return ONLY a valid JSON array with exactly 5 tags.
Example: ["Virat Kohli", "India vs Australia", "Border-Gavaskar Trophy 2025", "MCG", "Century Record"]`;

    const response = await axios.post(
      PERPLEXITY_API_URL,
      {
        model: "sonar",
        messages: [
          {
            role: "system",
            content:
              "You are a cricket news analyst. Generate concise, SEO-friendly tags for articles. Return only JSON arrays.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: 150,
        temperature: 0.1,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: TIMEOUT_MS,
      }
    );

    const result = response.data.choices[0]?.message?.content || "[]";

    // Parse the JSON response
    try {
      // Clean up response - sometimes AI adds extra text
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const tags = JSON.parse(jsonMatch[0]);
        if (Array.isArray(tags)) {
          return tags.slice(0, 5).map((tag) => String(tag).trim());
        }
      }
    } catch (parseError) {
      console.error("Failed to parse tags response:", result);
    }

    return [];
  } catch (error) {
    const isTimeout =
      error.code === "ECONNABORTED" || error.message.includes("timeout");

    // Retry once on timeout
    if (isTimeout && retryCount < MAX_RETRIES) {
      console.warn(
        `Perplexity timeout, retrying (attempt ${retryCount + 2})...`
      );
      await new Promise((r) => setTimeout(r, 2000)); // Wait 2s before retry
      return generateTags(title, content, retryCount + 1);
    }

    console.error("Perplexity API error:", error.message);
    return [];
  }
}

/**
 * Generate tags for multiple articles (batch processing)
 * @param {Array} articles - Array of {id, title, content} objects
 * @returns {Promise<Map>} Map of article ID to tags array
 */
async function generateTagsForArticles(articles) {
  const tagsMap = new Map();

  console.log(`🏷️ Generating tags for ${articles.length} articles...`);

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    console.log(
      `  ${i + 1}/${articles.length} - ${article.title.substring(0, 40)}...`
    );

    const tags = await generateTags(article.title, article.content);
    tagsMap.set(article.id, tags);

    // Rate limiting - 1 second between requests
    if (i < articles.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  console.log(`✅ Generated tags for ${tagsMap.size} articles`);
  return tagsMap;
}

module.exports = {
  generateTags,
  generateTagsForArticles,
};
