/**
 * ICC Cricket News Scraper - Production Module
 *
 * Scrapes news from https://www.icc-cricket.com/news
 * Uses Puppeteer to handle dynamic content loading
 *
 * Usage: Imported by run-icc-scraper.js for database integration
 */

const puppeteer = require("puppeteer-core");

// ===== CONFIGURATION =====
const CONFIG = {
  // URLs
  BASE_URL: "https://www.icc-cricket.com",
  NEWS_URL: "https://www.icc-cricket.com/news",

  // Timeout settings (in milliseconds)
  PAGE_LOAD_TIMEOUT: 60000,
  CONTENT_WAIT_TIMEOUT: 5000,
  SCROLL_DELAY: 2000,

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

  log(message, level = "info") {
    if (this.config.VERBOSE_LOGGING || level === "error") {
      const timestamp = new Date().toISOString().split("T")[1].slice(0, 8);
      const prefix = level === "error" ? "❌" : level === "warn" ? "⚠️" : "📍";
      console.log(`[${timestamp}] ${prefix} ${message}`);
    }
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

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
          this.log("Puppeteer not found, trying system Chromium", "warn");
          options.executablePath = "/snap/bin/chromium";
        }
      }

      this.browser = await puppeteer.launch(options);
      this.log("Browser initialized ✓");
    }
    return this.browser;
  }

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
  async fetchLatestNews(retryCount = 0) {
    let page;
    const startTime = Date.now();

    try {
      console.log("\n🏏 Fetching ICC Cricket News...\n");

      if (retryCount > 0) {
        console.log(
          `🔄 Retry attempt ${retryCount}/${this.config.MAX_RETRIES}`
        );
      }

      const browser = await this.initBrowser();
      this.log("Step 1/5: Creating new page...");
      page = await browser.newPage();

      await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );
      await page.setViewport({ width: 1920, height: 1080 });

      page.on("error", (err) =>
        this.log(`Page error: ${err.message}`, "error")
      );
      page.on("pageerror", (err) =>
        this.log(`Page JS error: ${err.message}`, "warn")
      );

      this.log(`Step 2/5: Navigating to ${this.config.NEWS_URL}...`);
      await page.goto(this.config.NEWS_URL, {
        waitUntil: "networkidle2",
        timeout: this.config.PAGE_LOAD_TIMEOUT,
      });

      this.log("Step 3/5: Waiting for content to load...");
      await this.delay(this.config.CONTENT_WAIT_TIMEOUT);

      this.log(`Step 4/5: Scrolling to load more content...`);
      for (let i = 0; i < this.config.SCROLL_ITERATIONS; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await this.delay(this.config.SCROLL_DELAY);
      }

      await page.evaluate(() => window.scrollTo(0, 0));
      await this.delay(1000);

      this.log("Step 5/5: Extracting news articles...");
      const newsArticles = await page.evaluate(() => {
        const articles = [];
        const seen = new Set();
        const newsLinks = document.querySelectorAll('a[href*="/news/"]');

        newsLinks.forEach((link) => {
          const href = link.href;
          if (!href || seen.has(href)) return;

          const urlPath = new URL(href).pathname;

          // Skip category pages and base paths
          if (urlPath.includes("/category/")) return;
          if (urlPath === "/news" || urlPath === "/news/") return;
          if (urlPath.includes("/tournaments/") && urlPath.endsWith("/news"))
            return;

          const slugMatch = urlPath.match(/\/news\/([a-z0-9-]+)$/i);
          if (!slugMatch) return;

          const slug = slugMatch[1];
          if (slug.length < 10) return;

          seen.add(href);

          let container = link.parentElement;
          let title = "";
          let description = "";
          let imageUrl = null;
          let category = "";
          let publishedTime = "";

          let titleFromLink = link.textContent.trim();

          if (titleFromLink && titleFromLink.length > 15) {
            // Remove time indicator
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
            if (!title || title.length < 15) {
              const h2 = container.querySelector("h2, h3, h4");
              if (h2) {
                const headerText = h2.textContent.trim();
                if (
                  headerText &&
                  headerText.length > 15 &&
                  headerText.length < 200
                ) {
                  title = headerText;
                }
              }
            }

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

            if (!imageUrl) {
              const img = container.querySelector("img");
              if (img) {
                imageUrl =
                  img.src || img.dataset?.src || img.getAttribute("data-src");
              }
            }

            if (!category) {
              const categoryEl = container.querySelector(
                "[class*='category'], [class*='tag'], [class*='label']"
              );
              if (categoryEl) {
                category = categoryEl.textContent.trim();
              }
            }

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

          if (title && title.length > 15) {
            articles.push({
              id: slug,
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
      });

      const duration = Date.now() - startTime;
      await page.close();

      console.log(
        `✅ Successfully fetched ${newsArticles.length} news articles in ${duration}ms`
      );
      return newsArticles;
    } catch (error) {
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
        `❌ Error fetching news (attempt ${retryCount + 1}): ${error.message}`
      );

      if (isRetryable && retryCount < this.config.MAX_RETRIES) {
        const retryDelay = this.config.RETRY_DELAY * Math.pow(1.5, retryCount);
        console.log(`⏳ Waiting ${retryDelay / 1000}s before retry...`);
        await this.delay(retryDelay);

        try {
          await this.closeBrowser();
        } catch (e) {}
        return this.fetchLatestNews(retryCount + 1);
      }

      throw error;
    }
  }

  /**
   * Fetch full article content by URL
   */
  async fetchArticleDetails(articleUrl, retryCount = 0) {
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

      await this.delay(this.config.CONTENT_WAIT_TIMEOUT);

      const articleDetails = await page.evaluate(() => {
        const title = document.querySelector("h1")?.textContent.trim() || "";

        const ogDescription =
          document.querySelector('meta[property="og:description"]')?.content ||
          "";
        const metaDescription =
          document.querySelector('meta[name="description"]')?.content || "";
        const seoDescription = ogDescription || metaDescription;

        const ogImage =
          document.querySelector('meta[property="og:image"]')?.content || "";
        const mainImage =
          ogImage || document.querySelector("article img")?.src || "";

        let publishedTime = "";
        const timeEl = document.querySelector(
          "time, [class*='time'], [class*='date']"
        );
        if (timeEl) {
          publishedTime =
            timeEl.getAttribute("datetime") || timeEl.textContent.trim();
        }

        let author = "";
        const authorEl = document.querySelector(
          "[class*='author'], [rel='author']"
        );
        if (authorEl) {
          author = authorEl.textContent.trim();
        }

        // Enhanced content extraction with markdown formatting
        const contentParts = [];
        const article =
          document.querySelector("article") || document.querySelector("main");

        if (article) {
          const elements = article.querySelectorAll(
            "h1, h2, h3, h4, p, ul, ol"
          );
          const skipPatterns = [
            /follow us/i,
            /subscribe/i,
            /cookie/i,
            /privacy/i,
            /terms of/i,
            /©/,
            /copyright/i,
          ];

          elements.forEach((el) => {
            let text = "";

            if (el.tagName === "P") {
              // Convert paragraph with bold/links to markdown
              el.childNodes.forEach((node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                  text += node.textContent;
                } else if (
                  node.nodeName === "STRONG" ||
                  node.nodeName === "B"
                ) {
                  text += "**" + node.textContent + "**";
                } else if (node.nodeName === "EM" || node.nodeName === "I") {
                  text += "_" + node.textContent + "_";
                } else if (node.nodeName === "A") {
                  const href = node.getAttribute("href");
                  if (href && !href.startsWith("#")) {
                    text += "[" + node.textContent + "](" + href + ")";
                  } else {
                    text += node.textContent;
                  }
                } else {
                  text += node.textContent || "";
                }
              });
            } else if (el.tagName.match(/^H[1-4]$/)) {
              // Convert headings to markdown
              const level = parseInt(el.tagName[1]);
              text = "#".repeat(level) + " " + el.textContent.trim();
            } else if (el.tagName === "UL") {
              // Convert unordered lists to markdown
              const items = el.querySelectorAll("li");
              const listItems = [];
              items.forEach((li) => {
                const itemText = li.textContent.trim();
                if (itemText) listItems.push("- " + itemText);
              });
              text = listItems.join("\n");
            } else if (el.tagName === "OL") {
              // Convert ordered lists to markdown
              const items = el.querySelectorAll("li");
              const listItems = [];
              items.forEach((li, idx) => {
                const itemText = li.textContent.trim();
                if (itemText) listItems.push(idx + 1 + ". " + itemText);
              });
              text = listItems.join("\n");
            }

            text = text.trim();

            // Skip if empty, too short, or contains boilerplate
            if (!text || text.length < 20) return;
            const isBoilerplate = skipPatterns.some((pat) => pat.test(text));
            if (isBoilerplate && text.length < 150) return;

            // Avoid duplicate content
            if (contentParts.some((p) => p.includes(text) || text.includes(p)))
              return;

            contentParts.push(text);
          });
        }

        // Fallback to plain paragraph extraction if no content found
        if (contentParts.length === 0) {
          const paragraphs = document.querySelectorAll(
            "article p, [class*='content'] p, main p"
          );
          paragraphs.forEach((p) => {
            const text = p.textContent.trim();
            if (text && text.length > 50) {
              contentParts.push(text);
            }
          });
        }

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

        const fullContent = contentParts.join("\n\n");

        return {
          title,
          seoDescription,
          mainImage,
          publishedTime,
          author,
          content: fullContent,
          contentParagraphs: contentParts,
          wordCount: fullContent.split(/\s+/).filter((w) => w).length,
          tags: [...new Set(tags)],
          relatedArticles: relatedArticles.slice(0, 5),
          scrapedAt: new Date().toISOString(),
        };
      });

      const duration = Date.now() - startTime;
      await page.close();

      console.log(
        `   ✓ ${articleDetails.wordCount} words, published: ${
          articleDetails.publishedTime || "unknown"
        }`
      );

      return {
        ...articleDetails,
        url: articleUrl,
      };
    } catch (error) {
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
        return this.fetchArticleDetails(articleUrl, retryCount + 1);
      }

      console.error(`   ❌ Error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch news list with full article details
   */
  async fetchLatestNewsWithDetails(limit = 5) {
    try {
      const newsList = await this.fetchLatestNews();
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
          `[${i + 1}/${articlesToFetch.length}] ${article.title.substring(
            0,
            60
          )}...`
        );

        try {
          const details = await this.fetchArticleDetails(article.link);
          detailedNews.push({
            ...article,
            details,
          });
        } catch (error) {
          console.error(`   Skipping article due to error: ${error.message}`);
          detailedNews.push({
            ...article,
            details: null,
            fetchError: error.message,
          });
        }

        if (i < articlesToFetch.length - 1) {
          await this.delay(1500);
        }
      }

      return detailedNews;
    } catch (error) {
      console.error(`❌ Failed to fetch news with details: ${error.message}`);
      throw error;
    }
  }
}

module.exports = ICCNewsScraper;
