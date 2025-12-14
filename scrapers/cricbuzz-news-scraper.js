const puppeteer = require('puppeteer');
const axios = require('axios');

/**
 * Cricbuzz News Scraper
 * Fetches latest cricket news from Cricbuzz with detailed information
 * Uses a hybrid approach to handle dynamically loaded content
 */
class CricbuzzNewsScraper {
  constructor() {
    this.baseUrl = 'https://www.cricbuzz.com';
    this.newsUrl = 'https://www.cricbuzz.com/cricket-news/latest-news';
    this.browser = null;
  }

  /**
   * Initialize browser
   */
  async initBrowser() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }
    return this.browser;
  }

  /**
   * Close browser
   */
  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Fetch the latest news from Cricbuzz
   * @returns {Promise<Array>} Array of news articles
   */
  async fetchLatestNews() {
    let page;
    try {
      console.log('🏏 Fetching latest cricket news from Cricbuzz...');
      const browser = await this.initBrowser();
      page = await browser.newPage();
      
      // Set user agent and viewport
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.setViewport({ width: 1920, height: 1080 });
      
      // Navigate to the news page
      console.log('📡 Loading page...');
      await page.goto(this.newsUrl, { waitUntil: 'networkidle0', timeout: 60000 });
      
      // Wait for dynamic content to load - scroll down to trigger lazy loading
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Scroll back to top
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Extract news articles using comprehensive selector strategy
      const newsArticles = await page.evaluate((baseUrl) => {
        const articles = [];
        
        // Look for all elements that might contain news articles
        // Try multiple container patterns
        const containerSelectors = [
          '[class*="news"]',
          '[class*="story"]',
          '[class*="article"]',
          'div[class*="cb"]',
        ];
        
        const allContainers = [];
        containerSelectors.forEach(selector => {
          const elements = Array.from(document.querySelectorAll(selector));
          allContainers.push(...elements);
        });
        
        // De-duplicate containers
        const uniqueContainers = [...new Set(allContainers)];
        
        const seen = new Set();
        
        // Search through containers for news patterns
        uniqueContainers.forEach(container => {
          // Look for links that might be news articles
          const links = container.querySelectorAll('a[href*="/cricket-news/"]');
          
          links.forEach(link => {
            const href = link.href;
            
            // Skip non-article URLs
            if (!href || 
                seen.has(href) ||
                href.includes('/latest-news') || 
                href.includes('/editorial/') || 
                href.includes('/info/') ||
                href.endsWith('/cricket-news') ||
                href.endsWith('/cricket-news/') ||
                href.includes('#')) {
              return;
            }
            
            // Only include URLs that look like news articles (have numbers)
            if (!/\d{5,}/.test(href)) {
              return;
            }
            
            const title = link.textContent.trim();
            if (!title || title.length < 15) return;
            
            seen.add(href);
            
            
            // Try to find description and metadata in parent/sibling elements
            let description = '';
            let publishedTime = '';
            let imageUrl = null;
            
            // Search upward through the link's parents (not container) for additional info
            let currentElement = link.parentElement;
            for (let i = 0; i < 5 && currentElement; i++) {
              // Look for description
              const descElements = currentElement.querySelectorAll('[class*="intr"], [class*="desc"], [class*="summary"], p');
              for (const desc of descElements) {
                const text = desc.textContent.trim();
                // Make sure description is unique and not the title
                if (text && 
                    text.length > 30 && 
                    text.length < 500 && 
                    !description &&
                    text !== title) {
                  description = text;
                  break;
                }
              }
              
              // Look for time
              const timeElements = currentElement.querySelectorAll('[class*="time"], [class*="date"], time');
              for (const time of timeElements) {
                const text = time.textContent.trim();
                if (text && !publishedTime) {
                  publishedTime = text;
                  break;
                }
              }
              
              // Look for image
              const images = currentElement.querySelectorAll('img');
              for (const img of images) {
                if (!imageUrl && (img.src || img.dataset?.src)) {
                  imageUrl = img.src || img.dataset.src;
                  break;
                }
              }
              
              currentElement = currentElement.parentElement;
            }

            
            const newsId = href.split('/').pop() || '';
            
            articles.push({
              id: newsId,
              title,
              description,
              link: href,
              imageUrl: imageUrl || null,
              publishedTime,
              source: 'Cricbuzz',
              scrapedAt: new Date().toISOString()
            });
          });
        });
        
        return articles;
      }, this.baseUrl);
      
      await page.close();
      console.log(`✅ Successfully fetched ${newsArticles.length} news articles`);
      return newsArticles;
    } catch (error) {
      if (page) await page.close();
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
    let page;
    try {
      console.log(`📰 Fetching article details from: ${articleUrl}`);
      const browser = await this.initBrowser();
      page = await browser.newPage();
      
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.setViewport({ width: 1920, height: 1080 });
      
      await page.goto(articleUrl, { waitUntil: 'networkidle0', timeout: 60000 });
      
      // Wait for content to load
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extract article details
      const articleDetails = await page.evaluate((baseUrl) => {
        // Find title
        const titleSelectors = [
          'h1',
          '[class*="headline"]',
          '[class*="title"]',
          '[class*="hdln"]'
        ];
        
        let title = '';
        for (const selector of titleSelectors) {
          const element = document.querySelector(selector);
          if (element && element.textContent.trim().length > 10) {
            title = element.textContent.trim();
            break;
          }
        }
        
        // Find time - Cricbuzz uses specific format: "Sun, Dec 14, 2025 • 9:09 AM"
        const timeSelectors = [
          'span.text-gray-500', // Specific Cricbuzz time class
          'span[class*="gray"]', // Backup for gray text
          'time',
          '[class*="time"]',
          '[class*="date"]',
          '[datetime]'
        ];
        
        let publishedTime = '';
        for (const selector of timeSelectors) {
          const elements = document.querySelectorAll(selector);
          for (const element of elements) {
            const text = element.textContent.trim();
            // Look for pattern: "Day, Month Date, Year • Time AM/PM" or date-like patterns
            if (text.match(/\w{3},\s+\w{3}\s+\d{1,2},\s+\d{4}|•|\d{1,2}:\d{2}\s*(AM|PM)/i)) {
              publishedTime = text;
              break;
            }
          }
          if (publishedTime) break;
        }

        
        // Find main image
        const imageSelectors = [
          'img[class*="main"]',
          'img[class*="hero"]',
          'article img',
          'img[class*="large"]',
          '.content img'
        ];
        
        let mainImage = null;
        for (const selector of imageSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            mainImage = element.src || element.dataset?.src;
            if (mainImage) break;
          }
        }
        
        // Extract article content - look for paragraphs
        const contentParagraphs = [];
        const paragraphContainers = [
          'article p',
          '[class*="story"] p',
          '[class*="content"] p',
          '[class*="para"] p',
          'main p'
        ];
        
        const allParagraphs = new Set();
        paragraphContainers.forEach(selector => {
          const paras = document.querySelectorAll(selector);
          paras.forEach(p => allParagraphs.add(p));
        });
        
        // If no structured paragraphs found, get all p tags
        if (allParagraphs.size === 0) {
          const allPs = document.querySelectorAll('p');
          allPs.forEach(p => allParagraphs.add(p));
        }
        
        allParagraphs.forEach(p => {
          const text = p.textContent.trim();
          // Filter out navigation, footer, and other non-content paragraphs
          if (text && 
              text.length > 50 && 
              !text.toLowerCase().includes('follow us') &&
              !text.toLowerCase().includes('download app') &&
              !text.toLowerCase().includes('subscribe') &&
              !text.toLowerCase().startsWith('more ') &&
              !text.includes('©')) {
            contentParagraphs.push(text);
          }
        });
        
        const fullContent = contentParagraphs.join('\n\n');
        
        // Extract tags
        const tags = [];
        const tagSelectors = [
          '[class*="tag"] a',
          '[class*="category"] a',
          'a[rel="tag"]'
        ];
        
        tagSelectors.forEach(selector => {
          const tagElements = document.querySelectorAll(selector);
          tagElements.forEach(tag => {
            const tagText = tag.textContent.trim();
            if (tagText && tagText.length < 30) {
              tags.push(tagText);
            }
          });
        });
        
        // Extract related articles
        const relatedArticles = [];
        const relatedSelectors = [
          '[class*="related"] a[href*="/cricket-news/"]',
          '[class*="more"] a[href*="/cricket-news/"]',
          'aside a[href*="/cricket-news/"]'
        ];
        
        const relatedLinks = new Set();
        relatedSelectors.forEach(selector => {
          const links = document.querySelectorAll(selector);
          links.forEach(link => {
            if (link.href && /\d{5,}/.test(link.href)) {
              relatedLinks.add(JSON.stringify({
                title: link.textContent.trim(),
                link: link.href
              }));
            }
          });
        });
        
        relatedLinks.forEach(linkJson => {
          const linkObj = JSON.parse(linkJson);
          if (linkObj.title && linkObj.title.length > 10) {
            relatedArticles.push(linkObj);
          }
        });
        
        return {
          title,
          publishedTime,
          mainImage,
          content: fullContent,
          contentParagraphs,
          tags: [...new Set(tags)],
          relatedArticles: relatedArticles.slice(0, 5),
          scrapedAt: new Date().toISOString()
        };
      }, this.baseUrl);
      
      await page.close();
      return {
        ...articleDetails,
        url: articleUrl
      };
    } catch (error) {
      if (page) await page.close();
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
            details
          });
          
          // Add a small delay to avoid rate limiting
          await this.delay(1000);
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
   * Helper function to add delay
   * @param {number} ms - Milliseconds to delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Format news for display
   * @param {Array} newsArticles - Array of news articles
   * @returns {string} Formatted news string
   */
  formatNews(newsArticles) {
    let output = '\n╔═══════════════════════════════════════════════════════════════╗\n';
    output += '║           🏏 LATEST CRICKET NEWS FROM CRICBUZZ 🏏            ║\n';
    output += '╚═══════════════════════════════════════════════════════════════╝\n\n';
    
    newsArticles.forEach((article, index) => {
      output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      output += `${index + 1}. ${article.title}\n`;
      output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      
      if (article.description) {
        output += `📝 ${article.description}\n\n`;
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
        
        if (article.details.contentParagraphs && article.details.contentParagraphs.length > 0) {
          article.details.contentParagraphs.forEach((para, idx) => {
            output += `\n${para}\n`;
          });
        }
        
        if (article.details.tags && article.details.tags.length > 0) {
          output += `\n🏷️  Tags: ${article.details.tags.join(', ')}\n`;
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
}

// Main execution
async function main() {
  const scraper = new CricbuzzNewsScraper();
  
  try {
    // Fetch latest news with full details for top 10 articles
    const detailedNews = await scraper.fetchLatestNewsWithDetails(10);
    
    // Display formatted news
    console.log(scraper.formatNews(detailedNews));
    
    // Optionally, save to JSON file
    const fs = require('fs').promises;
    await fs.writeFile(
      'cricbuzz-latest-news.json',
      JSON.stringify(detailedNews, null, 2),
      'utf-8'
    );
    console.log('\n💾 News data saved to cricbuzz-latest-news.json');
    
    // Close browser
    await scraper.closeBrowser();
    
    return detailedNews;
  } catch (error) {
    console.error('❌ Main execution error:', error);
    await scraper.closeBrowser();
    process.exit(1);
  }
}

// Export for use as a module
module.exports = CricbuzzNewsScraper;

// Run if executed directly
if (require.main === module) {
  main();
}
