// Use puppeteer-core for serverless compatibility
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");
const axios = require("axios");

// ===== CONFIGURATION =====
const CONFIG = {
  // Timeout settings (in milliseconds)
  PAGE_LOAD_TIMEOUT: 45000, // 45s for initial page load (increased from 30s)
  CONTENT_WAIT_TIMEOUT: 5000, // 5s for content to render after scroll
  SCROLL_DELAY: 1500, // 1.5s delay after each scroll iteration

  // Retry settings
  MAX_RETRIES: 3, // Number of retry attempts
  RETRY_DELAY: 3000, // 3s delay between retries
  RETRY_TIMEOUT_MULTIPLIER: 1.5, // Increase timeout by 50% on each retry

  // Scraping settings
  MAX_ARTICLES: 20, // Max articles to process
  ARTICLE_DELAY: 1000, // Delay between article detail fetches
  SCROLL_ITERATIONS: 3, // Number of scroll iterations to trigger infinite scroll

  // Logging
  VERBOSE_LOGGING: true, // Enable step-by-step logging
};

/**
 * Cricbuzz News Scraper
 * Fetches latest cricket news from Cricbuzz with detailed information
 * Uses puppeteer-core with @sparticuz/chromium for serverless compatibility
 *
 * Enhanced with:
 * - Configurable timeouts
 * - Retry logic with exponential backoff
 * - Step-by-step logging for debugging
 */
class CricbuzzNewsScraper {
  constructor(options = {}) {
    this.baseUrl = "https://www.cricbuzz.com";
    this.newsUrl = "https://www.cricbuzz.com/cricket-news/latest-news";
    this.browser = null;

    // Allow overriding config via constructor
    this.config = { ...CONFIG, ...options };
  }

  /**
   * Log message if verbose logging is enabled
   */
  log(message, level = "info") {
    if (this.config.VERBOSE_LOGGING || level === "error") {
      const timestamp = new Date().toISOString().split("T")[1].slice(0, 8);
      const prefix = level === "error" ? "❌" : level === "warn" ? "⚠️" : "📍";
      console.log(`[${timestamp}] ${prefix} ${message}`);
    }
  }

  /**
   * Helper: Convert low-quality image URL to high-quality
   * Cricbuzz uses URL parameters: ?d=low&p=det
   * We remove parameters or change to ?d=high for better quality
   */
  getHighQualityImageUrl(imageUrl) {
    if (!imageUrl) return null;

    try {
      // Remove quality parameters to get original/best quality
      // Or replace d=low with d=high
      return imageUrl.split("?")[0]; // Gets base URL without parameters
    } catch (e) {
      return imageUrl; // Return original if parsing fails
    }
  }

  /**
   * Initialize browser with serverless support
   */
  async initBrowser() {
    if (!this.browser) {
      // Detect if running in serverless environment (Vercel/AWS Lambda)
      const isServerless =
        !!process.env.AWS_LAMBDA_FUNCTION_NAME || !!process.env.VERCEL;

      // Detect ARM64 architecture (Puppeteer bundled Chrome doesn't support ARM64)
      const os = require("os");
      const isArm64 = os.arch() === "arm64";

      const options = {
        headless: "new",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--single-process",
          "--no-zygote",
        ],
      };

      if (isServerless) {
        // Serverless: Use @sparticuz/chromium
        console.log(
          "🌐 Running in serverless environment, using @sparticuz/chromium"
        );
        options.executablePath = await chromium.executablePath();
        options.args = [...options.args, ...chromium.args];
      } else if (isArm64) {
        // ARM64: Use system Chromium (Puppeteer bundled Chrome is x86_64 only)
        console.log("💻 Running on ARM64, using system Chromium");
        options.executablePath = "/snap/bin/chromium";
      } else {
        // x86_64 Local: Try to find local Chromium from puppeteer package
        console.log("💻 Running locally, using bundled Chromium");
        try {
          const puppeteerLocal = require("puppeteer");
          options.executablePath = puppeteerLocal.executablePath();
        } catch (e) {
          console.log(
            "⚠️  Puppeteer not found, will use system Chrome/Chromium"
          );
          // Let puppeteer-core try to find Chrome/Chromium automatically
        }
      }

      this.browser = await puppeteer.launch(options);
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
   * Fetch the latest news from Cricbuzz with retry logic
   * @param {number} retryCount - Current retry attempt (internal use)
   * @returns {Promise<Array>} Array of news articles
   */
  async fetchLatestNews(retryCount = 0) {
    let page;
    const startTime = Date.now();

    // Calculate timeout with exponential backoff on retries
    const currentTimeout = Math.round(
      this.config.PAGE_LOAD_TIMEOUT *
        Math.pow(this.config.RETRY_TIMEOUT_MULTIPLIER, retryCount)
    );

    try {
      console.log("🏏 Fetching latest cricket news from Cricbuzz...");
      if (retryCount > 0) {
        console.log(
          `🔄 Retry attempt ${retryCount}/${
            this.config.MAX_RETRIES
          } (timeout: ${currentTimeout / 1000}s)`
        );
      }

      // Step 1: Initialize browser
      this.log("Step 1/6: Initializing browser...");
      const browser = await this.initBrowser();
      this.log("Step 1/6: Browser initialized ✓");

      // Step 2: Create new page
      this.log("Step 2/6: Creating new page...");
      page = await browser.newPage();

      // Set up page error handlers
      page.on("error", (err) =>
        this.log(`Page error: ${err.message}`, "error")
      );
      page.on("pageerror", (err) =>
        this.log(`Page JS error: ${err.message}`, "warn")
      );

      // Set user agent and viewport
      await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );
      await page.setViewport({ width: 1920, height: 1080 });
      this.log("Step 2/6: Page created with user agent ✓");

      // Step 3: Navigate to news page
      this.log(
        `Step 3/6: Navigating to ${this.newsUrl} (timeout: ${
          currentTimeout / 1000
        }s)...`
      );
      const navStartTime = Date.now();

      await page.goto(this.newsUrl, {
        waitUntil: "domcontentloaded",
        timeout: currentTimeout,
      });

      const navDuration = Date.now() - navStartTime;
      this.log(`Step 3/6: Page loaded in ${navDuration}ms ✓`);

      // Step 4: Multiple scrolls to trigger infinite scroll/lazy loading
      // Cricbuzz uses Next.js with lazy loading - need multiple scrolls to load all articles
      const scrollIterations = this.config.SCROLL_ITERATIONS || 3;
      this.log(
        `Step 4/6: Triggering lazy load (${scrollIterations} scrolls)...`
      );

      let finalArticleCount = 0;
      for (let i = 0; i < scrollIterations; i++) {
        await page.evaluate(() => {
          window.scrollBy(0, window.innerHeight * 2);
        });
        await this.delay(this.config.SCROLL_DELAY);

        // Get article count after scroll
        finalArticleCount = await page.evaluate(() => {
          const seen = new Set();
          return Array.from(
            document.querySelectorAll('a[href*="/cricket-news/"]')
          ).filter((a) => {
            if (!/\/\d{5,}\//.test(a.href)) return false;
            if (seen.has(a.href)) return false;
            seen.add(a.href);
            return true;
          }).length;
        });
      }
      this.log(
        `Step 4/6: Infinite scroll complete - ${finalArticleCount} articles loaded ✓`
      );

      // Step 5: Scroll back to top
      this.log("Step 5/6: Scrolling back to top...");
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      await this.delay(1000);
      this.log("Step 5/6: Back to top ✓");

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
        containerSelectors.forEach((selector) => {
          const elements = Array.from(document.querySelectorAll(selector));
          allContainers.push(...elements);
        });

        // De-duplicate containers
        const uniqueContainers = [...new Set(allContainers)];

        const seen = new Set();

        // Search through containers for news patterns
        uniqueContainers.forEach((container) => {
          // Look for links that might be news articles
          const links = container.querySelectorAll('a[href*="/cricket-news/"]');

          links.forEach((link) => {
            const href = link.href;

            // Skip non-article URLs
            if (
              !href ||
              seen.has(href) ||
              href.includes("/latest-news") ||
              href.includes("/editorial/") ||
              href.includes("/info/") ||
              href.endsWith("/cricket-news") ||
              href.endsWith("/cricket-news/") ||
              href.includes("#")
            ) {
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
            let description = "";
            let publishedTime = "";
            let imageUrl = null;

            // Search upward through the link's parents (not container) for additional info
            let currentElement = link.parentElement;
            for (let i = 0; i < 5 && currentElement; i++) {
              // Look for description
              const descElements = currentElement.querySelectorAll(
                '[class*="intr"], [class*="desc"], [class*="summary"], p'
              );
              for (const desc of descElements) {
                const text = desc.textContent.trim();
                // Make sure description is unique and not the title
                if (
                  text &&
                  text.length > 30 &&
                  text.length < 500 &&
                  !description &&
                  text !== title
                ) {
                  description = text;
                  break;
                }
              }

              // Look for time
              const timeElements = currentElement.querySelectorAll(
                '[class*="time"], [class*="date"], time'
              );
              for (const time of timeElements) {
                const text = time.textContent.trim();
                if (text && !publishedTime) {
                  publishedTime = text;
                  break;
                }
              }

              // Look for image
              const images = currentElement.querySelectorAll("img");
              for (const img of images) {
                if (!imageUrl && (img.src || img.dataset?.src)) {
                  imageUrl = img.src || img.dataset.src;
                  break;
                }
              }

              currentElement = currentElement.parentElement;
            }

            const article = {
              id: link.href.split("/").pop(),
              title,
              description,
              link: link.href,
              imageUrl: imageUrl || null,
              thumbnailUrl: imageUrl || null, // Will be converted to high-quality after extraction
              publishedTime,
              source: "Cricbuzz",
              scrapedAt: new Date().toISOString(),
            };
            articles.push(article);
          });
        });

        return articles;
      }, this.baseUrl);

      // Step 6: Extract articles
      this.log("Step 6/6: Extracting article data from page...");

      // Convert thumbnailUrls to high-quality versions (remove quality parameters)
      newsArticles.forEach((article) => {
        article.thumbnailUrl = this.getHighQualityImageUrl(article.imageUrl);
      });

      const totalDuration = Date.now() - startTime;
      await page.close();
      console.log(
        `✅ Successfully fetched ${newsArticles.length} news articles in ${totalDuration}ms`
      );
      this.log(
        `Step 6/6: Extraction complete ✓ (${newsArticles.length} articles)`
      );
      return newsArticles;
    } catch (error) {
      const totalDuration = Date.now() - startTime;

      // Clean up page on error
      if (page) {
        try {
          await page.close();
        } catch (closeError) {
          this.log(`Failed to close page: ${closeError.message}`, "warn");
        }
      }

      // Determine if this is a retryable error
      const isRetryable =
        error.name === "TimeoutError" ||
        error.message.includes("timeout") ||
        error.message.includes("Navigation") ||
        error.message.includes("Protocol error") ||
        error.message.includes("Target closed") ||
        error.message.includes("net::");

      console.error(
        `❌ Error fetching news (attempt ${retryCount + 1}): ${error.message}`
      );
      this.log(
        `Error type: ${error.name}, retryable: ${isRetryable}, duration: ${totalDuration}ms`,
        "error"
      );

      // Retry logic
      if (isRetryable && retryCount < this.config.MAX_RETRIES) {
        const retryDelay = this.config.RETRY_DELAY * Math.pow(1.5, retryCount);
        console.log(`⏳ Waiting ${retryDelay / 1000}s before retry...`);
        await this.delay(retryDelay);

        // Close and reinitialize browser for fresh connection
        try {
          await this.closeBrowser();
        } catch (e) {
          this.log(`Failed to close browser for retry: ${e.message}`, "warn");
        }

        return this.fetchLatestNews(retryCount + 1);
      }

      // All retries exhausted or non-retryable error
      console.error(
        `❌ Failed after ${retryCount + 1} attempt(s): ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Fetch detailed information for a specific news article
   * @param {string} articleUrl - The URL of the article
   * @param {number} retryCount - Current retry attempt (internal use)
   * @returns {Promise<Object>} Detailed article information
   */
  async fetchArticleDetails(articleUrl, retryCount = 0) {
    let page;
    const startTime = Date.now();
    const maxRetries = 2; // Fewer retries for individual articles

    try {
      this.log(`Fetching article: ${articleUrl.split("/").pop()}`);
      const browser = await this.initBrowser();
      page = await browser.newPage();

      await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );
      await page.setViewport({ width: 1920, height: 1080 });

      // Calculate timeout with backoff
      const currentTimeout = Math.round(
        this.config.PAGE_LOAD_TIMEOUT *
          Math.pow(this.config.RETRY_TIMEOUT_MULTIPLIER, retryCount)
      );

      await page.goto(articleUrl, {
        waitUntil: "domcontentloaded",
        timeout: currentTimeout,
      });

      // Wait for content to load
      await this.delay(this.config.SCROLL_DELAY);

      // Extract article details
      const articleDetails = await page.evaluate((baseUrl) => {
        // Find title
        const titleSelectors = [
          "h1",
          '[class*="headline"]',
          '[class*="title"]',
          '[class*="hdln"]',
        ];

        let title = "";
        for (const selector of titleSelectors) {
          const element = document.querySelector(selector);
          if (element && element.textContent.trim().length > 10) {
            title = element.textContent.trim();
            break;
          }
        }

        // Find time - Cricbuzz uses specific format: "Sun, Dec 14, 2025 • 9:09 AM"
        const timeSelectors = [
          "span.text-gray-500", // Specific Cricbuzz time class
          'span[class*="gray"]', // Backup for gray text
          "time",
          '[class*="time"]',
          '[class*="date"]',
          "[datetime]",
        ];

        let publishedTime = "";
        for (const selector of timeSelectors) {
          const elements = document.querySelectorAll(selector);
          for (const element of elements) {
            const text = element.textContent.trim();
            // Look for pattern: "Day, Month Date, Year • Time AM/PM" or date-like patterns
            if (
              text.match(
                /\w{3},\s+\w{3}\s+\d{1,2},\s+\d{4}|•|\d{1,2}:\d{2}\s*(AM|PM)/i
              )
            ) {
              publishedTime = text;
              break;
            }
          }
          if (publishedTime) break;
        }

        // Find main image - prioritize meta tags (more reliable)
        const ogImage = document.querySelector(
          'meta[property="og:image"]'
        )?.content;
        const twitterImage = document.querySelector(
          'meta[name="twitter:image"]'
        )?.content;

        let mainImage = ogImage || twitterImage || null;

        // Fallback to DOM selectors if meta tags not found
        if (!mainImage) {
          const imageSelectors = [
            'img[class*="main"]',
            'img[class*="hero"]',
            "article img",
            'img[class*="large"]',
            ".content img",
          ];

          for (const selector of imageSelectors) {
            const element = document.querySelector(selector);
            if (element) {
              mainImage = element.src || element.dataset?.src;
              if (mainImage) break;
            }
          }
        }

        // Extract article content - look for paragraphs
        const contentParagraphs = [];
        const paragraphContainers = [
          "article p",
          '[class*="story"] p',
          '[class*="content"] p',
          '[class*="para"] p',
          "main p",
        ];

        const allParagraphs = new Set();
        paragraphContainers.forEach((selector) => {
          const paras = document.querySelectorAll(selector);
          paras.forEach((p) => allParagraphs.add(p));
        });

        // If no structured paragraphs found, get all p tags
        if (allParagraphs.size === 0) {
          const allPs = document.querySelectorAll("p");
          allPs.forEach((p) => allParagraphs.add(p));
        }

        allParagraphs.forEach((p) => {
          const text = p.textContent.trim();
          // Filter out navigation, footer, cookie consent, and other non-content paragraphs
          if (
            text &&
            text.length > 50 &&
            !text.toLowerCase().includes("follow us") &&
            !text.toLowerCase().includes("download app") &&
            !text.toLowerCase().includes("subscribe") &&
            !text.toLowerCase().startsWith("more ") &&
            !text.includes("©") &&
            // Filter out cookie consent and privacy notice text
            !text
              .toLowerCase()
              .includes("we won't sell or share your personal information") &&
            !text
              .toLowerCase()
              .includes("personal information to inform the ads") &&
            !text
              .toLowerCase()
              .includes("you may still see interest-based ads") &&
            !text.toLowerCase().includes("cookie") &&
            !text.toLowerCase().includes("privacy policy") &&
            !text.toLowerCase().includes("gdpr") &&
            !text.toLowerCase().includes("consent")
          ) {
            contentParagraphs.push(text);
          }
        });

        const fullContent = contentParagraphs.join("\n\n");

        // Extract tags
        const tags = [];
        const tagSelectors = [
          '[class*="tag"] a',
          '[class*="category"] a',
          'a[rel="tag"]',
        ];

        tagSelectors.forEach((selector) => {
          const tagElements = document.querySelectorAll(selector);
          tagElements.forEach((tag) => {
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
          'aside a[href*="/cricket-news/"]',
        ];

        const relatedLinks = new Set();
        relatedSelectors.forEach((selector) => {
          const links = document.querySelectorAll(selector);
          links.forEach((link) => {
            if (link.href && /\d{5,}/.test(link.href)) {
              relatedLinks.add(
                JSON.stringify({
                  title: link.textContent.trim(),
                  link: link.href,
                })
              );
            }
          });
        });

        relatedLinks.forEach((linkJson) => {
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
          scrapedAt: new Date().toISOString(),
        };
      }, this.baseUrl);

      const duration = Date.now() - startTime;
      await page.close();

      const wordCount = articleDetails.content
        ? articleDetails.content.split(/\s+/).length
        : 0;
      console.log(
        `   ✓ ${wordCount} words, published: ${
          articleDetails.publishedTime || "unknown"
        }`
      );

      return {
        ...articleDetails,
        url: articleUrl,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      if (page) {
        try {
          await page.close();
        } catch (e) {
          // Ignore close errors
        }
      }

      // Determine if retryable
      const isRetryable =
        error.name === "TimeoutError" ||
        error.message.includes("timeout") ||
        error.message.includes("Navigation") ||
        error.message.includes("net::");

      if (isRetryable && retryCount < maxRetries) {
        const retryDelay = this.config.RETRY_DELAY * Math.pow(1.5, retryCount);
        this.log(
          `Article fetch failed (${error.message}), retrying in ${
            retryDelay / 1000
          }s...`,
          "warn"
        );
        await this.delay(retryDelay);
        return this.fetchArticleDetails(articleUrl, retryCount + 1);
      }

      console.error(`   ❌ Error (${duration}ms): ${error.message}`);
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
        console.log("⚠️  No news articles found");
        return [];
      }

      console.log(
        `\n📚 Fetching detailed information for top ${Math.min(
          limit,
          latestNews.length
        )} articles...\n`
      );

      for (let i = 0; i < Math.min(limit, latestNews.length); i++) {
        const article = latestNews[i];
        console.log(
          `${i + 1}/${Math.min(limit, latestNews.length)} - ${article.title}`
        );

        try {
          const details = await this.fetchArticleDetails(article.link);
          detailedNews.push({
            ...article,
            details,
          });

          // Add a small delay to avoid rate limiting
          await this.delay(1000);
        } catch (error) {
          console.error(`⚠️  Failed to fetch details for: ${article.title}`);
          // Still include the basic article info
          detailedNews.push(article);
        }
      }

      console.log(
        `\n✅ Successfully fetched ${detailedNews.length} detailed articles`
      );
      return detailedNews;
    } catch (error) {
      console.error("❌ Error in fetchLatestNewsWithDetails:", error.message);
      throw error;
    }
  }

  /**
   * Helper function to add delay
   * @param {number} ms - Milliseconds to delay
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Format news for display
   * @param {Array} newsArticles - Array of news articles
   * @returns {string} Formatted news string
   */
  formatNews(newsArticles) {
    let output =
      "\n╔═══════════════════════════════════════════════════════════════╗\n";
    output +=
      "║           🏏 LATEST CRICKET NEWS FROM CRICBUZZ 🏏            ║\n";
    output +=
      "╚═══════════════════════════════════════════════════════════════╝\n\n";

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
        output += `${"─".repeat(60)}\n`;

        if (
          article.details.contentParagraphs &&
          article.details.contentParagraphs.length > 0
        ) {
          article.details.contentParagraphs.forEach((para, idx) => {
            output += `\n${para}\n`;
          });
        }

        if (article.details.tags && article.details.tags.length > 0) {
          output += `\n🏷️  Tags: ${article.details.tags.join(", ")}\n`;
        }

        if (
          article.details.relatedArticles &&
          article.details.relatedArticles.length > 0
        ) {
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
    const fs = require("fs").promises;
    await fs.writeFile(
      "cricbuzz-latest-news.json",
      JSON.stringify(detailedNews, null, 2),
      "utf-8"
    );
    console.log("\n💾 News data saved to cricbuzz-latest-news.json");

    // Close browser
    await scraper.closeBrowser();

    return detailedNews;
  } catch (error) {
    console.error("❌ Main execution error:", error);
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
