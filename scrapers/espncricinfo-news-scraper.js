/**
 * ESPN Cricinfo News Scraper
 * Fetches latest cricket news from ESPN Cricinfo with detailed information
 * Uses axios for HTTP requests and cheerio for HTML parsing
 */

const axios = require('axios');
const cheerio = require('cheerio');

class ESPNCricinfoScraper {
  constructor() {
    this.baseUrl = 'https://www.espncricinfo.com';
    this.newsUrl = 'https://www.espncricinfo.com/cricket-news';
    
    // Headers to mimic a real browser request
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Pragma': 'no-cache',
      'Sec-Ch-Ua': '"Not_A Brand";v="99", "Google Chrome";v="120", "Chromium";v="120"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"macOS"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    };

    // Create axios instance with default configuration
    this.axiosInstance = axios.create({
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: (status) => status < 500,
    });
  }

  /**
   * Make HTTP request with retry logic
   * @param {string} url - URL to fetch
   * @param {number} retries - Number of retry attempts
   * @returns {Promise<object>} - Response data
   */
  async fetchWithRetry(url, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`📡 Fetching: ${url} (Attempt ${attempt}/${retries})`);
        
        const response = await this.axiosInstance.get(url, {
          headers: this.headers,
        });

        if (response.status === 200) {
          return response.data;
        } else if (response.status === 403) {
          console.log('⚠️  Received 403 - trying with different headers...');
          // Try with simpler headers
          const simpleResponse = await axios.get(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
            },
            timeout: 30000,
          });
          if (simpleResponse.status === 200) {
            return simpleResponse.data;
          }
        }
        
        throw new Error(`HTTP ${response.status}`);
      } catch (error) {
        console.log(`❌ Attempt ${attempt} failed: ${error.message}`);
        
        if (attempt === retries) {
          throw error;
        }
        
        // Wait before retrying (exponential backoff)
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        console.log(`⏳ Waiting ${delay}ms before retry...`);
        await this.delay(delay);
      }
    }
  }

  /**
   * Helper function to add delay
   * @param {number} ms - Milliseconds to delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get high-quality image URL from thumbnail
   * @param {string} imageUrl - Original image URL
   * @returns {string} - High quality image URL
   */
  getHighQualityImageUrl(imageUrl) {
    if (!imageUrl) return null;
    
    try {
      // ESPN uses image resizing parameters, try to get higher resolution
      // Replace size parameters like &w=300 with larger sizes
      let url = imageUrl;
      url = url.replace(/&w=\d+/g, '&w=1200');
      url = url.replace(/&h=\d+/g, '&h=800');
      url = url.replace(/&p=\w+/g, '&p=high');
      return url;
    } catch (e) {
      return imageUrl;
    }
  }

  /**
   * Extract slug from URL for use as ID
   * @param {string} url - Article URL
   * @returns {string} - Extracted slug/ID
   */
  extractSlugFromUrl(url) {
    if (!url) return null;
    try {
      const parts = url.split('/');
      // Get the last meaningful part of the URL
      const lastPart = parts.filter(p => p && p.length > 0).pop();
      return lastPart || url;
    } catch (e) {
      return url;
    }
  }

  /**
   * Parse date string to ISO format
   * @param {string} dateString - Date string from the website
   * @returns {string} - ISO formatted date
   */
  parseDate(dateString) {
    if (!dateString) return null;
    try {
      const date = new Date(dateString);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
      return dateString;
    } catch (e) {
      return dateString;
    }
  }

  /**
   * Fetch the latest news from ESPN Cricinfo
   * @returns {Promise<Array>} Array of news articles
   */
  async fetchLatestNews() {
    try {
      console.log('🏏 Fetching latest cricket news from ESPN Cricinfo...');
      
      const html = await this.fetchWithRetry(this.newsUrl);
      const $ = cheerio.load(html);
      
      const newsArticles = [];
      const seen = new Set();

      // ESPN Cricinfo uses various selectors for news articles
      // Try multiple selectors to capture all articles
      const articleSelectors = [
        'article a[href*="/story/"]',
        'a[href*="/story/"]',
        '[class*="story"] a',
        '[class*="news"] a',
        '[class*="article"] a',
        'a[href*="/cricket-news/"]',
      ];

      // Find all potential article links
      articleSelectors.forEach(selector => {
        $(selector).each((_, element) => {
          const $el = $(element);
          const href = $el.attr('href');
          
          if (!href) return;
          
          // Build full URL if relative
          const fullUrl = href.startsWith('http') ? href : `${this.baseUrl}${href}`;
          
          // Skip non-article URLs
          if (seen.has(fullUrl) ||
              !fullUrl.includes('/story/') && !fullUrl.includes('/cricket-news/') ||
              fullUrl.includes('/cricket-news?') ||
              fullUrl.endsWith('/cricket-news') ||
              fullUrl.endsWith('/cricket-news/')) {
            return;
          }
          
          seen.add(fullUrl);

          // Extract title
          let title = '';
          const $heading = $el.find('h1, h2, h3, h4, h5, h6').first();
          if ($heading.length) {
            title = $heading.text().trim();
          } else {
            title = $el.text().trim();
          }

          if (!title || title.length < 15) return;

          // Try to find parent container for more info
          let description = '';
          let imageUrl = null;
          let publishedTime = '';
          let category = '';
          let author = '';

          const $parent = $el.closest('[class*="story"], [class*="article"], [class*="card"], article');
          
          if ($parent.length) {
            // Look for description/summary
            const $desc = $parent.find('[class*="summary"], [class*="desc"], [class*="excerpt"], p').first();
            if ($desc.length) {
              description = $desc.text().trim();
              // Avoid using title as description
              if (description === title) description = '';
            }

            // Look for image
            const $img = $parent.find('img').first();
            if ($img.length) {
              imageUrl = $img.attr('src') || $img.attr('data-src') || $img.attr('data-lazy-src');
            }

            // Look for time/date
            const $time = $parent.find('time, [class*="time"], [class*="date"], [datetime]').first();
            if ($time.length) {
              publishedTime = $time.attr('datetime') || $time.text().trim();
            }

            // Look for category
            const $category = $parent.find('[class*="category"], [class*="tag"], [class*="label"]').first();
            if ($category.length) {
              category = $category.text().trim();
            }

            // Look for author
            const $author = $parent.find('[class*="author"], [class*="byline"]').first();
            if ($author.length) {
              author = $author.text().trim().replace(/^by\s*/i, '');
            }
          }

          const article = {
            id: this.extractSlugFromUrl(fullUrl),
            title: title,
            description: description || null,
            link: fullUrl,
            url: fullUrl,
            imageUrl: this.getHighQualityImageUrl(imageUrl),
            thumbnailUrl: imageUrl,
            publishedTime: this.parseDate(publishedTime) || null,
            publishedAt: publishedTime || null,
            category: category || null,
            author: author || null,
            source: 'ESPN Cricinfo',
            sourceId: `espncricinfo-${this.extractSlugFromUrl(fullUrl)}`,
            scrapedAt: new Date().toISOString(),
          };

          newsArticles.push(article);
        });
      });

      // Also try to extract from JSON-LD structured data if available
      $('script[type="application/ld+json"]').each((_, script) => {
        try {
          const jsonLd = JSON.parse($(script).html());
          
          // Handle array of items
          const items = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
          
          items.forEach(item => {
            if (item['@type'] === 'NewsArticle' || item['@type'] === 'Article') {
              const url = item.url || item.mainEntityOfPage?.['@id'];
              if (!url || seen.has(url)) return;
              
              seen.add(url);
              
              newsArticles.push({
                id: this.extractSlugFromUrl(url),
                title: item.headline || item.name || '',
                description: item.description || null,
                link: url,
                url: url,
                imageUrl: this.getHighQualityImageUrl(item.image?.url || item.image?.[0]?.url),
                thumbnailUrl: item.thumbnailUrl || null,
                publishedTime: item.datePublished || null,
                publishedAt: item.datePublished || null,
                modifiedTime: item.dateModified || null,
                category: item.articleSection || null,
                author: item.author?.name || (Array.isArray(item.author) ? item.author[0]?.name : null) || null,
                source: 'ESPN Cricinfo',
                sourceId: `espncricinfo-${this.extractSlugFromUrl(url)}`,
                keywords: item.keywords || [],
                scrapedAt: new Date().toISOString(),
              });
            }
          });
        } catch (e) {
          // JSON parsing failed, ignore
        }
      });

      // Deduplicate by URL
      const uniqueArticles = [];
      const urlSet = new Set();
      
      newsArticles.forEach(article => {
        if (!urlSet.has(article.url)) {
          urlSet.add(article.url);
          uniqueArticles.push(article);
        }
      });

      console.log(`✅ Successfully fetched ${uniqueArticles.length} news articles`);
      return uniqueArticles;
    } catch (error) {
      console.error('❌ Error fetching news:', error.message);
      throw error;
    }
  }

  /**
   * Fetch detailed information for a specific news article
   * @param {string} articleUrl - The URL of the article
   * @returns {Promise<Object>} Detailed article information
   */
  async fetchArticleDetails(articleUrl) {
    try {
      console.log(`📰 Fetching article details from: ${articleUrl}`);
      
      const html = await this.fetchWithRetry(articleUrl);
      const $ = cheerio.load(html);

      // Extract title
      let title = '';
      const titleSelectors = ['h1', '[class*="headline"]', '[class*="title"]', 'article h1'];
      for (const selector of titleSelectors) {
        const $title = $(selector).first();
        if ($title.length && $title.text().trim().length > 10) {
          title = $title.text().trim();
          break;
        }
      }

      // Extract published time
      let publishedTime = '';
      let modifiedTime = '';
      const $time = $('time, [datetime], [class*="publish-date"], [class*="date-published"]').first();
      if ($time.length) {
        publishedTime = $time.attr('datetime') || $time.text().trim();
      }

      // Try to get from meta tags
      const metaPublished = $('meta[property="article:published_time"]').attr('content');
      const metaModified = $('meta[property="article:modified_time"]').attr('content');
      if (metaPublished) publishedTime = metaPublished;
      if (metaModified) modifiedTime = metaModified;

      // Extract main image
      let mainImage = '';
      const imageSelectors = [
        'meta[property="og:image"]',
        '[class*="hero"] img',
        'article img',
        '[class*="main-image"] img',
        'figure img',
      ];
      
      for (const selector of imageSelectors) {
        if (selector.includes('meta')) {
          const $meta = $(selector);
          if ($meta.length) {
            mainImage = $meta.attr('content');
            break;
          }
        } else {
          const $img = $(selector).first();
          if ($img.length) {
            mainImage = $img.attr('src') || $img.attr('data-src');
            if (mainImage) break;
          }
        }
      }

      // Extract article content
      const contentParagraphs = [];
      const contentSelectors = [
        'article p',
        '[class*="story-body"] p',
        '[class*="article-body"] p',
        '[class*="content"] p',
        'main p',
      ];

      const seenParagraphs = new Set();
      
      contentSelectors.forEach(selector => {
        $(selector).each((_, p) => {
          const text = $(p).text().trim();
          
          // Filter out non-content paragraphs
          if (text && 
              text.length > 30 && 
              !seenParagraphs.has(text) &&
              !text.toLowerCase().includes('follow us') &&
              !text.toLowerCase().includes('subscribe') &&
              !text.toLowerCase().includes('download app') &&
              !text.toLowerCase().includes('cookie') &&
              !text.toLowerCase().includes('privacy policy') &&
              !text.toLowerCase().includes('terms of use') &&
              !text.toLowerCase().includes('advertisement') &&
              !text.includes('©')) {
            seenParagraphs.add(text);
            contentParagraphs.push(text);
          }
        });
      });

      const fullContent = contentParagraphs.join('\n\n');

      // Extract author
      let author = '';
      const authorSelectors = [
        '[class*="author"] a',
        '[class*="byline"]',
        'meta[name="author"]',
        '[rel="author"]',
      ];
      
      for (const selector of authorSelectors) {
        if (selector.includes('meta')) {
          const $meta = $(selector);
          if ($meta.length) {
            author = $meta.attr('content');
            break;
          }
        } else {
          const $author = $(selector).first();
          if ($author.length) {
            author = $author.text().trim().replace(/^by\s*/i, '');
            if (author) break;
          }
        }
      }

      // Extract tags/categories
      const tags = [];
      const tagSelectors = [
        '[class*="tag"] a',
        '[class*="category"]',
        '[class*="label"]',
        'meta[property="article:tag"]',
      ];
      
      tagSelectors.forEach(selector => {
        if (selector.includes('meta')) {
          $('meta[property="article:tag"]').each((_, el) => {
            const tag = $(el).attr('content');
            if (tag && !tags.includes(tag)) {
              tags.push(tag);
            }
          });
        } else {
          $(selector).each((_, el) => {
            const tag = $(el).text().trim();
            if (tag && tag.length < 50 && !tags.includes(tag)) {
              tags.push(tag);
            }
          });
        }
      });

      // Extract related articles
      const relatedArticles = [];
      $('[class*="related"] a[href*="/story/"], aside a[href*="/story/"]').each((_, el) => {
        const $el = $(el);
        const href = $el.attr('href');
        const relTitle = $el.text().trim();
        
        if (href && relTitle && relTitle.length > 10) {
          const fullUrl = href.startsWith('http') ? href : `${this.baseUrl}${href}`;
          relatedArticles.push({
            title: relTitle,
            url: fullUrl,
          });
        }
      });

      // Extract meta description
      const metaDescription = $('meta[property="og:description"], meta[name="description"]').first().attr('content') || '';

      // Extract keywords from JSON-LD
      let keywords = [];
      $('script[type="application/ld+json"]').each((_, script) => {
        try {
          const jsonLd = JSON.parse($(script).html());
          if (jsonLd.keywords) {
            keywords = Array.isArray(jsonLd.keywords) ? jsonLd.keywords : jsonLd.keywords.split(',').map(k => k.trim());
          }
        } catch (e) {
          // Ignore parsing errors
        }
      });

      return {
        title,
        description: metaDescription,
        url: articleUrl,
        publishedTime: this.parseDate(publishedTime),
        modifiedTime: this.parseDate(modifiedTime),
        mainImage: this.getHighQualityImageUrl(mainImage),
        content: fullContent,
        contentParagraphs,
        contentLength: fullContent.length,
        wordCount: fullContent.split(/\s+/).length,
        author,
        tags: [...new Set(tags)],
        keywords: [...new Set(keywords)],
        relatedArticles: relatedArticles.slice(0, 5),
        scrapedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`❌ Error fetching article details: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch latest news with full details for each article
   * @param {number} limit - Number of articles to fetch details for (default: 5)
   * @returns {Promise<Array>} Array of detailed news articles
   */
  async fetchLatestNewsWithDetails(limit = 5) {
    try {
      const latestNews = await this.fetchLatestNews();
      const detailedNews = [];

      if (latestNews.length === 0) {
        console.log('⚠️  No news articles found');
        return [];
      }

      console.log(`\n📚 Fetching detailed information for top ${Math.min(limit, latestNews.length)} articles...\n`);

      for (let i = 0; i < Math.min(limit, latestNews.length); i++) {
        const article = latestNews[i];
        console.log(`${i + 1}/${Math.min(limit, latestNews.length)} - ${article.title}`);

        try {
          const details = await this.fetchArticleDetails(article.link);
          detailedNews.push({
            ...article,
            details,
          });

          // Add a small delay to avoid rate limiting
          await this.delay(1500);
        } catch (error) {
          console.error(`⚠️  Failed to fetch details for: ${article.title}`);
          // Still include the basic article info
          detailedNews.push(article);
        }
      }

      console.log(`\n✅ Successfully fetched ${detailedNews.length} detailed articles`);
      return detailedNews;
    } catch (error) {
      console.error('❌ Error in fetchLatestNewsWithDetails:', error.message);
      throw error;
    }
  }

  /**
   * Fetch cricket news by category
   * @param {string} category - Category to filter (e.g., 'ipl', 'test', 'odi')
   * @returns {Promise<Array>} Array of news articles for the category
   */
  async fetchNewsByCategory(category) {
    try {
      const categoryUrl = `${this.baseUrl}/cricket-news/${category}`;
      console.log(`🏏 Fetching ${category} cricket news from ESPN Cricinfo...`);
      
      // Temporarily change the news URL to the category URL
      const originalNewsUrl = this.newsUrl;
      this.newsUrl = categoryUrl;
      
      const news = await this.fetchLatestNews();
      
      // Restore the original news URL
      this.newsUrl = originalNewsUrl;
      
      return news;
    } catch (error) {
      console.error(`❌ Error fetching ${category} news:`, error.message);
      throw error;
    }
  }

  /**
   * Search for cricket news
   * @param {string} query - Search query
   * @returns {Promise<Array>} Array of search results
   */
  async searchNews(query) {
    try {
      const searchUrl = `${this.baseUrl}/search?q=${encodeURIComponent(query)}&type=story`;
      console.log(`🔍 Searching for: "${query}"...`);
      
      const html = await this.fetchWithRetry(searchUrl);
      const $ = cheerio.load(html);
      
      const searchResults = [];
      
      $('a[href*="/story/"]').each((_, element) => {
        const $el = $(element);
        const href = $el.attr('href');
        const title = $el.text().trim();
        
        if (href && title && title.length > 15) {
          const fullUrl = href.startsWith('http') ? href : `${this.baseUrl}${href}`;
          
          searchResults.push({
            id: this.extractSlugFromUrl(fullUrl),
            title,
            link: fullUrl,
            url: fullUrl,
            source: 'ESPN Cricinfo',
            scrapedAt: new Date().toISOString(),
          });
        }
      });
      
      // Deduplicate
      const unique = [];
      const seen = new Set();
      
      searchResults.forEach(item => {
        if (!seen.has(item.url)) {
          seen.add(item.url);
          unique.push(item);
        }
      });
      
      console.log(`✅ Found ${unique.length} search results for "${query}"`);
      return unique;
    } catch (error) {
      console.error(`❌ Error searching news:`, error.message);
      throw error;
    }
  }

  /**
   * Format news for display
   * @param {Array} newsArticles - Array of news articles
   * @returns {string} Formatted news string
   */
  formatNews(newsArticles) {
    let output = '\n╔═══════════════════════════════════════════════════════════════╗\n';
    output += '║       🏏 LATEST CRICKET NEWS FROM ESPN CRICINFO 🏏           ║\n';
    output += '╚═══════════════════════════════════════════════════════════════╝\n\n';

    newsArticles.forEach((article, index) => {
      output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      output += `${index + 1}. ${article.title}\n`;
      output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

      if (article.description) {
        output += `📝 ${article.description}\n\n`;
      }

      if (article.author) {
        output += `✍️  Author: ${article.author}\n`;
      }

      if (article.category) {
        output += `📂 Category: ${article.category}\n`;
      }

      if (article.publishedTime) {
        output += `🕐 Published: ${article.publishedTime}\n`;
      }

      output += `🔗 Link: ${article.link}\n`;

      if (article.imageUrl) {
        output += `🖼️  Image: ${article.imageUrl}\n`;
      }

      if (article.details) {
        output += `\n📰 FULL ARTICLE CONTENT:\n`;
        output += `${'─'.repeat(60)}\n`;

        if (article.details.wordCount) {
          output += `📊 Word Count: ${article.details.wordCount}\n`;
        }

        if (article.details.contentParagraphs && article.details.contentParagraphs.length > 0) {
          article.details.contentParagraphs.forEach((para) => {
            output += `\n${para}\n`;
          });
        }

        if (article.details.tags && article.details.tags.length > 0) {
          output += `\n🏷️  Tags: ${article.details.tags.join(', ')}\n`;
        }

        if (article.details.keywords && article.details.keywords.length > 0) {
          output += `🔑 Keywords: ${article.details.keywords.join(', ')}\n`;
        }

        if (article.details.relatedArticles && article.details.relatedArticles.length > 0) {
          output += `\n📌 Related Articles:\n`;
          article.details.relatedArticles.forEach((related, idx) => {
            output += `   ${idx + 1}. ${related.title}\n`;
          });
        }
      }

      output += `\n`;
    });

    return output;
  }

  /**
   * Export data to JSON
   * @param {Array} data - Data to export
   * @param {string} filename - Output filename
   */
  async exportToJson(data, filename = 'espncricinfo-news.json') {
    const fs = require('fs').promises;
    await fs.writeFile(filename, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`💾 Data saved to ${filename}`);
  }
}

// Main execution
async function main() {
  const scraper = new ESPNCricinfoScraper();

  try {
    console.log('\n🚀 Starting ESPN Cricinfo News Scraper...\n');

    // Fetch latest news with full details for top 10 articles
    const detailedNews = await scraper.fetchLatestNewsWithDetails(10);

    // Display formatted news
    console.log(scraper.formatNews(detailedNews));

    // Save to JSON file
    await scraper.exportToJson(detailedNews, 'espncricinfo-latest-news.json');

    // Show summary
    console.log('\n📊 SCRAPING SUMMARY:');
    console.log(`   Total articles scraped: ${detailedNews.length}`);
    console.log(`   Articles with full content: ${detailedNews.filter(a => a.details?.content).length}`);
    console.log(`   Average word count: ${Math.round(detailedNews.filter(a => a.details?.wordCount).reduce((sum, a) => sum + (a.details?.wordCount || 0), 0) / detailedNews.length) || 0}`);
    
    return detailedNews;
  } catch (error) {
    console.error('❌ Main execution error:', error);
    process.exit(1);
  }
}

// Export for use as a module
module.exports = ESPNCricinfoScraper;

// Run if executed directly
if (require.main === module) {
  main();
}
