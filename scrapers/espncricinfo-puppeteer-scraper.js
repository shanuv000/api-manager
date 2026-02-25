/**
 * ESPN Cricinfo News Scraper - Puppeteer Version (Improved)
 *
 * Key improvements over Cheerio approach:
 * - Uses Puppeteer for JavaScript-rendered content
 * - Extracts publishedTime from JSON-LD structured data
 * - Uses 'domcontentloaded' instead of 'networkidle2' to avoid timeouts
 * - Better content extraction with multiple fallbacks
 *
 * Usage:
 *   node scrapers/espncricinfo-puppeteer-scraper.js
 */

const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

// Find Chrome executable - prioritize Puppeteer's bundled Chrome (works in cron)
function findChromiumPath() {
  const fs = require("fs");

  // First, try Puppeteer's bundled Chrome (not a snap, works in cron)
  try {
    const puppeteerFull = require("puppeteer");
    const bundledPath = puppeteerFull.executablePath();
    if (fs.existsSync(bundledPath)) {
      console.log("📍 Using Puppeteer bundled Chrome");
      return bundledPath;
    }
  } catch (e) {
    // puppeteer not available, try system paths
  }

  // Fallback to system Chromium paths
  const CHROMIUM_PATHS = [
    process.env.CHROME_PATH,
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/snap/bin/chromium", // LAST - snap fails in cron!
  ].filter(Boolean);

  for (const path of CHROMIUM_PATHS) {
    if (fs.existsSync(path)) {
      console.log(`📍 Using system Chromium: ${path}`);
      return path;
    }
  }
  throw new Error(
    "Chromium not found. Please install chromium-browser or set CHROME_PATH."
  );
}

class ESPNCricinfoPuppeteerScraper {
  constructor(options = {}) {
    this.baseUrl = "https://www.espncricinfo.com";
    this.newsUrl = "https://www.espncricinfo.com/cricket-news";

    this.launchOptions = {
      headless: options.headless !== false ? "new" : false,
      executablePath: options.executablePath || findChromiumPath(),
      protocolTimeout: 180000, // Match Puppeteer's default — 60s was too tight for heavy pages
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-plugins",
        "--disable-blink-features=AutomationControlled", // Hide automation flag
        "--disable-features=IsolateOrigins,site-per-process",
        "--no-first-run",
        "--disable-images", // Don't load images to speed up
        "--blink-settings=imagesEnabled=false",
        "--single-process", // Required for cron/systemd execution
        "--no-zygote", // Required for cron/systemd execution
      ],
      defaultViewport: { width: 1280, height: 800 },
      ...options.launchOptions,
    };

    this.browser = null;
    this.navigationTimeout = options.navigationTimeout || 45000;
  }

  async init() {
    if (!this.browser) {
      console.log("🚀 Launching Puppeteer browser (stealth mode)...");
      this.browser = await puppeteer.launch(this.launchOptions);

      // Recovery handler for silent CDP disconnects
      this.browser.on('disconnected', () => {
        console.log('⚠️ Browser disconnected unexpectedly');
        this.browser = null;
      });

      console.log("✅ Browser initialized with stealth");
    }
    return this;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log("🔒 Browser closed");
    }
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Parse various date formats to ISO
   */
  parseDate(dateStr) {
    if (!dateStr) return null;

    // Clean up ESPN-specific strings
    let clean = dateStr
      .replace(/ESPNcricinfo staff/gi, "")
      .replace(/•/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Handle "Just now"
    if (/just now/i.test(clean)) {
      return new Date().toISOString();
    }

    // Handle relative time: "2 hrs ago", "15 mins ago", "1 day ago"
    const relMatch = clean.match(
      /(\d+)\s*(hr|hrs|hour|hours|min|mins|minute|minutes|day|days)\s*ago/i
    );
    if (relMatch) {
      const value = parseInt(relMatch[1]);
      const unit = relMatch[2].toLowerCase();
      const now = new Date();

      if (unit.startsWith("hr") || unit.startsWith("hour")) {
        now.setHours(now.getHours() - value);
      } else if (unit.startsWith("min")) {
        now.setMinutes(now.getMinutes() - value);
      } else if (unit.startsWith("day")) {
        now.setDate(now.getDate() - value);
      }
      return now.toISOString();
    }

    // Handle "DD-Mon-YYYY" format (e.g., "16-Dec-2025")
    const dateOnlyMatch = clean.match(/(\d{1,2}-[A-Za-z]{3}-\d{4})/);
    if (dateOnlyMatch) {
      const d = new Date(dateOnlyMatch[1]);
      if (!isNaN(d.getTime())) return d.toISOString();
    }

    // Handle ISO date strings directly
    const isoMatch = clean.match(/(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)/);
    if (isoMatch) {
      const d = new Date(isoMatch[1]);
      if (!isNaN(d.getTime())) return d.toISOString();
    }

    // Try standard parsing
    try {
      const d = new Date(clean);
      if (!isNaN(d.getTime())) return d.toISOString();
    } catch (e) { }

    return null;
  }

  extractSlugFromUrl(url) {
    if (!url) return null;
    const parts = url.split("/");
    const storyIdx = parts.indexOf("story");
    if (storyIdx !== -1 && parts[storyIdx + 1]) {
      return parts[storyIdx + 1];
    }
    return parts.filter((p) => p).pop() || url;
  }

  /**
   * Create a page with optimized settings
   */
  async createOptimizedPage() {
    const page = await this.browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );

    // Extra webdriver override (redundancy on top of stealth plugin)
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    // Block heavy resources
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      const url = req.url();

      // Block ads, analytics, images, fonts, stylesheets
      if (
        ["image", "stylesheet", "font", "media"].includes(type) ||
        url.includes("google-analytics") ||
        url.includes("googletagmanager") ||
        url.includes("facebook") ||
        url.includes("doubleclick") ||
        url.includes("adsystem") ||
        url.includes(".gif") ||
        url.includes(".png") ||
        url.includes(".jpg") ||
        url.includes(".woff")
      ) {
        req.abort();
      } else {
        req.continue();
      }
    });

    return page;
  }

  /**
   * Create a page that allows social embeds (Twitter/Instagram) to load
   */
  async createPageForEmbeds() {
    const page = await this.browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );

    // Extra webdriver override
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    // Allow social media resources but block ads and analytics
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();

      // Allow Twitter and Instagram resources
      if (
        url.includes("twitter.com") ||
        url.includes("platform.twitter") ||
        url.includes("instagram.com") ||
        url.includes("cdninstagram.com")
      ) {
        req.continue();
        return;
      }

      // Block ads and analytics
      if (
        url.includes("google-analytics") ||
        url.includes("googletagmanager") ||
        url.includes("facebook.net") ||
        url.includes("doubleclick") ||
        url.includes("adsystem") ||
        url.includes("taboola") ||
        url.includes("outbrain")
      ) {
        req.abort();
        return;
      }

      // Allow everything else
      req.continue();
    });

    return page;
  }

  /**
   * Extract table data from a Datawrapper iframe URL
   * ESPN Cricinfo uses Datawrapper for interactive statistical tables
   */
  async extractDatawrapperTable(iframeUrl) {
    let page;
    try {
      page = await this.browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
      );

      // Navigate to the Datawrapper iframe
      await page.goto(iframeUrl, {
        waitUntil: "networkidle2",
        timeout: 15000,
      });

      // Wait for JS to render the table
      await this.delay(2000);

      // Extract table data
      const tableData = await page.evaluate(() => {
        const table = document.querySelector("table");
        if (!table) return null;

        const rows = [];
        table.querySelectorAll("tr").forEach((tr) => {
          const cells = [];
          tr.querySelectorAll("th, td").forEach((cell) => {
            // Clean the cell text
            let text = cell.textContent.trim();
            // Remove multiple spaces
            text = text.replace(/\s+/g, " ");
            cells.push(text);
          });
          if (cells.length > 0) {
            rows.push(cells);
          }
        });

        // Also get the title if present
        const title =
          document.querySelector("h1, .dw-chart-header")?.textContent?.trim() ||
          null;

        return { rows, title };
      });

      if (!tableData || !tableData.rows || tableData.rows.length === 0) {
        return null;
      }

      // Convert to markdown table
      const { rows, title } = tableData;
      const lines = [];

      // Add title if present
      if (title) {
        lines.push(`**${title}**`);
        lines.push("");
      }

      // Header row
      lines.push("| " + rows[0].join(" | ") + " |");
      // Separator row
      lines.push("| " + rows[0].map(() => "---").join(" | ") + " |");
      // Data rows
      for (let i = 1; i < rows.length; i++) {
        lines.push("| " + rows[i].join(" | ") + " |");
      }

      return lines.join("\n");
    } catch (error) {
      console.log(
        `   ⚠️ Failed to extract Datawrapper table: ${error.message}`
      );
      return null;
    } finally {
      if (page) {
        await page.close();
      }
    }
  }

  /**
   * Navigate with fallback strategies
   */
  async navigateSafe(page, url) {
    try {
      // First try: domcontentloaded (faster)
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: this.navigationTimeout,
      });

      // Wait a bit for essential JS to execute
      await this.delay(2500);

      return true;
    } catch (error) {
      console.log(
        `   ⚠️ Navigation warning: ${error.message.substring(0, 50)}`
      );
      return false;
    }
  }

  /**
   * Fetch latest news from listing page
   */
  async fetchLatestNews() {
    await this.init();

    console.log("🏏 Fetching latest cricket news from ESPN Cricinfo...");

    const page = await this.createOptimizedPage();

    try {
      await this.navigateSafe(page, this.newsUrl);

      const articles = await page.evaluate(() => {
        const results = [];
        const seen = new Set();

        document.querySelectorAll('a[href*="/story/"]').forEach((link) => {
          const href = link.href;
          if (seen.has(href) || !href.includes("/story/")) return;
          seen.add(href);

          const card = link.closest(
            'article, [class*="story"], [class*="card"], div'
          );
          if (!card) return;

          // Get title
          let title = "";
          const heading = card.querySelector("h1, h2, h3, h4, h5, h6");
          if (heading) {
            title = heading.textContent.trim();
          } else {
            title = link.textContent.trim();
          }

          if (!title || title.length < 15) return;

          // Get description
          let description = "";
          const descEl = card.querySelector('p, [class*="summary"]');
          if (descEl && descEl.textContent.trim() !== title) {
            description = descEl.textContent.trim();
          }

          results.push({
            title,
            description,
            url: href,
          });
        });

        return results;
      });

      const uniqueArticles = [];
      const urlSet = new Set();

      articles.forEach((article) => {
        if (!urlSet.has(article.url)) {
          urlSet.add(article.url);
          uniqueArticles.push({
            id: this.extractSlugFromUrl(article.url),
            title: article.title,
            description: article.description || null,
            link: article.url,
            url: article.url,
            source: "ESPN Cricinfo",
            sourceId: `espncricinfo-${this.extractSlugFromUrl(article.url)}`,
            scrapedAt: new Date().toISOString(),
          });
        }
      });

      console.log(`✅ Found ${uniqueArticles.length} articles`);
      return uniqueArticles;
    } finally {
      await page.close();
    }
  }

  /**
   * Fetch detailed content from an article page - THE KEY METHOD
   * Enhanced with inline Twitter/Instagram embeds and markdown formatting
   */
  async fetchArticleDetails(articleUrl) {
    await this.init();

    console.log(`📰 Scraping: ${articleUrl.split("/").pop()}`);

    // Use page that allows social embeds to load
    const page = await this.createPageForEmbeds();

    try {
      const navSuccess = await this.navigateSafe(page, articleUrl);
      if (!navSuccess) {
        throw new Error("Navigation failed");
      }

      // Wait longer for embeds to load
      await this.delay(4000);

      // Extract all data in one evaluate call for efficiency
      const rawData = await page.evaluate(() => {
        const result = {
          title: "",
          description: "",
          publishedTime: null,
          modifiedTime: null,
          author: "",
          mainImage: "",
          content: "",
          contentParagraphs: [],
          tags: [],
          keywords: [],
          relatedArticles: [],
          jsonLd: null,
          embeddedTweets: [],
          embeddedInstagram: [],
          datawrapperIframes: [],
        };

        // Track extracted social IDs
        const seenTweetIds = new Set();
        const seenInstagramIds = new Set();

        // ========== JSON-LD (MOST RELIABLE FOR DATES) ==========
        const jsonLdScripts = document.querySelectorAll(
          'script[type="application/ld+json"]'
        );
        for (const script of jsonLdScripts) {
          try {
            const data = JSON.parse(script.textContent);
            // Handle array or single object
            const items = Array.isArray(data) ? data : [data];
            for (const item of items) {
              if (
                item["@type"] === "NewsArticle" ||
                item["@type"] === "Article"
              ) {
                result.jsonLd = {
                  headline: item.headline || "",
                  datePublished: item.datePublished || "",
                  dateModified: item.dateModified || "",
                  author:
                    item.author?.name ||
                    (Array.isArray(item.author) ? item.author[0]?.name : "") ||
                    "",
                  description: item.description || "",
                  image:
                    item.image?.url ||
                    (Array.isArray(item.image) ? item.image[0]?.url : "") ||
                    item.image ||
                    "",
                  keywords: item.keywords || "",
                  articleBody: item.articleBody || "",
                };
                break;
              }
            }
          } catch (e) { }
        }

        // ========== TITLE ==========
        const titleSources = [
          result.jsonLd?.headline,
          document.querySelector("h1")?.textContent?.trim(),
          document.querySelector('[class*="headline"] h1')?.textContent?.trim(),
          document.querySelector('meta[property="og:title"]')?.content,
        ].filter(Boolean);
        result.title = titleSources[0] || "";

        // ========== PUBLISHED TIME ==========
        const timeSources = [
          result.jsonLd?.datePublished,
          document.querySelector('meta[property="article:published_time"]')
            ?.content,
          document.querySelector("time[datetime]")?.getAttribute("datetime"),
          document.querySelector('[class*="timestamp"]')?.textContent?.trim(),
          document.querySelector('[class*="date"]')?.textContent?.trim(),
        ].filter(Boolean);
        result.publishedTime = timeSources[0] || null;

        // ========== MODIFIED TIME ==========
        result.modifiedTime =
          result.jsonLd?.dateModified ||
          document.querySelector('meta[property="article:modified_time"]')
            ?.content ||
          null;

        // ========== AUTHOR ==========
        const authorSources = [
          result.jsonLd?.author,
          document.querySelector('meta[name="author"]')?.content,
          document.querySelector('[class*="author-name"]')?.textContent?.trim(),
          document.querySelector('[class*="byline"]')?.textContent?.trim(),
        ].filter(Boolean);
        result.author = (authorSources[0] || "").replace(/^by\s*/i, "").trim();

        // ========== MAIN IMAGE ==========
        const imgSources = [
          document.querySelector('meta[property="og:image"]')?.content,
          document.querySelector('meta[name="twitter:image"]')?.content,
          result.jsonLd?.image,
        ].filter(Boolean);
        result.mainImage = imgSources[0] || "";

        // ========== DESCRIPTION ==========
        result.description =
          result.jsonLd?.description ||
          document.querySelector('meta[property="og:description"]')?.content ||
          document.querySelector('meta[name="description"]')?.content ||
          "";

        // ========== HELPER FUNCTIONS ==========

        // Boilerplate patterns to skip
        const skipPatterns = [
          /follow us/i,
          /subscribe/i,
          /newsletter/i,
          /cookie/i,
          /privacy policy/i,
          /terms of use/i,
          /sign up/i,
          /download app/i,
          /copyright/i,
          /©/,
          /read more:/i,
          /also read:/i,
          /related articles/i,
          /advertisement/i,
          /sponsored/i,
        ];

        // Social text patterns (to filter out from content)
        const socialTextPatterns = [
          /pic\.twitter\.com\//i,
          /t\.co\//i,
          /twitter\.com\/.*\/status\//i,
          /instagram\.com\/p\//i,
          /instagram\.com\/reel\//i,
          /View this post on Instagram/i,
          /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}$/i,
        ];

        function isSocialTextFragment(text) {
          return socialTextPatterns.some((pat) => pat.test(text));
        }

        // Extract tweet ID from various formats
        function getTweetIdFromElement(el) {
          // Check for twitter-tweet blockquote
          if (
            el.classList?.contains("twitter-tweet") ||
            el.tagName === "BLOCKQUOTE"
          ) {
            const link = el.querySelector(
              'a[href*="twitter.com"][href*="status"]'
            );
            if (link) {
              const match = link.href.match(/status\/(\d{15,20})/);
              if (match && match[1]) return match[1];
            }
          }

          // Check for Twitter iframe
          if (el.tagName === "IFRAME") {
            const src = el.src || "";
            const patterns = [
              /id=(\d{15,20})/,
              /status%2F(\d{15,20})/,
              /status\/(\d{15,20})/,
            ];
            for (const pattern of patterns) {
              const match = src.match(pattern);
              if (match && match[1]) return match[1];
            }
          }

          // Check if element contains a tweet embed
          const tweetBlockquote = el.querySelector("blockquote.twitter-tweet");
          if (tweetBlockquote) {
            const link = tweetBlockquote.querySelector(
              'a[href*="twitter.com"][href*="status"]'
            );
            if (link) {
              const match = link.href.match(/status\/(\d{15,20})/);
              if (match && match[1]) return match[1];
            }
          }

          const tweetIframe = el.querySelector(
            'iframe[src*="twitter.com"], iframe[src*="platform.twitter"]'
          );
          if (tweetIframe) {
            const src = tweetIframe.src || "";
            const patterns = [
              /id=(\d{15,20})/,
              /status%2F(\d{15,20})/,
              /status\/(\d{15,20})/,
            ];
            for (const pattern of patterns) {
              const match = src.match(pattern);
              if (match && match[1]) return match[1];
            }
          }

          return null;
        }

        // Extract Instagram ID from element
        function getInstagramIdFromElement(el) {
          // Check for instagram-media blockquote
          if (
            el.classList?.contains("instagram-media") ||
            el.tagName === "BLOCKQUOTE"
          ) {
            const link = el.querySelector(
              'a[href*="instagram.com/p/"], a[href*="instagram.com/reel/"]'
            );
            if (link) {
              const match = link.href.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/);
              if (match && match[2]) return { id: match[2], type: match[1] };
            }
          }

          // Check for Instagram iframe
          if (el.tagName === "IFRAME") {
            const src = el.src || "";
            const match = src.match(
              /instagram\.com\/(p|reel)\/([A-Za-z0-9_-]+)/
            );
            if (match && match[2]) return { id: match[2], type: match[1] };
          }

          // Check if element contains an Instagram embed
          const igBlockquote = el.querySelector("blockquote.instagram-media");
          if (igBlockquote) {
            const link = igBlockquote.querySelector(
              'a[href*="instagram.com/p/"], a[href*="instagram.com/reel/"]'
            );
            if (link) {
              const match = link.href.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/);
              if (match && match[2]) return { id: match[2], type: match[1] };
            }
          }

          const igIframe = el.querySelector('iframe[src*="instagram.com"]');
          if (igIframe) {
            const src = igIframe.src || "";
            const match = src.match(
              /instagram\.com\/(p|reel)\/([A-Za-z0-9_-]+)/
            );
            if (match && match[2]) return { id: match[2], type: match[1] };
          }

          return null;
        }

        // Convert paragraph to markdown with formatting
        function paragraphToMarkdown(el) {
          let text = "";
          el.childNodes.forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE) {
              text += node.textContent;
            } else if (node.nodeName === "STRONG" || node.nodeName === "B") {
              text += "**" + node.textContent + "**";
            } else if (node.nodeName === "EM" || node.nodeName === "I") {
              text += "_" + node.textContent + "_";
            } else if (node.nodeName === "A") {
              const href = node.getAttribute("href");
              const linkText = node.textContent?.trim();
              if (href && linkText && !href.startsWith("#")) {
                const fullUrl = href.startsWith("http")
                  ? href
                  : "https://www.espncricinfo.com" + href;
                text += "[" + linkText + "](" + fullUrl + ")";
              } else {
                text += node.textContent || "";
              }
            } else if (node.nodeName === "DIV" || node.nodeName === "SPAN") {
              // Recursively process nested content
              node.childNodes.forEach((nestedNode) => {
                if (nestedNode.nodeType === Node.TEXT_NODE) {
                  text += nestedNode.textContent;
                } else if (nestedNode.nodeName === "A") {
                  const href = nestedNode.getAttribute("href");
                  const linkText = nestedNode.textContent?.trim();
                  if (href && linkText && !href.startsWith("#")) {
                    const fullUrl = href.startsWith("http")
                      ? href
                      : "https://www.espncricinfo.com" + href;
                    text += "[" + linkText + "](" + fullUrl + ")";
                  } else {
                    text += nestedNode.textContent || "";
                  }
                } else if (
                  nestedNode.nodeName === "STRONG" ||
                  nestedNode.nodeName === "B"
                ) {
                  text += "**" + nestedNode.textContent + "**";
                } else if (
                  nestedNode.nodeName === "EM" ||
                  nestedNode.nodeName === "I"
                ) {
                  text += "_" + nestedNode.textContent + "_";
                } else {
                  text += nestedNode.textContent || "";
                }
              });
            } else {
              text += node.textContent || "";
            }
          });
          return text;
        }

        // Convert list to markdown
        function listToMarkdown(el, ordered) {
          const items = el.querySelectorAll("li");
          const listItems = [];
          items.forEach((li, idx) => {
            const itemText = li.textContent.trim();
            if (itemText) {
              listItems.push(
                ordered ? idx + 1 + ". " + itemText : "- " + itemText
              );
            }
          });
          return listItems.join("\n");
        }

        // Convert table to markdown
        function tableToMarkdown(el) {
          const rows = el.querySelectorAll("tr");
          if (rows.length === 0) return "";

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

          return tableRows.length > 1 ? "\n" + tableRows.join("\n") + "\n" : "";
        }

        // ========== ENHANCED CONTENT EXTRACTION WITH INLINE EMBEDS ==========
        const contentParts = [];
        const seenText = new Set();

        const article =
          document.querySelector("article") || document.querySelector("main");

        if (article) {
          // Get all relevant elements in document order (including Datawrapper iframes for inline tables)
          const elements = article.querySelectorAll(
            "h1, h2, h3, h4, p, ul, ol, table, blockquote.twitter-tweet, blockquote[class*='twitter'], div[class*='twitter'], iframe[src*='twitter'], iframe[src*='platform.twitter'], blockquote.instagram-media, blockquote[class*='instagram'], iframe[src*='instagram'], iframe[src*='datawrapper']"
          );

          elements.forEach((el) => {
            // Check for tweet embed
            const tweetId = getTweetIdFromElement(el);
            if (tweetId && !seenTweetIds.has(tweetId)) {
              seenTweetIds.add(tweetId);
              result.embeddedTweets.push({
                id: tweetId,
                url: `https://twitter.com/i/status/${tweetId}`,
              });
              contentParts.push(`[TWEET:${tweetId}]`);
              return;
            }

            // Check for Instagram embed
            const instagramData = getInstagramIdFromElement(el);
            if (instagramData && !seenInstagramIds.has(instagramData.id)) {
              seenInstagramIds.add(instagramData.id);
              result.embeddedInstagram.push({
                id: instagramData.id,
                type: instagramData.type,
                url: `https://www.instagram.com/${instagramData.type}/${instagramData.id}/`,
              });
              contentParts.push(`[INSTAGRAM:${instagramData.id}]`);
              return;
            }

            // Check for Datawrapper iframe (interactive tables)
            if (el.tagName === "IFRAME") {
              const src = el.src || "";
              if (src.includes("datawrapper.dwcdn.net")) {
                const match = src.match(/datawrapper\.dwcdn\.net\/([^/]+)/);
                if (match && match[1]) {
                  const dwId = match[1];
                  // Add placeholder to be replaced with actual table during post-processing
                  contentParts.push(`[DATAWRAPPER:${dwId}:${src}]`);
                  // Also track for extraction
                  result.datawrapperIframes.push({
                    id: dwId,
                    url: src,
                  });
                }
                return;
              }
            }

            // Skip if inside social embed container
            if (
              el.closest(
                "blockquote.twitter-tweet, [class*='twitter-tweet'], blockquote.instagram-media, [class*='instagram-media']"
              )
            ) {
              return;
            }

            let text = "";

            if (el.tagName === "P") {
              text = paragraphToMarkdown(el);
            } else if (el.tagName.match(/^H[1-4]$/)) {
              const level = parseInt(el.tagName[1]);
              text = "#".repeat(level) + " " + el.textContent.trim();
            } else if (el.tagName === "UL") {
              text = listToMarkdown(el, false);
            } else if (el.tagName === "OL") {
              text = listToMarkdown(el, true);
            } else if (el.tagName === "TABLE") {
              text = tableToMarkdown(el);
            }

            text = text.trim();

            // Skip if empty, too short, or boilerplate
            if (!text || text.length < 20) return;
            const isBoilerplate = skipPatterns.some((pat) => pat.test(text));
            if (isBoilerplate && text.length < 150) return;

            // Skip social text fragments
            if (isSocialTextFragment(text)) return;

            // Avoid duplicate content
            if (
              seenText.has(text) ||
              contentParts.some((p) => p.includes(text) || text.includes(p))
            )
              return;
            seenText.add(text);

            contentParts.push(text);
          });
        }

        // Fallback: scan for any missed social embeds
        document
          .querySelectorAll(
            'iframe[src*="twitter.com"], iframe[src*="platform.twitter"]'
          )
          .forEach((iframe) => {
            const src = iframe.src || "";
            const patterns = [
              /id=(\d{15,20})/,
              /status%2F(\d{15,20})/,
              /status\/(\d{15,20})/,
            ];

            for (const pattern of patterns) {
              const match = src.match(pattern);
              if (match && match[1] && !seenTweetIds.has(match[1])) {
                seenTweetIds.add(match[1]);
                result.embeddedTweets.push({
                  id: match[1],
                  url: `https://twitter.com/i/status/${match[1]}`,
                });
                if (
                  !contentParts.some((p) => p.includes(`[TWEET:${match[1]}]`))
                ) {
                  contentParts.push(`[TWEET:${match[1]}]`);
                }
                break;
              }
            }
          });

        // Scan for missed Instagram embeds
        document
          .querySelectorAll(
            'blockquote.instagram-media, [class*="instagram-media"], iframe[src*="instagram.com"]'
          )
          .forEach((el) => {
            let igId = null;
            let igType = "p";

            const link = el.querySelector(
              'a[href*="instagram.com/p/"], a[href*="instagram.com/reel/"]'
            );
            if (link) {
              const match = link.href.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/);
              if (match && match[2]) {
                igId = match[2];
                igType = match[1];
              }
            }

            if (!igId && el.tagName === "IFRAME") {
              const src = el.src || "";
              const match = src.match(
                /instagram\.com\/(p|reel)\/([A-Za-z0-9_-]+)/
              );
              if (match && match[2]) {
                igId = match[2];
                igType = match[1];
              }
            }

            if (igId && !seenInstagramIds.has(igId)) {
              seenInstagramIds.add(igId);
              result.embeddedInstagram.push({
                id: igId,
                type: igType,
                url: `https://www.instagram.com/${igType}/${igId}/`,
              });
              if (
                !contentParts.some((p) => p.includes(`[INSTAGRAM:${igId}]`))
              ) {
                contentParts.push(`[INSTAGRAM:${igId}]`);
              }
            }
          });

        // Fallback to plain paragraph extraction if no content found
        if (contentParts.length === 0) {
          const paragraphs = document.querySelectorAll(
            "article p, [class*='content'] p, main p"
          );
          paragraphs.forEach((p) => {
            const text = p.textContent.trim();
            if (text && text.length > 50 && !isSocialTextFragment(text)) {
              contentParts.push(text);
            }
          });
        }

        // Use JSON-LD articleBody as last fallback
        if (contentParts.length === 0 && result.jsonLd?.articleBody) {
          contentParts.push(result.jsonLd.articleBody);
        }

        result.contentParagraphs = contentParts;
        result.content = contentParts.join("\n\n");

        // ========== TAGS ==========
        const tags = [];
        document
          .querySelectorAll('meta[property="article:tag"]')
          .forEach((el) => {
            const tag = el.content;
            if (tag && !tags.includes(tag)) tags.push(tag);
          });
        result.tags = tags.slice(0, 8);

        // ========== KEYWORDS ==========
        const kw =
          document.querySelector('meta[name="keywords"]')?.content ||
          result.jsonLd?.keywords ||
          "";
        result.keywords =
          typeof kw === "string"
            ? kw
              .split(",")
              .map((k) => k.trim())
              .filter((k) => k)
            : [];

        // ========== RELATED ARTICLES ==========
        const related = [];
        const seenUrls = new Set();
        document
          .querySelectorAll(
            '[class*="related"] a[href*="/story/"], aside a[href*="/story/"]'
          )
          .forEach((el) => {
            const href = el.href;
            const title = el.textContent?.trim();
            if (href && title && title.length > 10 && !seenUrls.has(href)) {
              seenUrls.add(href);
              related.push({ title, url: href });
            }
          });
        result.relatedArticles = related.slice(0, 5);

        // NOTE: Datawrapper iframes are now detected inline during content extraction
        // and populated in result.datawrapperIframes with [DATAWRAPPER:ID:URL] placeholders in content

        return result;
      });

      // Post-process dates
      const details = {
        title: rawData.title,
        description: rawData.description,
        publishedTime: this.parseDate(rawData.publishedTime),
        modifiedTime: this.parseDate(rawData.modifiedTime),
        author: rawData.author,
        mainImage: rawData.mainImage,
        content: rawData.content,
        contentParagraphs: rawData.contentParagraphs,
        contentLength: rawData.content.length,
        wordCount: rawData.content.split(/\s+/).filter((w) => w).length,
        tags: rawData.tags,
        keywords: rawData.keywords,
        relatedArticles: rawData.relatedArticles,
        embeddedTweets: rawData.embeddedTweets.slice(0, 10),
        embeddedInstagram: rawData.embeddedInstagram.slice(0, 10),
        url: articleUrl,
        scrapedAt: new Date().toISOString(),
      };

      // ========== DATAWRAPPER TABLE EXTRACTION (INLINE REPLACEMENT) ==========
      // Find all [DATAWRAPPER:ID:URL] placeholders and replace with actual tables
      const datawrapperPlaceholders =
        details.content.match(/\[DATAWRAPPER:([^:]+):([^\]]+)\]/g) || [];

      if (datawrapperPlaceholders.length > 0) {
        console.log(
          `   📊 Found ${datawrapperPlaceholders.length} Datawrapper tables, extracting...`
        );

        const maxTables = 5; // Limit for performance
        let extractedCount = 0;

        for (const placeholder of datawrapperPlaceholders) {
          if (extractedCount >= maxTables) {
            // Remove remaining placeholders without extracting
            details.content = details.content.replace(
              placeholder,
              "[Table data not available]"
            );
            continue;
          }

          // Parse the placeholder: [DATAWRAPPER:ID:URL]
          const match = placeholder.match(/\[DATAWRAPPER:([^:]+):([^\]]+)\]/);
          if (!match) continue;

          const [, dwId, dwUrl] = match;
          console.log(
            `   📊 Extracting table ${extractedCount + 1}/${Math.min(
              datawrapperPlaceholders.length,
              maxTables
            )}: ${dwId}`
          );

          const tableMarkdown = await this.extractDatawrapperTable(dwUrl);

          if (tableMarkdown) {
            // Replace placeholder with actual table (inline, no header)
            details.content = details.content.replace(
              placeholder,
              tableMarkdown
            );
            extractedCount++;
          } else {
            // Remove placeholder if extraction failed
            details.content = details.content.replace(
              placeholder,
              "[Table data not available]"
            );
          }
        }

        // Update content stats
        details.contentLength = details.content.length;
        details.wordCount = details.content
          .split(/\s+/)
          .filter((w) => w).length;

        console.log(`   ✅ Extracted ${extractedCount} tables inline`);
      }

      // Log summary
      const embedSummary = [];
      if (details.embeddedTweets.length > 0)
        embedSummary.push(`${details.embeddedTweets.length} tweets`);
      if (details.embeddedInstagram.length > 0)
        embedSummary.push(`${details.embeddedInstagram.length} IG`);

      console.log(
        `   ✓ ${details.wordCount} words${embedSummary.length ? `, ${embedSummary.join(", ")}` : ""
        }, published: ${details.publishedTime || "unknown"}`
      );

      return details;
    } finally {
      await page.close();
    }
  }

  /**
   * Fetch news with full content extraction
   * Includes retry logic for connection failures
   */
  async fetchLatestNewsWithDetails(limit = 5) {
    await this.init();

    const MAX_RETRIES = 2;
    const BASE_RETRY_DELAY = 3000;

    try {
      const articles = await this.fetchLatestNews();
      const detailed = [];

      if (articles.length === 0) {
        console.log("⚠️ No articles found");
        return [];
      }

      const toProcess = Math.min(limit, articles.length);
      console.log(`\n📚 Scraping ${toProcess} articles for full content...\n`);

      for (let i = 0; i < toProcess; i++) {
        const article = articles[i];
        const shortTitle = article.title.substring(0, 50);
        console.log(`${i + 1}/${toProcess} - ${shortTitle}...`);

        let success = false;
        let lastError = null;

        // Retry loop for connection errors
        for (let attempt = 0; attempt <= MAX_RETRIES && !success; attempt++) {
          try {
            if (attempt > 0) {
              const retryDelay = BASE_RETRY_DELAY * Math.pow(1.5, attempt - 1);
              console.log(`   ⚠️ Article fetch failed, retrying in ${retryDelay / 1000}s...`);
              await this.delay(retryDelay);
            }

            const details = await this.fetchArticleDetails(article.link);

            detailed.push({
              ...article,
              // Override with cleaned title from details
              title: details.title || article.title,
              details,
            });

            success = true;

            // Rate limiting
            await this.delay(1000);
          } catch (error) {
            lastError = error;
            const isRetryable =
              error.message.includes("Connection closed") ||
              error.message.includes("Navigation") ||
              error.message.includes("timeout") ||
              error.message.includes("net::") ||
              error.message.includes("detached");

            if (!isRetryable || attempt >= MAX_RETRIES) {
              console.log(`   ❌ Error: ${error.message.substring(0, 50)}`);
              console.log(`   Skipping article due to error: ${error.message}`);
              detailed.push(article);
              break;
            }
          }
        }
      }

      console.log(`\n✅ Scraped ${detailed.length} articles`);
      return detailed;
    } catch (error) {
      console.error("❌ Error:", error.message);
      throw error;
    }
  }

  /**
   * Export to JSON
   */
  async exportToJson(data, filename = "espncricinfo-puppeteer-results.json") {
    const fs = require("fs").promises;
    await fs.writeFile(filename, JSON.stringify(data, null, 2));
    console.log(`💾 Saved to ${filename}`);
  }

  /**
   * Format for console output
   */
  formatNews(articles) {
    let out = "\n" + "═".repeat(75) + "\n";
    out += "   🏏 ESPN CRICINFO NEWS - PUPPETEER SCRAPER RESULTS\n";
    out += "═".repeat(75) + "\n\n";

    articles.forEach((art, i) => {
      out += `${i + 1}. ${art.title}\n`;
      out += "─".repeat(75) + "\n";

      if (art.details) {
        out += `   📅 Published: ${art.details.publishedTime || "Unknown"}\n`;
        out += `   ✍️  Author: ${art.details.author || "Unknown"}\n`;
        out += `   📊 Words: ${art.details.wordCount}\n`;
        out += `   🔗 ${art.url}\n`;

        if (art.details.contentParagraphs?.length > 0) {
          out += `\n   📝 Content Preview:\n`;
          const preview = art.details.contentParagraphs[0].substring(0, 300);
          out += `   "${preview}..."\n`;
        }

        if (art.details.keywords?.length > 0) {
          out += `\n   🏷️  Keywords: ${art.details.keywords
            .slice(0, 5)
            .join(", ")}\n`;
        }
      } else {
        out += `   ⚠️ Details not scraped\n`;
        out += `   🔗 ${art.url}\n`;
      }

      out += "\n";
    });

    return out;
  }
}

// ==================== MAIN ====================
async function main() {
  const scraper = new ESPNCricinfoPuppeteerScraper();

  try {
    console.log("\n🚀 ESPN Cricinfo Puppeteer Scraper - Improved Version\n");
    console.log("━".repeat(60));

    const articles = await scraper.fetchLatestNewsWithDetails(5);

    console.log(scraper.formatNews(articles));

    await scraper.exportToJson(articles);

    // Summary
    const withDetails = articles.filter((a) => a.details?.content);
    const avgWords =
      withDetails.length > 0
        ? Math.round(
          withDetails.reduce((s, a) => s + (a.details?.wordCount || 0), 0) /
          withDetails.length
        )
        : 0;

    console.log("━".repeat(60));
    console.log("📊 SUMMARY:");
    console.log(`   Articles scraped: ${articles.length}`);
    console.log(`   With full content: ${withDetails.length}`);
    console.log(`   Avg word count: ${avgWords}`);
    console.log("━".repeat(60));
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  } finally {
    await scraper.close();
  }
}

module.exports = ESPNCricinfoPuppeteerScraper;

if (require.main === module) {
  main();
}
