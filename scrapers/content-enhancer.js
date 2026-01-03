/**
 * Content Enhancer - ChatGPT Batch Processing
 *
 * Enhances raw scraped articles with SEO-optimized content using ChatGPT.
 * Generates markdown content that reads like human-written sports journalism.
 *
 * Usage: node scrapers/content-enhancer.js
 *
 * Features:
 * - Fetches unprocessed articles from database
 * - Sends batch to ChatGPT (5 articles per request)
 * - Saves enhanced content to EnhancedContent table
 * - Human-like interaction with anti-detection measures
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");

// Puppeteer with stealth plugin
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  COOKIES_PATH: path.join(
    __dirname,
    "../cookies/chatgpt.com.cookies_shanuvatika.json"
  ),
  // ChatGPT Project URL with pre-defined instructions
  CHATGPT_URL:
    "https://chatgpt.com/g/g-p-6957dea9e04c8191ba848db022b0eab9/project",
  HEADLESS: true,
  BATCH_SIZE: 2, // Articles per batch
  RESPONSE_WAIT_MS: 120000, // 120 seconds for response (project may need time to load)
  CONTENT_MAX_LENGTH: 600, // More content for context
  RATE_LIMIT_DELAY_MS: 30000, // 30 seconds between batches
};

// Find Chromium
const CHROMIUM_PATHS = [
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
  "/snap/bin/chromium",
].filter(Boolean);

function findChromiumPath() {
  for (const p of CHROMIUM_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("Chromium not found");
}

// Human-like utilities
function randomDelay(min, max) {
  return new Promise((r) =>
    setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min)
  );
}

async function humanMouseMove(page, x, y) {
  await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 5) + 5 });
}

// ============================================
// DATABASE FUNCTIONS
// ============================================

/**
 * Fetch articles that don't have enhanced content yet
 */
async function fetchUnprocessedArticles(prisma, limit = 5) {
  console.log(`\n📊 Fetching up to ${limit} unprocessed articles...`);

  const articles = await prisma.newsArticle.findMany({
    where: {
      enhancedContent: null, // No enhanced content yet
    },
    take: limit,
    orderBy: { scrapedAt: "desc" },
    select: {
      id: true,
      title: true,
      description: true,
      content: true,
      sourceName: true,
      tags: true,
      slug: true,
    },
  });

  console.log(`✅ Found ${articles.length} articles to enhance`);
  return articles;
}

/**
 * Save enhanced content to database
 */
async function saveEnhancedContent(prisma, articleId, enhancedData) {
  try {
    await prisma.enhancedContent.create({
      data: {
        articleId: articleId,
        title: enhancedData.enhancedTitle,
        content: enhancedData.enhancedContent,
        metaDescription: enhancedData.metaDescription,
        keyTakeaways: enhancedData.keyTakeaways || [],
        status: "completed",
      },
    });
    return true;
  } catch (error) {
    console.error(
      `   ❌ Failed to save enhanced content for ${articleId}: ${error.message}`
    );
    return false;
  }
}

// ============================================
// CHATGPT FUNCTIONS
// ============================================

/**
 * Build prompt for markdown sports journalism content
 */
function buildEnhancementPrompt(articles) {
  // Simple data-only prompt - project has all instructions
  const inputArticles = articles.map((a) => ({
    id: a.id,
    title: a.title,
    source: a.sourceName,
    content: (a.content || a.description || "").substring(
      0,
      CONFIG.CONTENT_MAX_LENGTH
    ),
  }));

  // Prompt with JSON reminder (project has style instructions)
  const prompt = `RESPOND WITH JSON ONLY. First char: [

${JSON.stringify(inputArticles, null, 2)}

Output format:
[{"id":"${
    articles[0]?.id
  }","enhancedTitle":"...","enhancedContent":"markdown with ### > ** |","metaDescription":"...","keyTakeaways":["...","...","..."]}]

[`;

  console.log(`\n📝 Built enhancement prompt for ${articles.length} articles`);
  console.log(`   Prompt length: ${prompt.length} characters`);
  console.log(`   📌 Using ChatGPT Project with pre-defined instructions`);

  return prompt;
}

/**
 * Send batch to ChatGPT and get response
 */
async function sendBatchToChatGPT(page, prompt) {
  console.log("\n🤖 Sending batch to ChatGPT...");

  // Find input element
  const inputSelectors = ["#prompt-textarea", "textarea"];
  let inputElement = null;

  for (const selector of inputSelectors) {
    try {
      await page.waitForSelector(selector, { timeout: 5000 });
      inputElement = await page.$(selector);
      if (inputElement) break;
    } catch {
      continue;
    }
  }

  if (!inputElement) throw new Error("Could not find input field");

  // Human-like delay before starting
  await randomDelay(1000, 2000);

  // Click to focus
  const box = await inputElement.boundingBox();
  if (box) {
    await humanMouseMove(page, box.x + box.width / 2, box.y + box.height / 2);
    await randomDelay(200, 400);
  }
  await inputElement.click();
  await randomDelay(300, 600);

  // Type the prompt with human-like speed
  console.log(`   ⌨️  Typing ${prompt.length} characters...`);
  const CHUNK_SIZE = 200;
  for (let i = 0; i < prompt.length; i += CHUNK_SIZE) {
    const chunk = prompt.slice(i, i + CHUNK_SIZE);
    const delay = Math.floor(Math.random() * 15) + 10;
    await inputElement.type(chunk, { delay });

    // Random micro-pause
    if (Math.random() < 0.2) {
      await randomDelay(100, 300);
    }
  }

  // Wait before sending
  await randomDelay(500, 1000);

  // Click send button
  const sendButton = await page.$('button[data-testid="send-button"]');
  if (sendButton) {
    const btnBox = await sendButton.boundingBox();
    if (btnBox) {
      await humanMouseMove(
        page,
        btnBox.x + btnBox.width / 2,
        btnBox.y + btnBox.height / 2
      );
      await randomDelay(100, 200);
    }
    await sendButton.click();
    console.log("   📤 Sent!");
  } else {
    await page.keyboard.down("Control");
    await page.keyboard.press("Enter");
    await page.keyboard.up("Control");
    console.log("   📤 Sent via Ctrl+Enter");
  }

  // Wait for response (longer for markdown content)
  console.log(
    `   ⏳ Waiting ${CONFIG.RESPONSE_WAIT_MS / 1000}s for response...`
  );
  await new Promise((r) => setTimeout(r, CONFIG.RESPONSE_WAIT_MS));

  // Extract response
  const response = await page.evaluate(() => {
    const selectors = [
      '[data-message-author-role="assistant"] .markdown',
      '[data-message-author-role="assistant"]',
      ".prose",
      ".markdown",
    ];

    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        const text = els[els.length - 1].innerText;
        if (text && text.length > 100) return text.trim();
      }
    }

    const bodyText = document.body.innerText;
    const jsonMatch = bodyText.match(/\[\s*\{[\s\S]*?\}\s*\]/);
    if (jsonMatch) return jsonMatch[0];

    return null;
  });

  return response;
}

/**
 * Parse JSON response from ChatGPT
 * Handles improperly escaped strings (newlines, quotes in block quotes)
 */
function parseEnhancedContent(response) {
  if (!response) {
    console.log("   ❌ No response received");
    return null;
  }

  console.log(`\n📥 Response received (${response.length} chars)`);

  try {
    let jsonStr = response;

    // Remove markdown code blocks if present
    const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1];
    }

    // Find JSON array in text
    const arrayMatch = jsonStr.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (arrayMatch) {
      jsonStr = arrayMatch[0];
    }

    // First try direct parse
    try {
      const direct = JSON.parse(jsonStr);
      if (Array.isArray(direct)) {
        console.log(
          `   ✅ Successfully parsed ${direct.length} enhanced articles`
        );
        return direct;
      }
    } catch (directErr) {
      console.log("   ⚠️ Direct parse failed, fixing JSON...");
    }

    // State machine to fix JSON
    let fixed = "";
    let inString = false;

    for (let i = 0; i < jsonStr.length; i++) {
      const char = jsonStr[i];
      const prevChar = i > 0 ? jsonStr[i - 1] : "";

      // Track string boundaries (unescaped quote)
      if (char === '"' && prevChar !== "\\") {
        inString = !inString;
        fixed += char;
        continue;
      }

      // Inside a string, escape problematic characters
      if (inString) {
        if (char === "\n") {
          fixed += "\\n";
        } else if (char === "\r") {
          fixed += "\\r";
        } else if (char === "\t") {
          fixed += "\\t";
        } else {
          fixed += char;
        }
      } else {
        fixed += char;
      }
    }

    const parsed = JSON.parse(fixed.trim());

    if (Array.isArray(parsed)) {
      console.log(
        `   ✅ Successfully parsed ${parsed.length} enhanced articles`
      );
      return parsed;
    } else {
      console.log("   ⚠️ Response is not an array");
      return null;
    }
  } catch (error) {
    console.log(`   ❌ JSON parse error: ${error.message}`);

    // Save raw response for debugging
    const debugPath = path.join(
      __dirname,
      "../debug-screenshots/enhance-response.txt"
    );
    fs.writeFileSync(debugPath, response || "No response");
    console.log(`   📄 Raw response saved to: ${debugPath}`);

    return null;
  }
}

// ============================================
// MAIN FUNCTION
// ============================================

async function runContentEnhancer() {
  console.log(
    "\n╔════════════════════════════════════════════════════════════╗"
  );
  console.log(
    "║       Content Enhancer - ChatGPT Batch Processing           ║"
  );
  console.log("╠════════════════════════════════════════════════════════════╣");
  console.log(`║  Started: ${new Date().toISOString()}              ║`);
  console.log("╚════════════════════════════════════════════════════════════╝");

  let browser, page, pool, prisma;
  let successCount = 0;
  let failCount = 0;

  try {
    // Initialize database
    const connectionString = process.env.DATABASE_URL;
    pool = new Pool({
      connectionString,
      max: 3,
      idleTimeoutMillis: 30000,
    });
    prisma = new PrismaClient({
      adapter: new PrismaPg(pool),
    });

    // Step 1: Fetch unprocessed articles
    const articles = await fetchUnprocessedArticles(prisma, CONFIG.BATCH_SIZE);

    if (articles.length === 0) {
      console.log("\n✅ No articles need enhancement. All caught up!");
      return;
    }

    // Show articles to be processed
    console.log("\n📰 Articles to enhance:");
    articles.forEach((a, i) => {
      console.log(
        `   ${i + 1}. [${a.id.substring(0, 8)}...] ${a.title.substring(
          0,
          50
        )}...`
      );
    });

    // Step 2: Build prompt
    const prompt = buildEnhancementPrompt(articles);

    // Step 3: Initialize browser
    console.log("\n🌐 Initializing ChatGPT session...");

    if (!fs.existsSync(CONFIG.COOKIES_PATH)) {
      throw new Error(`Cookies not found: ${CONFIG.COOKIES_PATH}`);
    }

    browser = await puppeteer.launch({
      headless: CONFIG.HEADLESS ? "new" : false,
      executablePath: findChromiumPath(),
      defaultViewport: { width: 1280, height: 800 },
      protocolTimeout: 180000,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--single-process",
      ],
    });

    page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
    );

    // Load cookies
    const cookies = JSON.parse(
      await fs.promises.readFile(CONFIG.COOKIES_PATH, "utf-8")
    );
    await page.setCookie(...cookies);
    console.log(`   ✅ Loaded ${cookies.length} cookies`);

    // Navigate to ChatGPT
    await page.goto(CONFIG.CHATGPT_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await randomDelay(3000, 5000);
    console.log("   ✅ ChatGPT loaded");
    console.log("   🤖 Using stealth plugin + human-like behavior");

    // Step 4: Send batch and get response
    const response = await sendBatchToChatGPT(page, prompt);

    // Step 5: Parse response
    const enhancedArticles = parseEnhancedContent(response);

    if (!enhancedArticles || enhancedArticles.length === 0) {
      console.log("\n❌ Failed to get enhanced content from ChatGPT");
      failCount = articles.length;
    } else {
      // Step 6: Save to database
      console.log("\n💾 Saving enhanced content to database...");

      // Match by position (ChatGPT may slightly modify IDs)
      for (let i = 0; i < enhancedArticles.length; i++) {
        const enhanced = enhancedArticles[i];

        // First try exact ID match
        let originalArticle = articles.find((a) => a.id === enhanced.id);

        // If no exact match, try partial ID match (first 8 chars)
        if (!originalArticle && enhanced.id) {
          const partialId = enhanced.id.substring(0, 8);
          originalArticle = articles.find((a) => a.id.startsWith(partialId));
        }

        // If still no match, use position-based matching
        if (!originalArticle && i < articles.length) {
          originalArticle = articles[i];
          console.log(`   📍 Using position-based match for article ${i + 1}`);
        }

        if (originalArticle) {
          // Use the ORIGINAL article ID for database save (not ChatGPT's version)
          const saved = await saveEnhancedContent(
            prisma,
            originalArticle.id,
            enhanced
          );
          if (saved) {
            successCount++;
            console.log(
              `   ✅ Saved: ${enhanced.enhancedTitle?.substring(0, 50)}...`
            );
          } else {
            failCount++;
          }
        } else {
          console.log(`   ⚠️ No matching article for ID: ${enhanced.id}`);
          failCount++;
        }
      }
    }

    // Summary
    console.log(
      "\n╔════════════════════════════════════════════════════════════╗"
    );
    console.log(
      "║                    ENHANCEMENT SUMMARY                      ║"
    );
    console.log(
      "╠════════════════════════════════════════════════════════════╣"
    );
    console.log(
      `║  ✅ Successfully enhanced: ${successCount}                            ║`
    );
    console.log(
      `║  ❌ Failed: ${failCount}                                              ║`
    );
    console.log(
      "╚════════════════════════════════════════════════════════════╝"
    );
  } catch (error) {
    console.log(`\n❌ Enhancement failed: ${error.message}`);
    console.error(error);
  } finally {
    if (browser) {
      console.log("\n🧹 Closing browser...");
      await browser.close();
    }
    if (prisma) {
      await prisma.$disconnect();
    }
    if (pool) {
      await pool.end();
    }
    console.log("✅ Content enhancer completed.");
  }
}

// Run the enhancer
runContentEnhancer();
