/**
 * ICC Cricket News Scraper - Test Script
 *
 * This test script scrapes news from https://www.icc-cricket.com/news
 * Uses Puppeteer to handle dynamic content loading
 *
 * Run: node scrapers/test-icc-news-scraper.js
 */

const puppeteer = require("puppeteer-core");

// ===== CONFIGURATION =====
const CONFIG = {
  // URLs
  BASE_URL: "https://www.icc-cricket.com",
  NEWS_URL: "https://www.icc-cricket.com/news",

  // Timeout settings (in milliseconds)
  PAGE_LOAD_TIMEOUT: 60000, // 60s for initial page load
  CONTENT_WAIT_TIMEOUT: 5000, // 5s for content to render
  SCROLL_DELAY: 2000, // 2s delay after each scroll

  // Retry settings
  MAX_RETRIES: 3,
  RETRY_DELAY: 3000,

  // Scraping settings
  MAX_ARTICLES: 20,
  SCROLL_ITERATIONS: 3,

  // Logging
  VERBOSE_LOGGING: true,
};

/**
 * ICC Cricket News Scraper
 */
class ICCNewsScraper {
  constructor(options = {}) {
    this.config = { ...CONFIG, ...options };
    this.browser = null;
  }

  /**
   * Log message with timestamp
   */
  log(message, level = "info") {
    if (this.config.VERBOSE_LOGGING || level === "error") {
      const timestamp = new Date().toISOString().split("T")[1].slice(0, 8);
      const prefix = level === "error" ? "❌" : level === "warn" ? "⚠️" : "📍";
      console.log(`[${timestamp}] ${prefix} ${message}`);
    }
  }

  /**
   * Helper function to add delay
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Initialize browser
   */
  async initBrowser() {
    if (!this.browser) {
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

      if (isArm64) {
        this.log("Running on ARM64, using system Chromium");
        options.executablePath = "/snap/bin/chromium";
      } else {
        this.log("Running locally, finding Chromium...");
        try {
          const puppeteerLocal = require("puppeteer");
          options.executablePath = puppeteerLocal.executablePath();
        } catch (e) {
          this.log(
            "Puppeteer not found, trying system Chrome/Chromium",
            "warn"
          );
          options.executablePath = "/snap/bin/chromium";
        }
      }

      this.browser = await puppeteer.launch(options);
      this.log("Browser initialized ✓");
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
      this.log("Browser closed ✓");
    }
  }

  /**
   * Fetch the news list from ICC Cricket
   */
  async fetchNewsList(retryCount = 0) {
    let page;
    const startTime = Date.now();

    try {
      console.log("\n🏏 Fetching ICC Cricket News...\n");

      if (retryCount > 0) {
        console.log(
          `🔄 Retry attempt ${retryCount}/${this.config.MAX_RETRIES}`
        );
      }

      // Initialize browser
      this.log("Step 1/5: Initializing browser...");
      const browser = await this.initBrowser();

      // Create new page
      this.log("Step 2/5: Creating new page...");
      page = await browser.newPage();

      // Set user agent and viewport
      await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );
      await page.setViewport({ width: 1920, height: 1080 });

      // Set up error handlers
      page.on("error", (err) =>
        this.log(`Page error: ${err.message}`, "error")
      );
      page.on("pageerror", (err) =>
        this.log(`Page JS error: ${err.message}`, "warn")
      );

      // Navigate to news page
      this.log(`Step 3/5: Navigating to ${this.config.NEWS_URL}...`);
      await page.goto(this.config.NEWS_URL, {
        waitUntil: "networkidle2",
        timeout: this.config.PAGE_LOAD_TIMEOUT,
      });

      // Wait for content to load
      this.log("Step 4/5: Waiting for content to load...");
      await this.delay(this.config.CONTENT_WAIT_TIMEOUT);

      // Scroll to load more content
      this.log(
        `Step 4/5: Scrolling to load more content (${this.config.SCROLL_ITERATIONS} iterations)...`
      );
      for (let i = 0; i < this.config.SCROLL_ITERATIONS; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await this.delay(this.config.SCROLL_DELAY);
      }

      // Scroll back to top
      await page.evaluate(() => window.scrollTo(0, 0));
      await this.delay(1000);

      // Extract news articles
      this.log("Step 5/5: Extracting news articles...");
      const newsArticles = await page.evaluate((baseUrl) => {
        const articles = [];
        const seen = new Set();

        // Find all news article links
        // ICC website structure: links with /news/ in the URL
        const newsLinks = document.querySelectorAll('a[href*="/news/"]');

        newsLinks.forEach((link) => {
          const href = link.href;

          // Skip if already seen or invalid
          if (!href || seen.has(href)) return;

          // Skip navigation/category links (only keep article links)
          // Article URLs typically have a slug after /news/
          const urlPath = new URL(href).pathname;

          // Skip category pages like /news/category/cricket-world-cup
          if (urlPath.includes("/category/")) {
            return;
          }

          // Skip base news paths
          if (urlPath === "/news" || urlPath === "/news/") {
            return;
          }

          // Skip tournament-specific news base paths
          if (urlPath.includes("/tournaments/") && urlPath.endsWith("/news")) {
            return;
          }

          // Extract the article slug (should be directly after /news/)
          const slugMatch = urlPath.match(/\/news\/([a-z0-9-]+)$/i);
          if (!slugMatch) {
            return;
          }

          const slug = slugMatch[1];

          // Skip very short slugs (likely navigation)
          if (slug.length < 10) {
            return;
          }

          seen.add(href);

          // Try to find the article container (parent elements)
          let container = link.parentElement;
          let title = "";
          let description = "";
          let imageUrl = null;
          let category = "";
          let publishedTime = "";

          // Look for title in the link or nearby elements
          // ICC combines category name with title in link text
          let titleFromLink = link.textContent.trim();

          if (titleFromLink && titleFromLink.length > 15) {
            // Remove time indicator (e.g., "5h", "20h", "1d")
            const timePattern =
              /(\d+[hd]|[\d]+\s*(hour|day|min|sec)s?\s*(ago)?)\s*$/i;
            titleFromLink = titleFromLink.replace(timePattern, "").trim();

            // Remove common category prefixes
            const categoryPrefixes = [
              "ICC World Test Championship",
              "ICC Men's T20 World Cup, 2026",
              "ICC Men's T20 World Cup",
              "ICC Women's T20 World Cup, 2026",
              "ICC Women's T20 World Cup",
              "ICC Under-19 Cricket World Cup, 2026",
              "ICC Under-19 Cricket World Cup",
              "ICC Women's Emerging Nations Trophy, 2025",
              "ICC Women's Emerging Nations Trophy",
              "News",
            ];

            for (const prefix of categoryPrefixes) {
              if (
                titleFromLink.startsWith(prefix) &&
                titleFromLink.length > prefix.length + 10
              ) {
                category = prefix;
                titleFromLink = titleFromLink.substring(prefix.length).trim();
                break;
              }
            }

            title = titleFromLink;
          }

          // Search parent elements for more info
          for (let i = 0; i < 6 && container; i++) {
            // Look for title if not found yet
            if (!title) {
              const h2 = container.querySelector("h2, h3, h4");
              if (h2) {
                title = h2.textContent.trim();
              }
            }

            // Look for description
            if (!description) {
              const descElements = container.querySelectorAll(
                "p, [class*='desc'], [class*='summary']"
              );
              for (const desc of descElements) {
                const text = desc.textContent.trim();
                if (text && text.length > 50 && text !== title) {
                  description = text;
                  break;
                }
              }
            }

            // Look for image
            if (!imageUrl) {
              const img = container.querySelector("img");
              if (img) {
                imageUrl =
                  img.src || img.dataset?.src || img.getAttribute("data-src");
              }
            }

            // Look for category/tag
            if (!category) {
              const categoryEl = container.querySelector(
                "[class*='category'], [class*='tag'], [class*='label']"
              );
              if (categoryEl) {
                category = categoryEl.textContent.trim();
              }
            }

            // Look for time
            if (!publishedTime) {
              const timeEl = container.querySelector(
                "time, [class*='time'], [class*='date']"
              );
              if (timeEl) {
                publishedTime =
                  timeEl.textContent.trim() ||
                  timeEl.getAttribute("datetime") ||
                  "";
              }
            }

            container = container.parentElement;
          }

          // Only add if we have a valid title
          if (title && title.length > 15) {
            articles.push({
              id: slugMatch[1],
              title,
              description: description.slice(0, 300),
              link: href,
              imageUrl,
              category,
              publishedTime,
              source: "ICC Cricket",
              scrapedAt: new Date().toISOString(),
            });
          }
        });

        return articles;
      }, this.config.BASE_URL);

      const duration = Date.now() - startTime;
      await page.close();

      console.log(
        `\n✅ Successfully fetched ${newsArticles.length} news articles in ${duration}ms\n`
      );
      return newsArticles;
    } catch (error) {
      const duration = Date.now() - startTime;

      if (page) {
        try {
          await page.close();
        } catch (e) {}
      }

      const isRetryable =
        error.name === "TimeoutError" ||
        error.message.includes("timeout") ||
        error.message.includes("Navigation") ||
        error.message.includes("net::");

      console.error(
        `\n❌ Error fetching news (attempt ${retryCount + 1}): ${error.message}`
      );

      if (isRetryable && retryCount < this.config.MAX_RETRIES) {
        const retryDelay = this.config.RETRY_DELAY * Math.pow(1.5, retryCount);
        console.log(`⏳ Waiting ${retryDelay / 1000}s before retry...`);
        await this.delay(retryDelay);

        try {
          await this.closeBrowser();
        } catch (e) {}
        return this.fetchNewsList(retryCount + 1);
      }

      throw error;
    }
  }

  /**
   * Fetch full article content by URL
   */
  async fetchArticleContent(articleUrl, retryCount = 0) {
    let page;
    const startTime = Date.now();
    const maxRetries = 2;

    try {
      this.log(`Fetching article: ${articleUrl.split("/").pop()}`);
      const browser = await this.initBrowser();
      page = await browser.newPage();

      await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );
      await page.setViewport({ width: 1920, height: 1080 });

      await page.goto(articleUrl, {
        waitUntil: "networkidle2",
        timeout: this.config.PAGE_LOAD_TIMEOUT,
      });

      // Wait for content
      await this.delay(this.config.CONTENT_WAIT_TIMEOUT);

      // Extract article details
      const articleDetails = await page.evaluate(() => {
        // Extract title
        const title = document.querySelector("h1")?.textContent.trim() || "";

        // Extract meta descriptions (SEO optimized)
        const ogDescription =
          document.querySelector('meta[property="og:description"]')?.content ||
          "";
        const metaDescription =
          document.querySelector('meta[name="description"]')?.content || "";
        const seoDescription = ogDescription || metaDescription;

        // Extract main image
        const ogImage =
          document.querySelector('meta[property="og:image"]')?.content || "";
        const mainImage =
          ogImage || document.querySelector("article img")?.src || "";

        // Extract published time
        let publishedTime = "";
        const timeEl = document.querySelector(
          "time, [class*='time'], [class*='date']"
        );
        if (timeEl) {
          publishedTime =
            timeEl.getAttribute("datetime") || timeEl.textContent.trim();
        }

        // Extract author
        let author = "";
        const authorEl = document.querySelector(
          "[class*='author'], [rel='author']"
        );
        if (authorEl) {
          author = authorEl.textContent.trim();
        }

        // Extract article content paragraphs
        const contentParagraphs = [];
        const paragraphs = document.querySelectorAll(
          "article p, [class*='content'] p, [class*='story'] p, main p"
        );

        paragraphs.forEach((p) => {
          const text = p.textContent.trim();
          if (
            text &&
            text.length > 50 &&
            !text.toLowerCase().includes("follow us") &&
            !text.toLowerCase().includes("subscribe") &&
            !text.toLowerCase().includes("cookie") &&
            !text.toLowerCase().includes("privacy") &&
            !text.includes("©")
          ) {
            contentParagraphs.push(text);
          }
        });

        // Extract tags/categories
        const tags = [];
        const tagElements = document.querySelectorAll(
          "[class*='tag'] a, [class*='category'] a"
        );
        tagElements.forEach((tag) => {
          const text = tag.textContent.trim();
          if (text && text.length < 50) {
            tags.push(text);
          }
        });

        // Extract related articles
        const relatedArticles = [];
        const relatedLinks = document.querySelectorAll(
          "[class*='related'] a[href*='/news/']"
        );
        relatedLinks.forEach((link) => {
          const text = link.textContent.trim();
          if (text && text.length > 15) {
            relatedArticles.push({
              title: text,
              link: link.href,
            });
          }
        });

        return {
          title,
          seoDescription,
          mainImage,
          publishedTime,
          author,
          content: contentParagraphs.join("\n\n"),
          contentParagraphs,
          tags: [...new Set(tags)],
          relatedArticles: relatedArticles.slice(0, 5),
          scrapedAt: new Date().toISOString(),
        };
      });

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
        } catch (e) {}
      }

      const isRetryable =
        error.name === "TimeoutError" ||
        error.message.includes("timeout") ||
        error.message.includes("net::");

      if (isRetryable && retryCount < maxRetries) {
        const retryDelay = this.config.RETRY_DELAY * Math.pow(1.5, retryCount);
        this.log(
          `Article fetch failed, retrying in ${retryDelay / 1000}s...`,
          "warn"
        );
        await this.delay(retryDelay);
        return this.fetchArticleContent(articleUrl, retryCount + 1);
      }

      console.error(`   ❌ Error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch news list with full article details
   */
  async fetchNewsWithDetails(limit = 5) {
    try {
      const newsList = await this.fetchNewsList();
      const detailedNews = [];

      if (newsList.length === 0) {
        console.log("⚠️  No news articles found");
        return [];
      }

      console.log(
        `\n📚 Fetching detailed content for top ${Math.min(
          limit,
          newsList.length
        )} articles...\n`
      );

      const articlesToFetch = newsList.slice(0, limit);

      for (let i = 0; i < articlesToFetch.length; i++) {
        const article = articlesToFetch[i];
        console.log(
          `\n[${i + 1}/${articlesToFetch.length}] ${article.title.substring(
            0,
            60
          )}...`
        );

        try {
          const details = await this.fetchArticleContent(article.link);
          detailedNews.push({
            ...article,
            ...details,
          });
        } catch (error) {
          console.error(`   Skipping article due to error: ${error.message}`);
          detailedNews.push({
            ...article,
            fetchError: error.message,
          });
        }

        // Delay between requests to avoid rate limiting
        if (i < articlesToFetch.length - 1) {
          await this.delay(1500);
        }
      }

      return detailedNews;
    } catch (error) {
      console.error(`\n❌ Failed to fetch news with details: ${error.message}`);
      throw error;
    }
  }
}

// ===== MAIN TEST EXECUTION =====
async function main() {
  console.log(
    "╔══════════════════════════════════════════════════════════════╗"
  );
  console.log(
    "║           ICC Cricket News Scraper - Test Script             ║"
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════╝\n"
  );

  const scraper = new ICCNewsScraper();

  try {
    // Test 1: Fetch news list
    console.log(
      "═══════════════════════════════════════════════════════════════"
    );
    console.log("TEST 1: Fetch News List");
    console.log(
      "═══════════════════════════════════════════════════════════════"
    );

    const newsList = await scraper.fetchNewsList();

    console.log("\n📰 Sample News Articles (first 5):\n");
    newsList.slice(0, 5).forEach((article, index) => {
      console.log(`${index + 1}. ${article.title}`);
      console.log(`   📁 Category: ${article.category || "N/A"}`);
      console.log(`   🔗 Link: ${article.link}`);
      console.log(
        `   📝 Description: ${
          article.description
            ? article.description.substring(0, 100) + "..."
            : "N/A"
        }`
      );
      console.log(`   🖼️  Image: ${article.imageUrl ? "Yes" : "No"}`);
      console.log(`   ⏰ Time: ${article.publishedTime || "N/A"}`);
      console.log("");
    });

    // Test 2: Fetch article details for first article
    if (newsList.length > 0) {
      console.log(
        "\n═══════════════════════════════════════════════════════════════"
      );
      console.log("TEST 2: Fetch Full Article Content");
      console.log(
        "═══════════════════════════════════════════════════════════════"
      );

      const firstArticle = newsList[0];
      console.log(`\nFetching full content for: ${firstArticle.title}\n`);

      const articleDetails = await scraper.fetchArticleContent(
        firstArticle.link
      );

      console.log("\n📖 Article Details:\n");
      console.log(`   Title: ${articleDetails.title}`);
      console.log(
        `   SEO Description: ${articleDetails.seoDescription?.substring(
          0,
          150
        )}...`
      );
      console.log(`   Published: ${articleDetails.publishedTime || "N/A"}`);
      console.log(`   Author: ${articleDetails.author || "N/A"}`);
      console.log(`   Main Image: ${articleDetails.mainImage ? "Yes" : "No"}`);
      console.log(
        `   Word Count: ${
          articleDetails.content
            ? articleDetails.content.split(/\s+/).length
            : 0
        }`
      );
      console.log(
        `   Paragraphs: ${articleDetails.contentParagraphs?.length || 0}`
      );
      console.log(`   Tags: ${articleDetails.tags?.join(", ") || "N/A"}`);
      console.log(
        `   Related Articles: ${articleDetails.relatedArticles?.length || 0}`
      );

      if (articleDetails.content) {
        console.log("\n📄 Content Preview (first 500 chars):\n");
        console.log(articleDetails.content.substring(0, 500) + "...\n");
      }
    }

    // Test 3: Fetch multiple articles with details
    console.log(
      "\n═══════════════════════════════════════════════════════════════"
    );
    console.log("TEST 3: Fetch Multiple Articles with Full Details");
    console.log(
      "═══════════════════════════════════════════════════════════════"
    );

    const detailedNews = await scraper.fetchNewsWithDetails(3);

    console.log("\n📊 Summary of Fetched Articles:\n");
    detailedNews.forEach((article, index) => {
      const wordCount = article.content
        ? article.content.split(/\s+/).length
        : 0;
      console.log(`${index + 1}. ${article.title}`);
      console.log(
        `   Words: ${wordCount}, Paragraphs: ${
          article.contentParagraphs?.length || 0
        }`
      );
      console.log(`   Tags: ${article.tags?.slice(0, 3).join(", ") || "N/A"}`);
      console.log("");
    });

    // Output full JSON for one article
    console.log(
      "\n═══════════════════════════════════════════════════════════════"
    );
    console.log("FULL JSON OUTPUT (First Article)");
    console.log(
      "═══════════════════════════════════════════════════════════════\n"
    );

    if (detailedNews.length > 0) {
      // Clone and truncate content for display
      const displayArticle = { ...detailedNews[0] };
      if (displayArticle.content && displayArticle.content.length > 500) {
        displayArticle.content =
          displayArticle.content.substring(0, 500) + "... [truncated]";
      }
      console.log(JSON.stringify(displayArticle, null, 2));
    }

    console.log(
      "\n\n╔══════════════════════════════════════════════════════════════╗"
    );
    console.log(
      "║                    ✅ All Tests Completed!                    ║"
    );
    console.log(
      "╚══════════════════════════════════════════════════════════════╝\n"
    );
  } catch (error) {
    console.error("\n❌ Test failed:", error.message);
    console.error(error.stack);
  } finally {
    await scraper.closeBrowser();
  }
}

// Export for use as module
module.exports = ICCNewsScraper;

// Run if executed directly
if (require.main === module) {
  main();
}
