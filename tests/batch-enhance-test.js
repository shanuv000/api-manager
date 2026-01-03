/**
 * Batch Content Enhancement Test
 *
 * Tests the batch processing approach:
 * 1. Fetch 5 articles from database
 * 2. Send ONE ChatGPT request with all articles
 * 3. Get JSON response with enhanced content for each article
 * 4. Log results (no DB update in test mode)
 *
 * Usage: node tests/batch-enhance-test.js
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");

// Use puppeteer-extra with stealth plugin
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
  CHATGPT_URL: "https://chatgpt.com",
  HEADLESS: true,
  BATCH_SIZE: 5, // Number of articles to process at once
  RESPONSE_WAIT_MS: 60000, // 60 seconds for batch response (longer for multiple articles)
  CONTENT_MAX_LENGTH: 400, // Truncate content to this length per article
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
// MAIN FUNCTIONS
// ============================================

/**
 * Fetch recent articles from database
 */
async function fetchRecentArticles(prisma, limit = 5) {
  console.log(`\n📊 Fetching ${limit} recent articles from database...`);

  const articles = await prisma.newsArticle.findMany({
    take: limit,
    orderBy: { scrapedAt: "desc" },
    select: {
      id: true,
      title: true,
      description: true,
      content: true,
      sourceName: true,
      tags: true,
    },
  });

  console.log(`✅ Found ${articles.length} articles`);
  return articles;
}

/**
 * Build the batch prompt for ChatGPT
 */
function buildBatchPrompt(articles) {
  // Prepare articles with truncated content
  const inputArticles = articles.map((a) => ({
    id: a.id,
    title: a.title,
    source: a.sourceName,
    content: (a.content || a.description || "").substring(
      0,
      CONFIG.CONTENT_MAX_LENGTH
    ),
  }));

  // Strict JSON-only prompt
  const prompt = `TASK: Enhance ${
    articles.length
  } cricket articles for SEO. OUTPUT MUST BE VALID JSON ONLY.

ARTICLES:
${JSON.stringify(inputArticles, null, 2)}

RULES:
- Output ONLY a JSON array, nothing else
- No markdown, no explanation, no "Here is" text
- Start response with [ and end with ]
- Each object needs: id, enhancedTitle (60 chars max), enhancedContent (200 words), metaDescription (155 chars max), keyTakeaways (3 items)

OUTPUT FORMAT (copy this structure exactly):
[{"id":"${
    articles[0]?.id || "id1"
  }","enhancedTitle":"SEO title here","enhancedContent":"Unique rewritten article...","metaDescription":"Meta description here","keyTakeaways":["point 1","point 2","point 3"]}]

RESPOND WITH ONLY THE JSON ARRAY:`;

  console.log(`\n📝 Built prompt for ${articles.length} articles`);
  console.log(`   Total prompt length: ${prompt.length} characters`);

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

  // Type the prompt (faster for long prompts, but with variation)
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

  // Wait for response (longer for batch)
  console.log(
    `   ⏳ Waiting ${CONFIG.RESPONSE_WAIT_MS / 1000}s for batch response...`
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

    // Fallback: look for JSON in body
    const bodyText = document.body.innerText;
    const jsonMatch = bodyText.match(/\[\s*\{[\s\S]*?\}\s*\]/);
    if (jsonMatch) return jsonMatch[0];

    return null;
  });

  return response;
}

/**
 * Parse the JSON response from ChatGPT
 */
function parseEnhancedContent(response) {
  if (!response) {
    console.log("   ❌ No response received");
    return null;
  }

  console.log(`\n📥 Response received (${response.length} chars)`);
  console.log(`   Preview: ${response.substring(0, 200)}...`);

  try {
    // Try to extract JSON from response (may have markdown code blocks)
    let jsonStr = response;

    // Remove markdown code blocks if present
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    // Find JSON array in text
    const arrayMatch = jsonStr.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (arrayMatch) {
      jsonStr = arrayMatch[0];
    }

    const parsed = JSON.parse(jsonStr.trim());

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
    return null;
  }
}

/**
 * Main test function
 */
async function runBatchEnhanceTest() {
  console.log(
    "\n╔════════════════════════════════════════════════════════════╗"
  );
  console.log(
    "║       Batch Content Enhancement Test                        ║"
  );
  console.log("╠════════════════════════════════════════════════════════════╣");
  console.log(`║  Started: ${new Date().toISOString()}              ║`);
  console.log("╚════════════════════════════════════════════════════════════╝");

  let browser, page, pool, prisma;

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

    // Step 1: Fetch articles
    const articles = await fetchRecentArticles(prisma, CONFIG.BATCH_SIZE);

    if (articles.length === 0) {
      console.log("❌ No articles found in database");
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
    const prompt = buildBatchPrompt(articles);

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

    // Step 4: Send batch and get response
    const response = await sendBatchToChatGPT(page, prompt);

    // Step 5: Parse response
    const enhancedArticles = parseEnhancedContent(response);

    // Step 6: Display results
    if (enhancedArticles && enhancedArticles.length > 0) {
      console.log(
        "\n╔════════════════════════════════════════════════════════════╗"
      );
      console.log(
        "║                    ENHANCED CONTENT RESULTS                 ║"
      );
      console.log(
        "╚════════════════════════════════════════════════════════════╝"
      );

      enhancedArticles.forEach((enhanced, i) => {
        console.log(
          `\n━━━ Article ${i + 1}: ${
            enhanced.id?.substring(0, 8) || "unknown"
          }... ━━━`
        );
        console.log(`📌 Enhanced Title: ${enhanced.enhancedTitle || "N/A"}`);
        console.log(
          `📝 Meta Description: ${enhanced.metaDescription || "N/A"}`
        );
        console.log(
          `📊 Key Takeaways: ${JSON.stringify(enhanced.keyTakeaways || [])}`
        );
        console.log(
          `📄 Content Preview: ${(enhanced.enhancedContent || "").substring(
            0,
            150
          )}...`
        );
      });

      console.log("\n✅ Batch processing successful!");
      console.log(
        `   ${enhancedArticles.length} articles enhanced in a single request`
      );
    } else {
      console.log("\n❌ Failed to parse enhanced content");
      console.log("   Raw response saved for debugging");

      // Save raw response for debugging
      const debugPath = path.join(
        __dirname,
        "../debug-screenshots/batch-response.txt"
      );
      await fs.promises.writeFile(debugPath, response || "No response");
      console.log(`   Saved to: ${debugPath}`);
    }
  } catch (error) {
    console.log(`\n❌ Test failed: ${error.message}`);
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
    console.log("✅ Test completed.");
  }
}

// Run the test
runBatchEnhanceTest();
