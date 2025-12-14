/**
 * Perplexity AI Tag Generator
 * Uses Perplexity API to generate SEO-friendly tags for articles
 */

const axios = require('axios');

const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';

/**
 * Generate tags for a cricket news article using Perplexity AI
 * @param {string} title - Article title
 * @param {string} content - Article content (first 500 chars is enough)
 * @returns {Promise<string[]>} Array of tags
 */
async function generateTags(title, content) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  
  if (!apiKey) {
    console.warn('⚠️ PERPLEXITY_API_KEY not set, skipping tag generation');
    return [];
  }

  try {
    const prompt = `Analyze this cricket news article and generate 3-5 SEO-friendly tags.

Title: ${title}
Content: ${(content || '').substring(0, 500)}

Rules:
- Return ONLY a JSON array of strings
- Tags should be specific (player names, team names, tournament names)
- No generic tags like "cricket" or "sports"
- Maximum 5 tags
- Example: ["Virat Kohli", "IPL 2026", "Mumbai Indians"]

Return only the JSON array, nothing else.`;

    const response = await axios.post(
      PERPLEXITY_API_URL,
      {
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content: 'You are a cricket news analyst. Generate concise, SEO-friendly tags for articles. Return only JSON arrays.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 100,
        temperature: 0.1
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    const result = response.data.choices[0]?.message?.content || '[]';
    
    // Parse the JSON response
    try {
      // Clean up response - sometimes AI adds extra text
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const tags = JSON.parse(jsonMatch[0]);
        if (Array.isArray(tags)) {
          return tags.slice(0, 5).map(tag => String(tag).trim());
        }
      }
    } catch (parseError) {
      console.error('Failed to parse tags response:', result);
    }
    
    return [];
  } catch (error) {
    console.error('Perplexity API error:', error.message);
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
    console.log(`  ${i + 1}/${articles.length} - ${article.title.substring(0, 40)}...`);
    
    const tags = await generateTags(article.title, article.content);
    tagsMap.set(article.id, tags);
    
    // Rate limiting - 1 second between requests
    if (i < articles.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log(`✅ Generated tags for ${tagsMap.size} articles`);
  return tagsMap;
}

module.exports = {
  generateTags,
  generateTagsForArticles
};
