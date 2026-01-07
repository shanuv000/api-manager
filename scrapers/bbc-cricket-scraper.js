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
 *
 * Usage: Can be run standalone or imported for integration
 */

const puppeteer = require("puppeteer-core");

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
};

/**
 * BBC Sport Cricket News Scraper
 */
class BBCCricketScraper {
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
   * Fetch the news list from BBC Sport Cricket
   */
  async fetchLatestNews(retryCount = 0) {
    let page;
    const startTime = Date.now();

    try {
      console.log("\n🏏 Fetching BBC Sport Cricket News...\n");

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

      this.log(`Step 2/5: Navigating to ${this.config.CRICKET_URL}...`);
      await page.goto(this.config.CRICKET_URL, {
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
        error.message.includes("net::") ||
        error.message.includes("Connection closed") ||
        error.message.includes("closed");

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
        error.message.includes("net::") ||
        error.message.includes("Connection closed") ||
        error.message.includes("closed");

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
