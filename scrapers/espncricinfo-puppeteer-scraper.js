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

const puppeteer = require("puppeteer-core");

// Find system Chromium executable
const CHROMIUM_PATHS = [
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
  "/snap/bin/chromium",
  process.env.CHROME_PATH,
].filter(Boolean);

function findChromiumPath() {
  const fs = require("fs");
  for (const path of CHROMIUM_PATHS) {
    if (fs.existsSync(path)) {
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
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-plugins",
        "--disable-images", // Don't load images to speed up
        "--blink-settings=imagesEnabled=false",
      ],
      defaultViewport: { width: 1280, height: 800 },
      ...options.launchOptions,
    };

    this.browser = null;
    this.navigationTimeout = options.navigationTimeout || 45000;
  }

  async init() {
    if (!this.browser) {
      console.log("🚀 Launching Puppeteer browser...");
      this.browser = await puppeteer.launch(this.launchOptions);
      console.log("✅ Browser initialized");
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
    } catch (e) {}

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
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

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
   */
  async fetchArticleDetails(articleUrl) {
    await this.init();

    console.log(`📰 Scraping: ${articleUrl.split("/").pop()}`);

    const page = await this.createOptimizedPage();

    try {
      const navSuccess = await this.navigateSafe(page, articleUrl);
      if (!navSuccess) {
        throw new Error("Navigation failed");
      }

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
        };

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
          } catch (e) {}
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

        // ========== CONTENT PARAGRAPHS ==========
        const contentParagraphs = [];
        const seenText = new Set();

        // Content selectors in order of priority
        const contentSelectors = [
          '[class*="article-body"] p',
          '[class*="story-body"] p',
          "article p",
          "main p",
          '[class*="content"] p',
        ];

        // Boilerplate patterns
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

        for (const sel of contentSelectors) {
          const paras = document.querySelectorAll(sel);
          for (const p of paras) {
            const plainText = p.textContent?.trim();
            if (!plainText || plainText.length < 40 || seenText.has(plainText))
              continue;

            const isBoilerplate = skipPatterns.some((pat) =>
              pat.test(plainText)
            );
            if (isBoilerplate && plainText.length < 200) continue;

            seenText.add(plainText);

            // Convert to markdown preserving formatting
            let markdownText = "";
            p.childNodes.forEach((node) => {
              if (node.nodeType === Node.TEXT_NODE) {
                markdownText += node.textContent;
              } else if (node.nodeName === "STRONG" || node.nodeName === "B") {
                markdownText += "**" + node.textContent + "**";
              } else if (node.nodeName === "EM" || node.nodeName === "I") {
                markdownText += "_" + node.textContent + "_";
              } else if (node.nodeName === "A") {
                const href = node.getAttribute("href");
                const linkText = node.textContent?.trim();
                if (href && linkText && !href.startsWith("#")) {
                  // Make relative URLs absolute
                  const fullUrl = href.startsWith("http")
                    ? href
                    : "https://www.espncricinfo.com" + href;
                  markdownText += "[" + linkText + "](" + fullUrl + ")";
                } else {
                  markdownText += node.textContent || "";
                }
              } else if (node.nodeName === "DIV" || node.nodeName === "SPAN") {
                // Handle nested content
                markdownText += node.textContent || "";
              } else {
                markdownText += node.textContent || "";
              }
            });

            contentParagraphs.push(markdownText.trim());
          }

          // Stop if we found enough content
          if (contentParagraphs.length >= 5) break;
        }

        // Also try to get headings
        const headings = [];
        document
          .querySelectorAll("article h2, article h3, main h2, main h3")
          .forEach((h) => {
            const text = h.textContent?.trim();
            if (text && text.length > 5) {
              const level = h.tagName === "H2" ? 2 : 3;
              headings.push({ level, text });
            }
          });

        // Use JSON-LD articleBody as fallback if no paragraphs found
        if (contentParagraphs.length === 0 && result.jsonLd?.articleBody) {
          contentParagraphs.push(result.jsonLd.articleBody);
        }

        result.contentParagraphs = contentParagraphs;
        result.headings = headings;
        result.content = contentParagraphs.join("\n\n");

        // ========== TAGS ==========
        const tags = [];
        document
          .querySelectorAll('meta[property="article:tag"]')
          .forEach((el) => {
            const tag = el.content;
            if (tag && !tags.includes(tag)) tags.push(tag);
          });
        result.tags = tags;

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
        url: articleUrl,
        scrapedAt: new Date().toISOString(),
      };

      console.log(
        `   ✓ ${details.wordCount} words, published: ${
          details.publishedTime || "unknown"
        }`
      );

      return details;
    } finally {
      await page.close();
    }
  }

  /**
   * Fetch news with full content extraction
   */
  async fetchLatestNewsWithDetails(limit = 5) {
    await this.init();

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

        try {
          const details = await this.fetchArticleDetails(article.link);

          detailed.push({
            ...article,
            // Override with cleaned title from details
            title: details.title || article.title,
            details,
          });

          // Rate limiting
          await this.delay(1000);
        } catch (error) {
          console.log(`   ❌ Failed: ${error.message.substring(0, 40)}`);
          detailed.push(article);
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
