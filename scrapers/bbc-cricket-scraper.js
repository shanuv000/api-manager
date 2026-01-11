/**
 * BBC Sport Cricket News Scraper - Production Module
 *
 * Scrapes cricket news from https://www.bbc.com/sport/cricket
 * Uses Puppeteer to handle dynamic content loading and returns markdown content
 *
 * Features:
 * - News list extraction from main cricket page
 * - Full article content scraping with markdown formatting
 * - Score/fixture extraction
 * - Related articles and topics extraction
 * - Robust retry mechanisms
 * - Comprehensive logging for debugging
 *
 * Usage: Can be run standalone or imported for integration
 */

const puppeteer = require("puppeteer-core");
const os = require("os");
const axios = require("axios");

// Discord webhook for error alerts
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// ===== CONFIGURATION =====
const CONFIG = {
  // URLs
  BASE_URL: "https://www.bbc.com",
  CRICKET_URL: "https://www.bbc.com/sport/cricket",
  SCORES_URL: "https://www.bbc.com/sport/cricket/scores-fixtures",
  ASHES_URL: "https://www.bbc.com/sport/cricket/ashes",
  FRANCHISE_URL: "https://www.bbc.com/sport/cricket/franchise-cricket",

  // Timeout settings (in milliseconds)
  PAGE_LOAD_TIMEOUT: 60000,
  CONTENT_WAIT_TIMEOUT: 3000,
  SCROLL_DELAY: 1500,

  // Retry settings
  MAX_RETRIES: 3,
  RETRY_DELAY: 3000,

  // Scraping settings
  MAX_ARTICLES: 30,
  SCROLL_ITERATIONS: 3,

  // Logging
  VERBOSE_LOGGING: true,
  DEBUG_LOGGING: process.env.DEBUG_BBC_SCRAPER === 'true',
};

// Log levels for structured logging
const LOG_LEVELS = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  PERF: 'PERF',
  NETWORK: 'NETWORK',
  BROWSER: 'BROWSER',
};

/**
 * BBC Sport Cricket News Scraper
 */
class BBCCricketScraper {
  constructor(options = {}) {
    this.config = { ...CONFIG, ...options };
    this.browser = null;
    this.stats = {
      browserRestarts: 0,
      pagesCreated: 0,
      requestsBlocked: 0,
      requestsAllowed: 0,
      retryAttempts: 0,
      errors: [],
    };
    this.sessionId = Date.now().toString(36);
  }

  /**
   * Enhanced logging with levels, context, and structured data
   */
  log(message, level = "info", context = {}) {
    const timestamp = new Date().toISOString();
    const timeShort = timestamp.split("T")[1].slice(0, 12);
    
    const levelIcons = {
      debug: "🔍",
      info: "📍",
      warn: "⚠️",
      error: "❌",
      perf: "⏱️",
      network: "🌐",
      browser: "🖥️",
      success: "✅",
    };

    const icon = levelIcons[level] || "📍";
    const levelUpper = level.toUpperCase().padEnd(7);
    
    // Always log errors, respect VERBOSE_LOGGING for others
    if (level === "error" || this.config.VERBOSE_LOGGING) {
      const contextStr = Object.keys(context).length > 0 
        ? ` | ${JSON.stringify(context)}` 
        : '';
      console.log(`[${timeShort}] ${icon} [${levelUpper}] [${this.sessionId}] ${message}${contextStr}`);
    }

    // Store errors for summary
    if (level === "error") {
      this.stats.errors.push({
        timestamp,
        message,
        context,
      });
    }
  }

  /**
   * Log performance metrics
   */
  logPerf(operation, durationMs, context = {}) {
    this.log(`${operation} completed in ${durationMs}ms`, "perf", context);
  }

  /**
   * Log system resources
   */
  logSystemResources() {
    const memUsage = process.memoryUsage();
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    const loadAvg = os.loadavg();
    
    this.log("System resources", "debug", {
      heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
      rssMB: Math.round(memUsage.rss / 1024 / 1024),
      freeMemMB: Math.round(freeMem / 1024 / 1024),
      totalMemMB: Math.round(totalMem / 1024 / 1024),
      memUsagePercent: Math.round((1 - freeMem / totalMem) * 100),
      loadAvg1m: loadAvg[0].toFixed(2),
    });
  }

  /**
   * Send critical error alert to Discord
   * @param {string} errorType - Type of error (browser_crash, connection_lost, timeout, blocked, critical)
   * @param {Error} error - The error object
   * @param {Object} context - Additional context
   */
  async sendDiscordErrorAlert(errorType, error, context = {}) {
    if (!DISCORD_WEBHOOK_URL) {
      this.log("Discord webhook not configured, skipping alert", "warn");
      return;
    }

    const errorColors = {
      browser_crash: 15158332,    // Red
      connection_lost: 15105570,  // Orange  
      timeout: 16776960,          // Yellow
      blocked: 10181046,          // Purple
      critical: 15158332,         // Red
      session_errors: 16744192,   // Light red
    };

    try {
      const freeMem = os.freemem();
      const loadAvg = os.loadavg();
      
      const fields = [
        {
          name: "📊 Session Stats",
          value: `Browser Restarts: \`${this.stats.browserRestarts}\`\nPages Created: \`${this.stats.pagesCreated}\`\nRetry Attempts: \`${this.stats.retryAttempts}\`\nTotal Errors: \`${this.stats.errors.length}\``,
          inline: true,
        },
        {
          name: "🖥️ System",
          value: `Memory: \`${Math.round(freeMem / 1024 / 1024)}MB free\`\nLoad: \`${loadAvg[0].toFixed(2)}\``,
          inline: true,
        },
      ];

      if (context.url) {
        fields.push({
          name: "🔗 URL",
          value: `\`${context.url}\``,
          inline: false,
        });
      }

      if (context.retries !== undefined) {
        fields.push({
          name: "🔄 Retry Info",
          value: `Attempts: \`${context.retries + 1}\` / Max: \`${this.config.MAX_RETRIES}\``,
          inline: true,
        });
      }

      if (error.stack) {
        fields.push({
          name: "📋 Stack Trace",
          value: `\`\`\`${error.stack.substring(0, 400)}\`\`\``,
          inline: false,
        });
      }

      const embed = {
        title: `🚨 BBC Scraper Alert: ${errorType.toUpperCase().replace(/_/g, ' ')}`,
        description: `**Session:** \`${this.sessionId}\`\n**Error:** ${error.message?.substring(0, 300) || 'Unknown error'}`,
        color: errorColors[errorType] || 15158332,
        fields,
        timestamp: new Date().toISOString(),
        footer: { text: "BBC Cricket Scraper | Auto-Alert" },
      };

      await axios.post(DISCORD_WEBHOOK_URL, {
        username: "BBC Scraper Monitor",
        avatar_url: "https://static.files.bbci.co.uk/core/website/assets/static/icons/favicon/bbc-favicon-196.png",
        embeds: [embed],
      });
      
      this.log("Discord alert sent", "info", { errorType });
    } catch (alertError) {
      this.log(`Failed to send Discord alert: ${alertError.message}`, "error");
    }
  }

  /**
   * Get session statistics summary
   */
  getStats() {
    return {
      ...this.stats,
      sessionId: this.sessionId,
    };
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async initBrowser(forceNew = false) {
    const startTime = Date.now();
    this.log(`initBrowser called`, "browser", { forceNew, hasBrowser: !!this.browser });
    
    // Check if existing browser is still connected
    if (this.browser && !forceNew) {
      try {
        // Test if browser is still responsive
        const pages = await this.browser.pages();
        this.log(`Browser health check passed`, "browser", { openPages: pages.length });
        return this.browser;
      } catch (e) {
        this.log(`Browser health check failed: ${e.message}`, "warn", { error: e.name });
        this.browser = null;
      }
    }

    // Close existing browser if forcing new one
    if (this.browser && forceNew) {
      this.log("Force closing existing browser...", "browser");
      try {
        await this.browser.close();
        this.log("Existing browser closed", "browser");
      } catch (e) {
        this.log(`Error closing browser: ${e.message}`, "warn");
      }
      this.browser = null;
    }

    if (!this.browser) {
      this.stats.browserRestarts++;
      this.logSystemResources();
      
      const isArm64 = os.arch() === "arm64";
      const platform = os.platform();
      
      this.log(`Launching new browser`, "browser", { 
        isArm64, 
        platform, 
        restartCount: this.stats.browserRestarts 
      });

      const options = {
        headless: "new",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--single-process",
          "--no-zygote",
          "--disable-extensions",
          "--disable-background-networking",
          "--disable-default-apps",
          "--disable-sync",
          "--disable-translate",
          "--mute-audio",
          "--no-first-run",
          "--safebrowsing-disable-auto-update",
        ],
      };

      if (isArm64) {
        this.log("Using system Chromium for ARM64", "browser");
        options.executablePath = "/snap/bin/chromium";
      } else {
        this.log("Finding local Chromium...", "browser");
        try {
          const puppeteerLocal = require("puppeteer");
          options.executablePath = puppeteerLocal.executablePath();
          this.log(`Found Chromium at: ${options.executablePath}`, "browser");
        } catch (e) {
          this.log(`Puppeteer not found: ${e.message}, using system Chromium`, "warn");
          options.executablePath = "/snap/bin/chromium";
        }
      }

      try {
        this.browser = await puppeteer.launch(options);
        const launchTime = Date.now() - startTime;
        this.log(`Browser launched successfully`, "success", { launchTimeMs: launchTime });
      } catch (launchError) {
        this.log(`Browser launch failed: ${launchError.message}`, "error", {
          executablePath: options.executablePath,
          stack: launchError.stack?.split('\n').slice(0, 3).join(' | '),
        });
        
        // Send Discord alert for browser crash
        await this.sendDiscordErrorAlert('browser_crash', launchError, {
          chromePath: options.executablePath,
        });
        
        throw launchError;
      }
    }
    return this.browser;
  }

  async closeBrowser() {
    if (this.browser) {
      const startTime = Date.now();
      try {
        const pages = await this.browser.pages();
        this.log(`Closing browser`, "browser", { openPages: pages.length });
        await this.browser.close();
        this.log(`Browser closed`, "success", { closeTimeMs: Date.now() - startTime });
      } catch (e) {
        this.log(`Error during browser close: ${e.message}`, "warn");
      }
      this.browser = null;
    }
  }

  /**
   * Fetch the news list from BBC Sport Cricket
   */
  async fetchLatestNews(retryCount = 0) {
    let page;
    const startTime = Date.now();
    const operationId = `news-${Date.now().toString(36)}`;

    try {
      console.log("\n🏏 Fetching BBC Sport Cricket News...\n");
      this.log(`Starting fetchLatestNews`, "info", { operationId, retryCount });

      if (retryCount > 0) {
        this.stats.retryAttempts++;
        console.log(`🔄 Retry attempt ${retryCount}/${this.config.MAX_RETRIES}`);
        this.log(`Retry attempt for news list`, "warn", { 
          attempt: retryCount, 
          maxRetries: this.config.MAX_RETRIES 
        });
      }

      const browser = await this.initBrowser();
      this.log("Step 1/5: Creating new page...", "info");
      this.stats.pagesCreated++;
      page = await browser.newPage();
      this.log(`Page created`, "debug", { pageId: this.stats.pagesCreated });

      await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );
      await page.setViewport({ width: 1920, height: 1080 });

      // Enhanced error listeners
      page.on("error", (err) => {
        this.log(`Page crashed: ${err.message}`, "error", { 
          operationId,
          stack: err.stack?.split('\n').slice(0, 2).join(' | ')
        });
      });
      page.on("pageerror", (err) => {
        this.log(`Page JS error: ${err.message}`, "warn", { operationId });
      });
      page.on("console", (msg) => {
        if (msg.type() === 'error') {
          this.log(`Browser console error: ${msg.text()}`, "debug");
        }
      });

      const navStartTime = Date.now();
      this.log(`Step 2/5: Navigating to ${this.config.CRICKET_URL}...`, "network");
      await page.goto(this.config.CRICKET_URL, {
        waitUntil: "networkidle2",
        timeout: this.config.PAGE_LOAD_TIMEOUT,
      });
      this.logPerf("Page navigation", Date.now() - navStartTime, { url: this.config.CRICKET_URL });

      this.log("Step 3/5: Waiting for content to load...", "info");
      await this.delay(this.config.CONTENT_WAIT_TIMEOUT);

      this.log(`Step 4/5: Scrolling to load more content...`, "info", {
        iterations: this.config.SCROLL_ITERATIONS,
        scrollDelay: this.config.SCROLL_DELAY
      });
      for (let i = 0; i < this.config.SCROLL_ITERATIONS; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await this.delay(this.config.SCROLL_DELAY);
        this.log(`Scroll ${i + 1}/${this.config.SCROLL_ITERATIONS} complete`, "debug");
      }

      await page.evaluate(() => window.scrollTo(0, 0));
      await this.delay(1000);

      const extractStartTime = Date.now();
      this.log("Step 5/5: Extracting news articles...", "info");
      const newsArticles = await page.evaluate((maxArticles) => {
        const articles = [];
        const seen = new Set();

        // BBC Sport cricket articles have URLs like /sport/cricket/articles/
        const newsLinks = document.querySelectorAll(
          'a[href*="/sport/cricket/articles/"]'
        );

        newsLinks.forEach((link) => {
          const href = link.href;
          if (!href || seen.has(href)) return;

          // Extract article ID from URL
          const articleIdMatch = href.match(/\/articles\/([a-z0-9]+)$/i);
          if (!articleIdMatch) return;

          const articleId = articleIdMatch[1];
          seen.add(href);

          // Navigate up to find the article card container
          let container = link.parentElement;
          let title = "";
          let description = "";
          let imageUrl = null;
          let category = "";
          let publishedTime = "";
          let commentsCount = "";
          let author = "";

          // Try getting title from link text first
          let titleFromLink = link.textContent.trim();

          // Clean up title - remove duplicates and clean patterns
          if (titleFromLink && titleFromLink.length > 15) {
            // BBC often has patterns like "Attribution[Category]Posted..."
            const cleanPatterns = [
              /Attribution.*$/i,
              /Posted.*$/i,
              /Comments\[\d+\]/gi,
              /\d+\s*(hours?|days?|mins?|secs?)\s*ago/gi,
            ];

            for (const pattern of cleanPatterns) {
              titleFromLink = titleFromLink.replace(pattern, "").trim();
            }

            // Remove duplicate content (BBC often has title twice)
            const midPoint = Math.floor(titleFromLink.length / 2);
            const firstHalf = titleFromLink.substring(0, midPoint).trim();
            const secondHalf = titleFromLink.substring(midPoint).trim();
            if (firstHalf === secondHalf && firstHalf.length > 15) {
              titleFromLink = firstHalf;
            }

            title = titleFromLink;
          }

          // Search parent elements for more info (up to 8 levels)
          for (let i = 0; i < 8 && container; i++) {
            // Look for cleaner title in headings
            if (!title || title.length < 15) {
              const heading = container.querySelector("h1, h2, h3, h4");
              if (heading) {
                const headerText = heading.textContent.trim();
                if (
                  headerText &&
                  headerText.length > 15 &&
                  headerText.length < 200
                ) {
                  title = headerText;
                }
              }
            }

            // Look for description - only from elements that are directly related to this link
            if (!description) {
              // Only look within immediate parent containers (2 levels max)
              let descContainer = link.parentElement;
              for (let j = 0; j < 2 && descContainer; j++) {
                const descElements = descContainer.querySelectorAll(
                  "p, [class*='summary'], [class*='description']"
                );
                for (const desc of descElements) {
                  const text = desc.textContent.trim();
                  // Ensure the description is meaningful and different from title
                  if (
                    text &&
                    text.length > 50 &&
                    text.length < 400 &&
                    text !== title &&
                    !text.includes(title) &&
                    !/^(Published|Posted|Comments)/i.test(text)
                  ) {
                    description = text.substring(0, 300);
                    break;
                  }
                }
                if (description) break;
                descContainer = descContainer.parentElement;
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

            // Look for category/attribution
            if (!category) {
              const categoryEl = container.querySelector(
                "[class*='attribution'] a, [class*='category'] a, [class*='topic'] a"
              );
              if (categoryEl) {
                category = categoryEl.textContent.trim();
              }
            }

            // Look for published time
            if (!publishedTime) {
              const timeEl = container.querySelector(
                "time, [class*='date'], [class*='time']"
              );
              if (timeEl) {
                // Prefer datetime attribute over text
                const datetime = timeEl.getAttribute("datetime");
                if (datetime) {
                  publishedTime = datetime;
                } else {
                  // Extract just the time portion, avoiding duplicates
                  const timeText = timeEl.textContent.trim();
                  const timeMatch = timeText.match(
                    /^(\d+\s*(?:hours?|days?|mins?|months?|years?)\s*ago|\d+\s*\w+\s*\d{4})/i
                  );
                  if (timeMatch) {
                    publishedTime = timeMatch[1];
                  }
                }
              }
            }

            // Look for comments count
            if (!commentsCount) {
              const commentsEl = container.querySelector(
                'a[href*="#comments"], [class*="comments"]'
              );
              if (commentsEl) {
                const match = commentsEl.textContent.match(/(\d+)/);
                if (match) {
                  commentsCount = match[1];
                }
              }
            }

            container = container.parentElement;
          }

          // Only add if we have a valid title
          if (title && title.length > 15 && articles.length < maxArticles) {
            articles.push({
              id: articleId,
              title: title.substring(0, 200),
              description: description || "",
              link: href,
              imageUrl: imageUrl || null,
              category: category || "Cricket",
              publishedTime: publishedTime || "",
              commentsCount: commentsCount || "0",
              author: author || "",
              source: "BBC Sport",
              scrapedAt: new Date().toISOString(),
            });
          }
        });

        // Deduplicate by title similarity
        const uniqueArticles = [];
        const seenTitles = new Set();
        for (const article of articles) {
          const normalizedTitle = article.title.toLowerCase().substring(0, 50);
          if (!seenTitles.has(normalizedTitle)) {
            seenTitles.add(normalizedTitle);
            uniqueArticles.push(article);
          }
        }

        return uniqueArticles;
      }, this.config.MAX_ARTICLES);

      this.logPerf("Content extraction", Date.now() - extractStartTime, {
        articlesFound: newsArticles.length,
        selector: 'a[href*="/sport/cricket/articles/"]'
      });

      const duration = Date.now() - startTime;
      await page.close();
      this.log(`Page closed after news list extraction`, "debug");

      console.log(
        `✅ Successfully fetched ${newsArticles.length} news articles in ${duration}ms`
      );
      
      this.log(`fetchLatestNews completed successfully`, "success", {
        operationId,
        articlesCount: newsArticles.length,
        durationMs: duration,
        retryCount,
      });
      
      // Log article titles for debugging
      if (this.config.DEBUG_LOGGING) {
        newsArticles.forEach((a, i) => {
          this.log(`Article ${i + 1}: ${a.title.substring(0, 50)}...`, "debug", {
            id: a.id,
            hasImage: !!a.imageUrl,
            hasDescription: !!a.description,
          });
        });
      }
      
      return newsArticles;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      if (page) {
        try {
          await page.close();
          this.log(`Page closed after error`, "debug");
        } catch (e) {
          this.log(`Failed to close page after error: ${e.message}`, "warn");
        }
      }

      const isConnectionError = 
        error.message.includes("Connection closed") ||
        error.message.includes("closed") ||
        error.message.includes("detached") ||
        error.message.includes("Target closed");

      const isTimeoutError = 
        error.name === "TimeoutError" ||
        error.message.includes("timeout");

      const isNetworkError = 
        error.message.includes("net::") ||
        error.message.includes("Navigation");

      const isRetryable = isConnectionError || isTimeoutError || isNetworkError;

      this.log(`fetchLatestNews failed`, "error", {
        operationId,
        errorName: error.name,
        errorMessage: error.message,
        isConnectionError,
        isTimeoutError,
        isNetworkError,
        isRetryable,
        retryCount,
        durationMs: duration,
        stack: error.stack?.split('\n').slice(0, 3).join(' | '),
      });

      console.error(
        `❌ Error fetching news (attempt ${retryCount + 1}): ${error.message}`
      );

      if (isRetryable && retryCount < this.config.MAX_RETRIES) {
        const retryDelay = this.config.RETRY_DELAY * Math.pow(1.5, retryCount);
        this.log(`Will retry after ${retryDelay}ms`, "warn", {
          nextAttempt: retryCount + 1,
          maxRetries: this.config.MAX_RETRIES,
        });
        console.log(`⏳ Waiting ${retryDelay / 1000}s before retry...`);
        await this.delay(retryDelay);

        try {
          this.log(`Closing browser before retry`, "browser");
          await this.closeBrowser();
        } catch (e) {
          this.log(`Browser close failed before retry: ${e.message}`, "warn");
        }
        return this.fetchLatestNews(retryCount + 1);
      }

      this.log(`fetchLatestNews exhausted all retries`, "error", {
        operationId,
        totalAttempts: retryCount + 1,
      });

      // Send Discord alert for persistent failure
      await this.sendDiscordErrorAlert('connection_lost', error, {
        url: this.config.CRICKET_URL,
        retries: retryCount,
        operationId,
      });

      throw error;
    }
  }

  /**
   * Fetch full article content by URL with markdown formatting
   */
  async fetchArticleDetails(articleUrl, retryCount = 0) {
    let page;
    const startTime = Date.now();
    const maxRetries = 2;
    const articleId = articleUrl.split("/").pop();
    const operationId = `article-${articleId}-${Date.now().toString(36)}`;

    try {
      this.log(`Fetching article: ${articleId}`, "info", { 
        operationId, 
        retryCount,
        url: articleUrl 
      });
      
      const browser = await this.initBrowser();
      this.stats.pagesCreated++;
      page = await browser.newPage();
      this.log(`Page created for article`, "debug", { articleId, pageId: this.stats.pagesCreated });

      await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );
      await page.setViewport({ width: 1920, height: 1080 });
      
      // Block unnecessary resources to speed up page load
      let blockedCount = 0;
      let allowedCount = 0;
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const resourceType = req.resourceType();
        const url = req.url();
        // Block ads, analytics, videos, and large media files
        if (
          resourceType === 'media' ||
          resourceType === 'font' ||
          url.includes('analytics') ||
          url.includes('tracking') ||
          url.includes('ads') ||
          url.includes('doubleclick') ||
          url.includes('googlesyndication') ||
          url.includes('.mp4') ||
          url.includes('.webm')
        ) {
          blockedCount++;
          req.abort();
        } else {
          allowedCount++;
          req.continue();
        }
      });

      // Add error listeners for this page
      page.on('error', (err) => {
        this.log(`Page error during article fetch`, "error", {
          articleId,
          error: err.message,
        });
      });

      const navStartTime = Date.now();
      await page.goto(articleUrl, {
        waitUntil: "domcontentloaded",
        timeout: this.config.PAGE_LOAD_TIMEOUT,
      });
      const navTime = Date.now() - navStartTime;
      this.log(`Article page loaded`, "network", { 
        articleId, 
        navTimeMs: navTime,
        requestsBlocked: blockedCount,
        requestsAllowed: allowedCount,
      });
      this.stats.requestsBlocked += blockedCount;
      this.stats.requestsAllowed += allowedCount;

      // Wait for article content to be available
      const selectorStartTime = Date.now();
      const selectorFound = await page.waitForSelector('article, main, h1', { timeout: 10000 })
        .then(() => true)
        .catch(() => false);
      this.log(`Content selector check`, "debug", {
        articleId,
        selectorFound,
        waitTimeMs: Date.now() - selectorStartTime,
      });
      await this.delay(this.config.CONTENT_WAIT_TIMEOUT);

      const extractStartTime = Date.now();
      const articleDetails = await page.evaluate(() => {
        // ========== TITLE EXTRACTION ==========
        const title = document.querySelector("h1")?.textContent.trim() || "";

        // ========== META DESCRIPTIONS ==========
        const ogDescription =
          document.querySelector('meta[property="og:description"]')?.content ||
          "";
        const metaDescription =
          document.querySelector('meta[name="description"]')?.content || "";
        const seoDescription = ogDescription || metaDescription;

        // ========== MAIN IMAGE ==========
        const ogImage =
          document.querySelector('meta[property="og:image"]')?.content || "";
        let mainImage = ogImage;
        if (!mainImage) {
          const articleImg = document.querySelector(
            "article img, [class*='image'] img, figure img"
          );
          if (articleImg) {
            mainImage = articleImg.src || "";
          }
        }

        // ========== AUTHOR EXTRACTION ==========
        let author = "";
        const authorLink = document.querySelector(
          'a[href*="/sport/topics/"], [class*="author"] a'
        );
        if (authorLink) {
          author = authorLink.textContent.trim();
        }

        // ========== PUBLISHED TIME ==========
        let publishedTime = "";
        // BBC uses "Published X ago" or specific dates
        const timePatterns = [
          { selector: "time[datetime]", attr: "datetime" },
          { selector: '[class*="date"]', attr: null },
        ];

        for (const { selector, attr } of timePatterns) {
          const el = document.querySelector(selector);
          if (el) {
            publishedTime = attr
              ? el.getAttribute(attr)
              : el.textContent.trim();
            if (publishedTime) break;
          }
        }

        // Also look for "Published X" pattern
        const publishedMatch = document.body.textContent.match(
          /Published\s*(\d+\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s*\d{4}|\d+\s*(?:hours?|days?|mins?)\s*ago)/i
        );
        if (publishedMatch && !publishedTime) {
          publishedTime = publishedMatch[1];
        }

        // ========== CONTENT EXTRACTION WITH MARKDOWN ==========
        const contentParts = [];
        const article =
          document.querySelector("article") || document.querySelector("main");

        // Skip patterns for boilerplate content
        const skipPatterns = [
          /follow us/i,
          /subscribe/i,
          /cookie/i,
          /privacy/i,
          /terms of/i,
          /©/,
          /copyright/i,
          /sign up/i,
          /newsletter/i,
          /read more$/i,
          /back to top/i,
          /share this/i,
          /^Published\d/i, // "Published21 December 2025" metadata
          /^\d+\s*Comments/i, // "886 Comments" metadata
          /^\d+\s*(hours?|days?|mins?)\s*ago$/i, // Relative time metadata
          /^related\s*topics?$/i, // "Related topics" heading
          /^more\s*on\s*this\s*story$/i, // "More on this story" heading
          /^get\s.*news\s*sent/i, // "Get cricket news sent straight to your phone"
          /^around\s*the\s*bbc$/i, // "Around the BBC" section
          /^top\s*stories$/i, // "Top stories" section
          /^elsewhere\s*on/i, // "Elsewhere on BBC" etc
        ];

        // Headings that indicate we should stop extracting main content
        const stopExtractionHeadings = [
          /^related\s*topics?$/i,
          /^more\s*on\s*this\s*story$/i,
          /^get\s.*news/i,
          /^around\s*the\s*bbc$/i,
          /^top\s*stories$/i,
          /^elsewhere\s*on/i,
          /^you\s*may\s*also\s*like$/i,
          /^recommended$/i,
          /^more\s*sport$/i,
          /^latest\s*news$/i,
        ];

        // Flag to track if we've hit boilerplate sections
        let hitBoilerplateSection = false;

        if (article) {
          const elements = article.querySelectorAll(
            "h1, h2, h3, h4, p, ul, ol, blockquote, table, figure"
          );

          elements.forEach((el) => {
            // Once we hit a boilerplate section, skip all remaining elements
            if (hitBoilerplateSection) return;

            let text = "";

            if (el.tagName === "P") {
              // Convert paragraph with formatting to markdown
              el.childNodes.forEach((node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                  text += node.textContent;
                } else if (
                  node.nodeName === "STRONG" ||
                  node.nodeName === "B"
                ) {
                  // Trim content inside bold markers to prevent malformed markdown
                  const boldText = node.textContent.trim();
                  if (boldText) {
                    // Add trailing space to ensure proper markdown parsing when followed by text
                    text += "**" + boldText + "** ";
                  }
                } else if (node.nodeName === "EM" || node.nodeName === "I") {
                  // Trim content inside italic markers
                  const italicText = node.textContent.trim();
                  if (italicText) {
                    // Add trailing space to ensure proper markdown parsing when followed by text
                    text += "_" + italicText + "_ ";
                  }
                } else if (node.nodeName === "A") {
                  const href = node.getAttribute("href");
                  if (href && !href.startsWith("#")) {
                    const fullHref = href.startsWith("/")
                      ? "https://www.bbc.com" + href
                      : href;
                    text += "[" + node.textContent + "](" + fullHref + ")";
                  } else {
                    text += node.textContent;
                  }
                } else {
                  text += node.textContent || "";
                }
              });
            } else if (el.tagName.match(/^H[1-4]$/)) {
              // Skip the main title (H1) since we extract it separately
              if (el.tagName === "H1" && el.textContent.trim() === title)
                return;

              // Check if this heading indicates a boilerplate section
              const headingText = el.textContent.trim();
              for (const pattern of stopExtractionHeadings) {
                if (pattern.test(headingText)) {
                  hitBoilerplateSection = true;
                  return; // Stop processing this and all subsequent elements
                }
              }

              const level = parseInt(el.tagName[1]);
              text = "#".repeat(level) + " " + headingText;
            } else if (el.tagName === "BLOCKQUOTE") {
              // Convert blockquote to markdown
              const quoteText = el.textContent.trim();
              if (quoteText) {
                text =
                  "> " + quoteText.split("\n").filter(Boolean).join("\n> ");
              }
            } else if (el.tagName === "UL") {
              const items = el.querySelectorAll("li");
              const listItems = [];
              const seenItems = new Set();
              items.forEach((li) => {
                let itemText = li.textContent.trim();
                // Remove various duplicate patterns
                itemText = itemText
                  .replace(/(Published.*?ago)(Published.*)/gi, "$1")
                  .trim();
                itemText = itemText
                  .replace(
                    /(\d+\s*(?:hours?|days?|mins?)\s*ago)(\d+[hdm])/gi,
                    "$1"
                  )
                  .trim();
                // Clean up potential duplicated content
                const halfLen = Math.floor(itemText.length / 2);
                if (halfLen > 20) {
                  const firstHalf = itemText.substring(0, halfLen).trim();
                  const secondHalf = itemText.substring(halfLen).trim();
                  if (firstHalf === secondHalf) {
                    itemText = firstHalf;
                  }
                }
                // Skip if already seen or empty
                const itemKey = itemText.substring(0, 60).toLowerCase();

                // Skip metadata items (Published date, Comments count)
                const isMetadata =
                  /^Published\d/i.test(itemText) ||
                  /^\d+\s*Comments$/i.test(itemText) ||
                  /^\d+\s*(hours?|days?|mins?)\s*ago$/i.test(itemText);

                if (
                  itemText &&
                  itemText.length > 5 &&
                  !seenItems.has(itemKey) &&
                  !isMetadata
                ) {
                  seenItems.add(itemKey);
                  listItems.push("- " + itemText);
                }
              });
              text = listItems.join("\n");
            } else if (el.tagName === "OL") {
              const items = el.querySelectorAll("li");
              const listItems = [];
              items.forEach((li, idx) => {
                const itemText = li.textContent.trim();
                if (itemText) listItems.push(idx + 1 + ". " + itemText);
              });
              text = listItems.join("\n");
            } else if (el.tagName === "TABLE") {
              const rows = el.querySelectorAll("tr");
              if (rows.length === 0) return;

              const tableRows = [];
              rows.forEach((row, rowIdx) => {
                const cells = row.querySelectorAll("td, th");
                const cellTexts = [];
                cells.forEach((cell) => {
                  const cellText = cell.textContent.trim().replace(/\n/g, " ");
                  cellTexts.push(cellText);
                });

                if (cellTexts.length > 0) {
                  tableRows.push("| " + cellTexts.join(" | ") + " |");

                  if (rowIdx === 0) {
                    tableRows.push(
                      "| " + cellTexts.map(() => "---").join(" | ") + " |"
                    );
                  }
                }
              });

              if (tableRows.length > 1) {
                text = "\n" + tableRows.join("\n") + "\n";
              }
            } else if (el.tagName === "FIGURE") {
              // Extract figure caption and image
              const figImg = el.querySelector("img");
              const figCaption = el.querySelector("figcaption");
              if (figImg && figImg.src) {
                const caption = figCaption
                  ? figCaption.textContent.trim()
                  : "Image";
                text = `![${caption}](${figImg.src})`;
              }
            }

            text = text.trim();

            // Skip if empty, too short, or contains boilerplate
            if (!text || text.length < 15) return;
            const isBoilerplate = skipPatterns.some((pat) => pat.test(text));
            if (isBoilerplate && text.length < 100) return;

            // Avoid duplicate content
            if (contentParts.some((p) => p.includes(text) || text.includes(p)))
              return;

            // Clean up metadata prefixes that might slip through
            text = text
              .replace(/^Published\d{1,2}\s*\w+\s*\d{4}\s*/i, "") // "Published21 December 2025"
              .replace(/^\d+\s*Comments\s*/i, "") // "886 Comments"
              .trim();

            contentParts.push(text);
          });
        }

        // Fallback to plain paragraph extraction
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

        // ========== RELATED TOPICS/TAGS ==========
        const topics = [];
        const seenTopics = new Set();

        // BBC uses sections with "Related topics" heading
        const topicSections = document.querySelectorAll("section, div");
        topicSections.forEach((section) => {
          const heading = section.querySelector("h2, h3");
          if (heading && /related\s*topics/i.test(heading.textContent)) {
            const topicLinks = section.querySelectorAll("a");
            topicLinks.forEach((link) => {
              const text = link.textContent.trim();
              const href = link.getAttribute("href");
              if (
                text &&
                text.length < 100 &&
                text.length > 2 &&
                !seenTopics.has(text)
              ) {
                seenTopics.add(text);
                topics.push({
                  name: text,
                  link: href
                    ? href.startsWith("/")
                      ? "https://www.bbc.com" + href
                      : href
                    : "",
                });
              }
            });
          }
        });

        // Fallback to general topic selectors
        if (topics.length === 0) {
          document
            .querySelectorAll('[class*="topic"] a, [class*="tag"] a')
            .forEach((link) => {
              const text = link.textContent.trim();
              const href = link.getAttribute("href");
              if (
                text &&
                text.length < 100 &&
                text.length > 2 &&
                !seenTopics.has(text)
              ) {
                seenTopics.add(text);
                topics.push({
                  name: text,
                  link: href
                    ? href.startsWith("/")
                      ? "https://www.bbc.com" + href
                      : href
                    : "",
                });
              }
            });
        }

        // ========== RELATED ARTICLES ==========
        const relatedArticles = [];
        const seenRelated = new Set();

        // Look for "More on this story" section
        const allSections = document.querySelectorAll("section, div");
        allSections.forEach((section) => {
          const heading = section.querySelector("h2, h3");
          if (
            heading &&
            /more\s*on\s*this|related/i.test(heading.textContent)
          ) {
            const relatedLinks = section.querySelectorAll(
              'a[href*="/articles/"]'
            );
            relatedLinks.forEach((link) => {
              let text = link.textContent.trim();
              // Remove "Published X ago" suffix and duplicates
              text = text.replace(/Published.*$/i, "").trim();
              text = text.replace(/(.{20,})\1/, "$1").trim();

              if (
                text &&
                text.length > 15 &&
                text.length < 200 &&
                !seenRelated.has(text.substring(0, 50))
              ) {
                seenRelated.add(text.substring(0, 50));
                relatedArticles.push({
                  title: text,
                  link: link.href,
                });
              }
            });
          }
        });

        // ========== COMMENTS COUNT ==========
        let commentsCount = "0";
        const commentsLink = document.querySelector('a[href*="#comments"]');
        if (commentsLink) {
          const match = commentsLink.textContent.match(/(\d+)/);
          if (match) {
            commentsCount = match[1];
          }
        }

        // ========== EMBEDDED MEDIA ==========
        const embeddedMedia = [];

        // Look for BBC Media Player embeds
        document
          .querySelectorAll('[data-pid], [class*="media-player"]')
          .forEach((el) => {
            const pid = el.getAttribute("data-pid");
            if (pid) {
              embeddedMedia.push({
                type: "bbc-media",
                id: pid,
                url: `https://www.bbc.com/sounds/play/${pid}`,
              });
            }
          });

        // Look for Twitter embeds
        document
          .querySelectorAll(
            'iframe[src*="twitter.com"], blockquote.twitter-tweet'
          )
          .forEach((el) => {
            const src = el.src || "";
            const tweetLink = el.querySelector('a[href*="status"]');
            const match =
              src.match(/status\/(\d+)/) ||
              (tweetLink && tweetLink.href.match(/status\/(\d+)/));
            if (match) {
              embeddedMedia.push({
                type: "twitter",
                id: match[1],
                url: `https://twitter.com/i/status/${match[1]}`,
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
          topics: [...new Map(topics.map((t) => [t.name, t])).values()].slice(
            0,
            8
          ),
          relatedArticles: relatedArticles.slice(0, 5),
          commentsCount,
          embeddedMedia: embeddedMedia.slice(0, 10),
          scrapedAt: new Date().toISOString(),
        };
      });

      const extractTime = Date.now() - extractStartTime;
      const duration = Date.now() - startTime;
      await page.close();

      // Log extraction details
      this.log(`Article content extracted`, "success", {
        articleId,
        wordCount: articleDetails.wordCount,
        hasContent: !!articleDetails.content,
        contentLength: articleDetails.content?.length || 0,
        hasImage: !!articleDetails.mainImage,
        hasAuthor: !!articleDetails.author,
        publishedTime: articleDetails.publishedTime || 'unknown',
        topicsCount: articleDetails.topics?.length || 0,
        relatedCount: articleDetails.relatedArticles?.length || 0,
        extractTimeMs: extractTime,
        totalTimeMs: duration,
      });

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
      const duration = Date.now() - startTime;
      
      if (page) {
        try {
          await page.close();
          this.log(`Page closed after article error`, "debug", { articleId });
        } catch (e) {
          this.log(`Failed to close page: ${e.message}`, "warn", { articleId });
        }
      }

      const isConnectionError = 
        error.message.includes("Connection closed") ||
        error.message.includes("closed") ||
        error.message.includes("detached") ||
        error.message.includes("Target closed") ||
        error.message.includes("Protocol error");

      const isTimeoutError = 
        error.name === "TimeoutError" ||
        error.message.includes("timeout");

      const isNetworkError = 
        error.message.includes("net::");

      const isRetryable = isTimeoutError || isNetworkError || isConnectionError;

      this.log(`Article fetch failed`, "error", {
        operationId,
        articleId,
        errorName: error.name,
        errorMessage: error.message,
        isConnectionError,
        isTimeoutError,
        isNetworkError,
        isRetryable,
        retryCount,
        maxRetries,
        durationMs: duration,
        stack: error.stack?.split('\n').slice(0, 3).join(' | '),
      });

      if (isRetryable && retryCount < maxRetries) {
        this.stats.retryAttempts++;
        const retryDelay = this.config.RETRY_DELAY * Math.pow(1.5, retryCount);
        this.log(`Article retry scheduled`, "warn", {
          articleId,
          retryDelay,
          nextAttempt: retryCount + 1,
          maxRetries,
          reason: isConnectionError ? 'connection' : isTimeoutError ? 'timeout' : 'network',
        });
        
        // On connection errors, restart the browser
        if (isConnectionError) {
          this.log("Connection error - restarting browser before retry", "browser", { articleId });
          try {
            await this.closeBrowser();
          } catch (e) {
            this.log(`Browser close failed: ${e.message}`, "warn");
          }
          await this.delay(1000);
        }
        
        await this.delay(retryDelay);
        return this.fetchArticleDetails(articleUrl, retryCount + 1);
      }

      this.log(`Article fetch exhausted all retries`, "error", {
        operationId,
        articleId,
        totalAttempts: retryCount + 1,
      });

      console.error(`   ❌ Error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch cricket scores and fixtures
   */
  async fetchScoresAndFixtures(date = null) {
    let page;
    const startTime = Date.now();

    try {
      const targetDate = date || new Date().toISOString().split("T")[0];
      const scoresUrl = `${this.config.SCORES_URL}/${targetDate}`;

      console.log(`\n🏏 Fetching BBC Cricket Scores for ${targetDate}...\n`);

      const browser = await this.initBrowser();
      page = await browser.newPage();

      await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );
      await page.setViewport({ width: 1920, height: 1080 });

      await page.goto(scoresUrl, {
        waitUntil: "networkidle2",
        timeout: this.config.PAGE_LOAD_TIMEOUT,
      });

      await this.delay(this.config.CONTENT_WAIT_TIMEOUT);

      const scores = await page.evaluate(() => {
        const matches = [];

        // BBC scores have links to scorecards
        const matchLinks = document.querySelectorAll('a[href*="/scorecard/"]');

        matchLinks.forEach((link) => {
          const href = link.href;
          const container = link.closest("li, article, [class*='match']");
          if (!container) return;

          const matchText = container.textContent;

          // Extract teams and score info
          const teams = [];
          const teamElements = container.querySelectorAll(
            '[class*="team"], [class*="abbr"]'
          );
          teamElements.forEach((el) => {
            const name = el.textContent.trim();
            if (name && name.length > 1 && name.length < 50) {
              teams.push(name);
            }
          });

          // Extract time/status
          const timeMatch = matchText.match(/(\d{1,2}:\d{2})/);
          const time = timeMatch ? timeMatch[1] : "";

          // Extract venue
          const venueMatch = matchText.match(/Venue:\s*([^,\n]+)/i);
          const venue = venueMatch ? venueMatch[1].trim() : "";

          // Extract competition
          const competition =
            container
              .closest("section, [class*='competition']")
              ?.querySelector("h2, h3")
              ?.textContent.trim() || "";

          if (teams.length >= 2 || matchText.length > 10) {
            matches.push({
              link: href,
              matchId: href.match(/scorecard\/([^/]+)/)?.[1] || "",
              teams: teams.slice(0, 2),
              time,
              venue,
              competition,
              rawText: matchText.substring(0, 200),
            });
          }
        });

        return matches;
      });

      const duration = Date.now() - startTime;
      await page.close();

      console.log(
        `✅ Found ${scores.length} matches/fixtures in ${duration}ms`
      );
      return {
        date: targetDate,
        matches: scores,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (page) {
        try {
          await page.close();
        } catch (e) {}
      }
      console.error(`❌ Error fetching scores: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch news list with full article details
   */
  async fetchLatestNewsWithDetails(limit = 5) {
    const operationStartTime = Date.now();
    const operationId = `batch-${Date.now().toString(36)}`;
    
    this.log(`Starting batch article fetch`, "info", { operationId, limit });
    this.logSystemResources();
    
    try {
      const newsList = await this.fetchLatestNews();
      const detailedNews = [];

      if (newsList.length === 0) {
        this.log(`No news articles found in list`, "warn", { operationId });
        console.log("⚠️  No news articles found");
        return [];
      }

      const articlesToFetch = newsList.slice(0, limit);
      this.log(`Will fetch details for ${articlesToFetch.length} articles`, "info", {
        operationId,
        totalInList: newsList.length,
        fetchLimit: limit,
      });

      console.log(
        `\n📚 Fetching detailed content for top ${Math.min(
          limit,
          newsList.length
        )} articles...\n`
      );

      let consecutiveErrors = 0;
      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < articlesToFetch.length; i++) {
        const article = articlesToFetch[i];
        const articleStartTime = Date.now();
        
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
          consecutiveErrors = 0; // Reset on success
          successCount++;
          
          this.log(`Article ${i + 1}/${articlesToFetch.length} fetched`, "debug", {
            articleId: article.id,
            wordCount: details.wordCount,
            fetchTimeMs: Date.now() - articleStartTime,
          });
        } catch (error) {
          errorCount++;
          console.error(`   Skipping article due to error: ${error.message}`);
          this.log(`Article ${i + 1}/${articlesToFetch.length} failed`, "error", {
            articleId: article.id,
            error: error.message,
            consecutiveErrors: consecutiveErrors + 1,
          });
          
          detailedNews.push({
            ...article,
            details: null,
            fetchError: error.message,
          });
          consecutiveErrors++;
          
          // If too many consecutive errors, restart browser
          if (consecutiveErrors >= 2) {
            this.log("Multiple consecutive errors - restarting browser", "warn", {
              operationId,
              consecutiveErrors,
              articleIndex: i,
            });
            try {
              await this.closeBrowser();
            } catch (e) {
              this.log(`Browser close failed: ${e.message}`, "warn");
            }
            await this.delay(2000);
            consecutiveErrors = 0;
          }
        }

        if (i < articlesToFetch.length - 1) {
          await this.delay(1500);
        }
      }

      const totalDuration = Date.now() - operationStartTime;
      
      // Log final batch summary
      this.log(`Batch article fetch completed`, "success", {
        operationId,
        totalArticles: articlesToFetch.length,
        successCount,
        errorCount,
        successRate: `${Math.round((successCount / articlesToFetch.length) * 100)}%`,
        totalDurationMs: totalDuration,
        avgTimePerArticle: Math.round(totalDuration / articlesToFetch.length),
      });

      // Log session stats
      this.log(`Session statistics`, "perf", this.getStats());

      return detailedNews;
    } catch (error) {
      this.log(`Batch fetch failed completely`, "error", {
        operationId,
        error: error.message,
        stack: error.stack?.split('\n').slice(0, 3).join(' | '),
      });
      console.error(`❌ Failed to fetch news with details: ${error.message}`);
      throw error;
    }
  }

  /**
   * Print session statistics summary
   */
  printStatsSummary() {
    const stats = this.getStats();
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 BBC SCRAPER SESSION STATISTICS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`   Session ID:        ${stats.sessionId}`);
    console.log(`   Browser restarts:  ${stats.browserRestarts}`);
    console.log(`   Pages created:     ${stats.pagesCreated}`);
    console.log(`   Retry attempts:    ${stats.retryAttempts}`);
    console.log(`   Requests blocked:  ${stats.requestsBlocked}`);
    console.log(`   Requests allowed:  ${stats.requestsAllowed}`);
    console.log(`   Errors logged:     ${stats.errors.length}`);
    if (stats.errors.length > 0) {
      console.log('   Last errors:');
      stats.errors.slice(-3).forEach((e, i) => {
        console.log(`     ${i + 1}. ${e.message}`);
      });
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Return stats for potential async alert
    return stats;
  }

  /**
   * Async version of printStatsSummary that also sends Discord alert on errors
   */
  async printStatsSummaryWithAlert() {
    const stats = this.printStatsSummary();
    
    // If there were errors during the session, send a summary alert
    if (stats.errors.length >= 3) {
      await this.sendDiscordErrorAlert('session_errors', 
        new Error(`Session had ${stats.errors.length} errors`), 
        { 
          errorCount: stats.errors.length,
          browserRestarts: stats.browserRestarts,
          retryAttempts: stats.retryAttempts,
        }
      );
    }
    
    return stats;
  }

  /**
   * Generate markdown output for an article
   */
  generateMarkdown(article) {
    const lines = [];

    // Title
    lines.push(`# ${article.title || article.details?.title || "Untitled"}`);
    lines.push("");

    // Metadata
    if (article.author || article.details?.author) {
      lines.push(`**Author:** ${article.author || article.details?.author}`);
    }
    if (article.publishedTime || article.details?.publishedTime) {
      lines.push(
        `**Published:** ${
          article.publishedTime || article.details?.publishedTime
        }`
      );
    }
    if (article.category) {
      lines.push(`**Category:** ${article.category}`);
    }
    if (
      article.details?.commentsCount &&
      article.details.commentsCount !== "0"
    ) {
      lines.push(`**Comments:** ${article.details.commentsCount}`);
    }
    lines.push(`**Source:** [BBC Sport](${article.link})`);
    lines.push("");

    // Description
    if (article.description || article.details?.seoDescription) {
      lines.push(`> ${article.description || article.details?.seoDescription}`);
      lines.push("");
    }

    // Main image
    if (article.imageUrl || article.details?.mainImage) {
      lines.push(
        `![Article Image](${article.imageUrl || article.details?.mainImage})`
      );
      lines.push("");
    }

    // Content
    if (article.details?.content) {
      lines.push("---");
      lines.push("");
      lines.push(article.details.content);
      lines.push("");
    }

    // Topics
    if (article.details?.topics?.length > 0) {
      lines.push("---");
      lines.push("");
      lines.push("## Related Topics");
      lines.push("");
      article.details.topics.forEach((topic) => {
        lines.push(`- [${topic.name}](${topic.link})`);
      });
      lines.push("");
    }

    // Related Articles
    if (article.details?.relatedArticles?.length > 0) {
      lines.push("## More on this Story");
      lines.push("");
      article.details.relatedArticles.forEach((related) => {
        lines.push(`- [${related.title}](${related.link})`);
      });
      lines.push("");
    }

    // Footer
    lines.push("---");
    lines.push(
      `*Scraped at: ${
        article.scrapedAt ||
        article.details?.scrapedAt ||
        new Date().toISOString()
      }*`
    );

    return lines.join("\n");
  }
}

// ========== STANDALONE EXECUTION ==========
async function main() {
  const scraper = new BBCCricketScraper();

  try {
    console.log("=".repeat(60));
    console.log("BBC SPORT CRICKET SCRAPER - Test Run");
    console.log("=".repeat(60));

    // 1. Fetch news list
    const news = await scraper.fetchLatestNews();
    console.log(`\nFound ${news.length} articles in list`);

    // Display first 5 articles
    console.log("\n📰 Top 5 Articles:");
    news.slice(0, 5).forEach((article, idx) => {
      console.log(`\n${idx + 1}. ${article.title}`);
      console.log(`   Category: ${article.category}`);
      console.log(`   Published: ${article.publishedTime || "Unknown"}`);
      console.log(`   ID: ${article.id}`);
    });

    // 2. Fetch details for first article
    if (news.length > 0) {
      console.log("\n" + "=".repeat(60));
      console.log("Fetching full article details...");
      console.log("=".repeat(60));

      const details = await scraper.fetchArticleDetails(news[0].link);

      console.log("\n📄 Article Details:");
      console.log(`Title: ${details.title}`);
      console.log(`Author: ${details.author || "Unknown"}`);
      console.log(`Published: ${details.publishedTime || "Unknown"}`);
      console.log(`Word Count: ${details.wordCount}`);
      console.log(
        `Topics: ${details.topics.map((t) => t.name).join(", ") || "None"}`
      );
      console.log(`Related Articles: ${details.relatedArticles.length}`);

      // Generate markdown
      console.log("\n" + "=".repeat(60));
      console.log("MARKDOWN OUTPUT:");
      console.log("=".repeat(60));
      const markdown = scraper.generateMarkdown({
        ...news[0],
        details,
      });
      console.log(markdown);
    }

    // 3. Fetch scores (optional)
    console.log("\n" + "=".repeat(60));
    console.log("Fetching Today's Cricket Scores...");
    console.log("=".repeat(60));

    const scores = await scraper.fetchScoresAndFixtures();
    console.log(`\nFound ${scores.matches.length} matches for ${scores.date}`);
    scores.matches.slice(0, 5).forEach((match, idx) => {
      console.log(`\n${idx + 1}. ${match.teams.join(" vs ") || "Match"}`);
      console.log(`   Competition: ${match.competition || "Unknown"}`);
      console.log(`   Time: ${match.time || "TBD"}`);
    });
  } catch (error) {
    console.error("Fatal error:", error.message);
  } finally {
    await scraper.closeBrowser();
    console.log("\n✅ Scraper finished");
  }
}

// Export for module usage
module.exports = BBCCricketScraper;

// Run if executed directly
if (require.main === module) {
  main();
}
