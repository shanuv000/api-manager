/**
 * IPL T20 News Scraper - Production Module
 *
 * Scrapes news from https://www.iplt20.com/news
 * Uses Puppeteer to handle content loading with rich markdown extraction
 *
 * Features:
 * - News list extraction with numeric ID parsing
 * - Full article content with markdown formatting
 * - Table extraction (player stats, auction data)
 * - Instagram embed detection
 * - PDF document link extraction
 * - Scorecard link extraction
 *
 * Usage: Imported by run-iplt20-scraper.js for database integration
 */

const puppeteer = require("puppeteer-core");

// ===== CONFIGURATION =====
const CONFIG = {
  // URLs
  BASE_URL: "https://www.iplt20.com",
  NEWS_URL: "https://www.iplt20.com/news",

  // Timeout settings (in milliseconds)
  PAGE_LOAD_TIMEOUT: 60000,
  CONTENT_WAIT_TIMEOUT: 3000,
  SCROLL_DELAY: 1500,

  // Retry settings
  MAX_RETRIES: 3,
  RETRY_DELAY: 3000,

  // Scraping settings
  MAX_ARTICLES: 25,
  SCROLL_ITERATIONS: 2,

  // Logging
  VERBOSE_LOGGING: true,
};

/**
 * IPL T20 News Scraper
 */
class IPLT20Scraper {
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
      const fs = require("fs");

      // Find Chromium: prioritize CHROME_PATH env var and system Chromium (ARM64 safe)
      const systemPaths = [
        process.env.CHROME_PATH,
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        "/usr/bin/google-chrome",
      ].filter(Boolean);

      let execPath;
      for (const p of systemPaths) {
        if (fs.existsSync(p)) {
          this.log(`Using system Chromium: ${p}`);
          execPath = p;
          break;
        }
      }

      // Fall back to Puppeteer's bundled Chrome (may not work on ARM64)
      if (!execPath) {
        try {
          const puppeteerLocal = require("puppeteer");
          execPath = puppeteerLocal.executablePath();
        } catch (e) {
          this.log("Puppeteer not found, trying snap Chromium", "warn");
        }
      }

      // Last resort: snap chromium
      if (!execPath && fs.existsSync("/snap/bin/chromium")) {
        execPath = "/snap/bin/chromium";
      }

      if (!execPath) {
        throw new Error("Chromium not found. Install chromium-browser or set CHROME_PATH.");
      }

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
        executablePath: execPath,
      };

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
   * Fetch the news list from IPL T20
   */
  async fetchLatestNews(retryCount = 0) {
    let page;
    const startTime = Date.now();

    try {
      console.log("\n🏏 Fetching IPL T20 News...\n");

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
      const newsArticles = await page.evaluate((maxArticles) => {
        const articles = [];
        const seen = new Set();

        // IPL T20 articles have URLs like /news/{id}/{slug}
        const newsLinks = document.querySelectorAll('a[href*="/news/"]');

        newsLinks.forEach((link) => {
          const href = link.href;
          if (!href || seen.has(href)) return;

          // Extract article ID from URL pattern: /news/{id}/{slug}
          const urlMatch = href.match(/\/news\/(\d+)\/([a-z0-9-]+)$/i);
          if (!urlMatch) return;

          const articleId = urlMatch[1];
          const slug = urlMatch[2];

          // Skip if already seen this ID
          if (seen.has(articleId)) return;
          seen.add(articleId);
          seen.add(href);

          // Navigate up to find article container
          let container = link.parentElement;
          let title = "";
          let publishedTime = "";
          let imageUrl = null;

          // Get title from link text
          let titleFromLink = link.textContent.trim();

          // Clean up title - remove date suffix
          const datePattern = /\d{2}\s+\w{3},\s+\d{4}$/;
          titleFromLink = titleFromLink.replace(datePattern, "").trim();

          // Remove duplicate content (IPL sometimes has title twice)
          const midPoint = Math.floor(titleFromLink.length / 2);
          const firstHalf = titleFromLink.substring(0, midPoint).trim();
          const secondHalf = titleFromLink.substring(midPoint).trim();
          if (firstHalf === secondHalf && firstHalf.length > 15) {
            titleFromLink = firstHalf;
          }

          if (titleFromLink && titleFromLink.length > 10) {
            title = titleFromLink;
          }

          // Search parent elements for more info
          for (let i = 0; i < 6 && container; i++) {
            // Look for title in headings if not found
            if (!title || title.length < 10) {
              const heading = container.querySelector("h1, h2, h3, h4");
              if (heading) {
                const headerText = heading.textContent.trim();
                if (
                  headerText &&
                  headerText.length > 10 &&
                  headerText.length < 250
                ) {
                  title = headerText;
                }
              }
            }

            // Look for date
            if (!publishedTime) {
              // IPL uses format like "09 Dec, 2025"
              const allText = container.textContent;
              const dateMatch = allText.match(
                /(\d{2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec),\s+\d{4})/
              );
              if (dateMatch) {
                publishedTime = dateMatch[1];
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

            container = container.parentElement;
          }

          // Determine category based on title patterns
          let category = "news";
          if (title.toLowerCase().includes("match report")) {
            category = "match-report";
          } else if (
            title.toLowerCase().includes("trade") ||
            title.toLowerCase().includes("retention") ||
            title.toLowerCase().includes("auction")
          ) {
            category = "announcement";
          } else if (title.toLowerCase().includes("code of conduct")) {
            category = "disciplinary";
          }

          // Only add if we have a valid title
          if (title && title.length > 10 && articles.length < maxArticles) {
            articles.push({
              id: articleId,
              slug: slug,
              title: title.substring(0, 250),
              link: href,
              imageUrl: imageUrl || null,
              category: category,
              publishedTime: publishedTime || "",
              source: "IPL T20",
              scrapedAt: new Date().toISOString(),
            });
          }
        });

        // Sort by ID (descending = newest first)
        articles.sort((a, b) => parseInt(b.id) - parseInt(a.id));

        return articles;
      }, this.config.MAX_ARTICLES);

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
        } catch (e) { }
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
        } catch (e) { }
        return this.fetchLatestNews(retryCount + 1);
      }

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
        // ========== TITLE EXTRACTION ==========
        const h2 = document.querySelector("h2");
        const h1 = document.querySelector("h1");
        const title = (h2 || h1)?.textContent.trim() || "";

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

        // ========== PUBLISHED TIME ==========
        let publishedTime = "";
        const bodyText = document.body.textContent;
        const dateMatch = bodyText.match(
          /(\d{2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec),\s+\d{4})/
        );
        if (dateMatch) {
          publishedTime = dateMatch[1];
        }

        // ========== CONTENT EXTRACTION WITH MARKDOWN ==========
        const contentParts = [];
        const main =
          document.querySelector("main") || document.querySelector("article");

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
          /^share$/i,
          /^copy$/i,
          /^home$/i,
          /^news$/i,
          /see more/i,
        ];

        // Headings that indicate we should stop extracting (sidebar sections)
        const stopExtractionHeadings = [
          /^latest\s*news$/i,
          /^related\s*news$/i,
          /^more\s*news$/i,
          /^announcements$/i,
          /^match\s*reports$/i,
          /^team$/i,
          /^about$/i,
          /^guidelines$/i,
          /^contact$/i,
        ];

        // Flag to track if we've hit sidebar sections
        let hitSidebarSection = false;

        if (main) {
          const elements = main.querySelectorAll(
            "h1, h2, h3, h4, p, ul, ol, table, a"
          );

          elements.forEach((el) => {
            // Once we hit a sidebar section, skip all remaining elements
            if (hitSidebarSection) return;

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
                  const boldText = node.textContent.trim();
                  if (boldText) {
                    text += "**" + boldText + "**";
                  }
                } else if (node.nodeName === "EM" || node.nodeName === "I") {
                  const italicText = node.textContent.trim();
                  if (italicText) {
                    text += "_" + italicText + "_";
                  }
                } else if (node.nodeName === "A") {
                  const href = node.getAttribute("href");
                  const linkText = node.textContent.trim();
                  if (href && linkText && !href.startsWith("javascript:")) {
                    const fullHref = href.startsWith("/")
                      ? "https://www.iplt20.com" + href
                      : href;
                    text += "[" + linkText + "](" + fullHref + ")";
                  } else if (linkText) {
                    text += linkText;
                  }
                } else {
                  text += node.textContent || "";
                }
              });
            } else if (el.tagName.match(/^H[1-4]$/)) {
              const headerText = el.textContent.trim();

              // Check if this heading indicates a sidebar section
              for (const pattern of stopExtractionHeadings) {
                if (pattern.test(headerText)) {
                  hitSidebarSection = true;
                  return; // Stop processing this and all subsequent elements
                }
              }

              // Skip if it's the same as main title
              if (headerText === title) return;
              const level = parseInt(el.tagName[1]);
              text = "#".repeat(level) + " " + headerText;
            } else if (el.tagName === "UL") {
              const items = el.querySelectorAll("li");
              const listItems = [];
              items.forEach((li) => {
                const itemText = li.textContent.trim();
                if (itemText && itemText.length > 3) {
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
              // Convert HTML tables to markdown tables
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

                  // Add header separator after first row
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
            }

            text = text.trim();

            // Skip if empty, too short, or contains boilerplate
            if (!text || text.length < 10) return;
            const isBoilerplate = skipPatterns.some((pat) => pat.test(text));
            if (isBoilerplate && text.length < 80) return;

            // Skip short bold-only text (likely duplicate table headers)
            const isBoldOnlyShort =
              /^\*\*[^*]+\*\*$/.test(text) && text.length < 40;
            if (isBoldOnlyShort) return;

            // Skip standalone date-only text (sidebar dates like "30 May, 2025")
            const isStandaloneDate =
              /^\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec),?\s+\d{4}$/i.test(
                text
              );
            if (isStandaloneDate) return;

            // Skip text containing HTML tags or leftover markup
            if (/<[^>]+>/.test(text) || text.includes("<span")) return;

            // Skip text starting with pipe (table fragments or navigation)
            if (/^\s*\|/.test(text)) return;

            // Skip text with excessive whitespace (sidebar navigation)
            if (/\s{10,}/.test(text)) return;

            // Avoid duplicate content
            if (contentParts.some((p) => p.includes(text) || text.includes(p)))
              return;

            contentParts.push(text);
          });
        }

        // ========== INSTAGRAM EMBEDS ==========
        const embeddedInstagram = [];
        const seenInsta = new Set();

        // Look for Instagram links in content
        document
          .querySelectorAll('a[href*="instagram.com"]')
          .forEach((link) => {
            const href = link.href;
            // Extract post ID from various patterns
            const postMatch = href.match(
              /instagram\.com\/(?:p|reel)\/([A-Za-z0-9_-]+)/
            );
            if (postMatch && !seenInsta.has(postMatch[1])) {
              seenInsta.add(postMatch[1]);
              embeddedInstagram.push({
                id: postMatch[1],
                type: href.includes("/reel/") ? "reel" : "post",
                url: `https://www.instagram.com/${href.includes("/reel/") ? "reel" : "p"
                  }/${postMatch[1]}/`,
              });
            }
          });

        // Also check for iframe embeds
        document
          .querySelectorAll('iframe[src*="instagram.com"]')
          .forEach((iframe) => {
            const src = iframe.src;
            const postMatch = src.match(
              /instagram\.com\/(?:p|reel)\/([A-Za-z0-9_-]+)/
            );
            if (postMatch && !seenInsta.has(postMatch[1])) {
              seenInsta.add(postMatch[1]);
              embeddedInstagram.push({
                id: postMatch[1],
                type: src.includes("/reel/") ? "reel" : "post",
                url: `https://www.instagram.com/${src.includes("/reel/") ? "reel" : "p"
                  }/${postMatch[1]}/`,
              });
            }
          });

        // ========== PDF DOCUMENTS ==========
        const pdfLinks = [];
        document.querySelectorAll('a[href*=".pdf"]').forEach((link) => {
          const href = link.href;
          const text = link.textContent.trim() || "Document";
          if (href && !pdfLinks.some((p) => p.url === href)) {
            pdfLinks.push({
              title: text.substring(0, 100),
              url: href,
            });
          }
        });

        // ========== SCORECARD LINKS ==========
        const scorecardLinks = [];
        document.querySelectorAll('a[href*="/match/"]').forEach((link) => {
          const href = link.href;
          const matchPattern = href.match(/\/match\/(\d{4})\/(\d+)/);
          if (matchPattern) {
            scorecardLinks.push({
              year: matchPattern[1],
              matchId: matchPattern[2],
              url: href,
            });
          }
        });

        const fullContent = contentParts.join("\n\n");

        return {
          title,
          seoDescription,
          mainImage,
          publishedTime,
          content: fullContent,
          contentParagraphs: contentParts,
          wordCount: fullContent.split(/\s+/).filter((w) => w).length,
          embeddedInstagram: embeddedInstagram.slice(0, 10),
          pdfLinks: pdfLinks.slice(0, 5),
          scorecardLinks: scorecardLinks.slice(0, 5),
          scrapedAt: new Date().toISOString(),
        };
      });

      const duration = Date.now() - startTime;
      await page.close();

      console.log(
        `   ✓ ${articleDetails.wordCount} words, ${articleDetails.embeddedInstagram?.length || 0
        } IG embeds, published: ${articleDetails.publishedTime || "unknown"}`
      );

      return {
        ...articleDetails,
        url: articleUrl,
      };
    } catch (error) {
      if (page) {
        try {
          await page.close();
        } catch (e) { }
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

module.exports = IPLT20Scraper;
