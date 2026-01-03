/**
 * ChatGPT Web Automation Test
 *
 * Proof-of-concept test script that:
 * 1. Fetches existing cricket news data from Supabase via Prisma
 * 2. Sends data to ChatGPT web interface using Puppeteer
 * 3. Tests data structuring and blog generation capabilities
 * 4. Validates responses and logs results
 *
 * Usage:
 *   # On a machine with display (local dev):
 *   node tests/chatgpt-automation-test.js
 *
 *   # On a headless server (with xvfb):
 *   xvfb-run --auto-servernum node tests/chatgpt-automation-test.js
 *
 *   # Or use VNC to connect to the server for manual ChatGPT login
 *
 * Prerequisites:
 *   - System Chromium installed (chromium-browser or google-chrome)
 *   - Prisma client configured with Supabase
 *   - Manual ChatGPT login on first run (cookies saved for subsequent runs)
 *   - Display server (X11) or xvfb for headful browser
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");

// Use puppeteer-extra with stealth plugin for anti-detection
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

// Find system Chromium executable
const CHROMIUM_PATHS = [
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
  "/snap/bin/chromium",
  process.env.CHROME_PATH,
].filter(Boolean);

function findChromiumPath() {
  for (const chromePath of CHROMIUM_PATHS) {
    if (fs.existsSync(chromePath)) {
      return chromePath;
    }
  }
  throw new Error(
    "Chromium not found. Please install chromium-browser or set CHROME_PATH."
  );
}

// ============================================
// HUMAN-LIKE BEHAVIOR UTILITIES
// ============================================

/**
 * Random delay between min and max milliseconds (simulates human thinking time)
 */
function randomDelay(minMs, maxMs) {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Human-like typing with variable speed and occasional pauses
 */
async function humanType(element, text, page) {
  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // Variable typing speed (40-120ms per character like human)
    const delay = Math.floor(Math.random() * 80) + 40;
    await element.type(char, { delay });

    // Occasional pause (like thinking or distraction) - 3% chance
    if (Math.random() < 0.03) {
      await randomDelay(500, 1500);
    }

    // Pause after punctuation (like natural reading)
    if ([".", ",", "!", "?", ":"].includes(char)) {
      await randomDelay(100, 300);
    }
  }
}

/**
 * Human-like mouse movement (not perfectly straight)
 */
async function humanMouseMove(page, x, y) {
  const steps = Math.floor(Math.random() * 5) + 5;
  await page.mouse.move(x, y, { steps });
}

/**
 * Random scroll behavior (like reading page)
 */
async function humanScroll(page) {
  const scrollAmount = Math.floor(Math.random() * 300) + 100;
  await page.evaluate((amount) => {
    window.scrollBy(0, amount);
  }, scrollAmount);
  await randomDelay(200, 500);
}

// Configuration
const CONFIG = {
  // Use pre-extracted cookies (from browser extension or manual export)
  COOKIES_PATH: path.join(
    __dirname,
    "../cookies/chatgpt.com.cookies_shanuvatika.json"
  ),
  CHATGPT_URL: "https://chatgpt.com",
  HEADLESS: true,
  DEBUG_SCREENSHOTS: true,
  SCREENSHOTS_DIR: path.join(__dirname, "../debug-screenshots"),

  // Human-like timing (longer delays = more human-like)
  RESPONSE_WAIT_MS: 30000, // 30 seconds for ChatGPT response
  BLOG_RESPONSE_WAIT_MS: 40000, // 40 seconds for longer content
  RATE_LIMIT_DELAY_MS: 60000, // 60 seconds between requests (important!)

  // Anti-detection settings
  MIN_ACTION_DELAY_MS: 1000, // Minimum delay between actions
  MAX_ACTION_DELAY_MS: 3000, // Maximum delay between actions
  MAX_REQUESTS_PER_SESSION: 5, // Limit requests per session to avoid detection
  SAMPLE_SIZE: 3,
};

// Database connection
const connectionString = process.env.DATABASE_URL;

// Initialize pool and Prisma Client (done in main function)
let pool = null;
let prisma = null;

/**
 * Step 1: Fetch sample data from Supabase
 * Uses NewsArticle model (cricket news data)
 */
async function fetchSampleDataFromSupabase() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📊 STEP 1: Fetching Sample Data from Supabase");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  try {
    const articles = await prisma.newsArticle.findMany({
      take: CONFIG.SAMPLE_SIZE,
      where: {
        sport: "cricket",
      },
      orderBy: {
        scrapedAt: "desc",
      },
      select: {
        id: true,
        title: true,
        description: true,
        content: true,
        sourceName: true,
        tags: true,
        publishedTime: true,
      },
    });

    console.log(
      `✅ Retrieved ${articles.length} cricket articles from Supabase`
    );

    if (articles.length === 0) {
      console.log("⚠️  No cricket articles found in database");
      return null;
    }

    // Log article summaries
    articles.forEach((article, index) => {
      console.log(`\n  ${index + 1}. ${article.title.substring(0, 60)}...`);
      console.log(`     Source: ${article.sourceName}`);
      console.log(
        `     Tags: ${article.tags?.slice(0, 3).join(", ") || "N/A"}`
      );
    });

    return articles;
  } catch (error) {
    console.error("❌ Failed to fetch data from Supabase:", error.message);
    throw error;
  }
}

/**
 * Step 2: Initialize ChatGPT session with pre-extracted cookies
 */
async function initializeChatGPTSession() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🌐 STEP 2: Initializing ChatGPT Session");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Check for cookies file first
  if (!fs.existsSync(CONFIG.COOKIES_PATH)) {
    throw new Error(
      `Cookies file not found: ${CONFIG.COOKIES_PATH}\nPlease extract cookies from your browser and save them to this path.`
    );
  }

  console.log(`🍪 Loading cookies from: ${path.basename(CONFIG.COOKIES_PATH)}`);
  console.log(`🖥️  Headless mode: ${CONFIG.HEADLESS ? "ON" : "OFF"}`);

  // Launch browser in headless mode (since we have cookies)
  const browser = await puppeteer.launch({
    headless: CONFIG.HEADLESS ? "new" : false,
    executablePath: findChromiumPath(),
    defaultViewport: { width: 1280, height: 800 },
    protocolTimeout: 120000, // 2 minute timeout
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-software-rasterizer",
      "--disable-crash-reporter",
      "--disable-breakpad",
    ],
  });

  const page = await browser.newPage();

  // Set user agent to appear as a regular browser
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  // Load pre-extracted cookies
  try {
    const cookiesString = await fs.promises.readFile(
      CONFIG.COOKIES_PATH,
      "utf-8"
    );
    const cookies = JSON.parse(cookiesString);
    await page.setCookie(...cookies);
    console.log(`✅ Loaded ${cookies.length} cookies`);
  } catch (error) {
    throw new Error(`Failed to load cookies: ${error.message}`);
  }

  // Navigate to ChatGPT
  console.log("🔗 Navigating to ChatGPT...");
  await page.goto(CONFIG.CHATGPT_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  // === HUMAN-LIKE: Random wait after page load (humans don't interact instantly) ===
  await randomDelay(2000, 5000);

  // === HUMAN-LIKE: Scroll around a bit (like looking at the page) ===
  if (Math.random() < 0.5) {
    await humanScroll(page);
    await randomDelay(500, 1000);
  }

  // === HUMAN-LIKE: Random mouse movement (like reading the page) ===
  await humanMouseMove(
    page,
    Math.floor(Math.random() * 800) + 200,
    Math.floor(Math.random() * 400) + 100
  );
  await randomDelay(500, 1500);

  // Check if logged in
  const isLoggedIn = await checkLoginStatus(page);
  if (!isLoggedIn) {
    throw new Error(
      "Session not valid - cookies may have expired. Please re-extract cookies from your browser."
    );
  }

  console.log("✅ Session active (logged in via cookies)");
  console.log("🤖 Anti-detection: Using stealth plugin + human-like behavior");
  return { browser, page };
}

/**
 * Check if user is logged into ChatGPT
 */
async function checkLoginStatus(page) {
  // Multiple selectors to detect logged-in state
  const loggedInSelectors = [
    "#prompt-textarea",
    'textarea[placeholder*="Message"]',
    "textarea",
    'div[contenteditable="true"]',
    '[data-testid="composer-background"]', // Composer area
  ];

  for (const selector of loggedInSelectors) {
    try {
      await page.waitForSelector(selector, { timeout: 3000 });
      return true;
    } catch {
      continue;
    }
  }

  // Check if we're on a login page
  const url = page.url();
  if (url.includes("/auth/login") || url.includes("login.openai.com")) {
    return false;
  }

  // Last resort: check for any main content
  try {
    await page.waitForSelector('main, [role="main"]', { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Send a message to ChatGPT and wait for response
 */
async function sendMessageToChatGPT(
  page,
  message,
  waitTime = CONFIG.RESPONSE_WAIT_MS
) {
  // Updated selectors for ChatGPT's current interface (2024+)
  const inputSelectors = [
    "#prompt-textarea", // Main prompt textarea
    'textarea[placeholder*="Message"]',
    'textarea[data-id="root"]',
    'div[contenteditable="true"]',
    "textarea",
  ];

  let inputElement = null;
  for (const selector of inputSelectors) {
    try {
      await page.waitForSelector(selector, { timeout: 5000 });
      inputElement = await page.$(selector);
      if (inputElement) {
        console.log(`   📝 Found input using: ${selector}`);
        break;
      }
    } catch {
      continue;
    }
  }

  if (!inputElement) {
    throw new Error("Could not find ChatGPT input field");
  }

  // === HUMAN-LIKE BEHAVIOR: Random delay before starting ===
  await randomDelay(CONFIG.MIN_ACTION_DELAY_MS, CONFIG.MAX_ACTION_DELAY_MS);

  // Get element position and move mouse there (like human)
  const box = await inputElement.boundingBox();
  if (box) {
    await humanMouseMove(page, box.x + box.width / 2, box.y + box.height / 2);
    await randomDelay(200, 500);
  }

  // Click to focus the input
  await inputElement.click();
  await randomDelay(300, 700);

  // === HUMAN-LIKE TYPING ===
  // For shorter messages, use human-like typing with variable speed
  // For longer messages, use faster typing but still with some variation
  console.log(`   ⌨️  Typing ${message.length} chars with human-like speed...`);

  if (message.length <= 200) {
    // Short messages: full human-like typing
    await humanType(inputElement, message, page);
  } else {
    // Longer messages: faster but still with some variation
    const CHUNK_SIZE = 100;
    for (let i = 0; i < message.length; i += CHUNK_SIZE) {
      const chunk = message.slice(i, i + CHUNK_SIZE);
      // Variable delay per character (15-40ms for faster typing)
      const delay = Math.floor(Math.random() * 25) + 15;
      await inputElement.type(chunk, { delay });

      // Random pause between chunks (like thinking)
      if (Math.random() < 0.3) {
        await randomDelay(300, 800);
      }
    }
  }

  // === HUMAN-LIKE PAUSE before sending (like reviewing what you wrote) ===
  await randomDelay(800, 2000);

  // Maybe scroll a bit (humans do this randomly)
  if (Math.random() < 0.2) {
    await humanScroll(page);
  }

  // Send the message - try multiple methods
  const sendButtonSelectors = [
    'button[data-testid="send-button"]',
    'button[data-testid="fruitjuice-send-button"]',
    'button[aria-label*="Send"]',
    'button[class*="send"]',
  ];

  let sent = false;
  for (const selector of sendButtonSelectors) {
    try {
      const sendButton = await page.$(selector);
      if (sendButton) {
        const isDisabled = await sendButton.evaluate((el) => el.disabled);
        if (!isDisabled) {
          // Move mouse to send button before clicking (human-like)
          const buttonBox = await sendButton.boundingBox();
          if (buttonBox) {
            await humanMouseMove(
              page,
              buttonBox.x + buttonBox.width / 2,
              buttonBox.y + buttonBox.height / 2
            );
            await randomDelay(100, 300);
          }
          await sendButton.click();
          sent = true;
          console.log(`   📤 Sent via button: ${selector}`);
          break;
        }
      }
    } catch {
      continue;
    }
  }

  // Fallback: use Ctrl+Enter or Enter
  if (!sent) {
    await randomDelay(200, 500);
    await page.keyboard.down("Control");
    await page.keyboard.press("Enter");
    await page.keyboard.up("Control");
    console.log("   📤 Sent via Ctrl+Enter");
  }

  console.log(`   ⏳ Waiting ${waitTime / 1000}s for response...`);

  // Wait for response to complete
  await new Promise((resolve) => setTimeout(resolve, waitTime));

  // Take debug screenshot if enabled
  if (CONFIG.DEBUG_SCREENSHOTS) {
    if (!fs.existsSync(CONFIG.SCREENSHOTS_DIR)) {
      fs.mkdirSync(CONFIG.SCREENSHOTS_DIR, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const screenshotPath = path.join(
      CONFIG.SCREENSHOTS_DIR,
      `chatgpt-response-${timestamp}.png`
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`   📸 Screenshot saved: ${path.basename(screenshotPath)}`);
  }

  // Extract the response from the last assistant message
  const response = await page.evaluate(() => {
    // Multiple selector strategies for ChatGPT responses (updated for 2024/2025 UI)
    const responseSelectors = [
      // ChatGPT 5.x uses these patterns
      '[data-message-author-role="assistant"] .markdown',
      '[data-message-author-role="assistant"]',
      // Conversation turn patterns
      '[data-testid^="conversation-turn-"]:last-child .markdown',
      '[data-testid^="conversation-turn-"]:last-child',
      // Generic response areas
      ".agent-turn .markdown",
      ".group\\/conversation-turn:last-child .markdown",
      // Prose and markdown classes
      ".prose",
      ".markdown",
      // Fallback: any div with substantial text after "You said"
    ];

    for (const selector of responseSelectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        const lastElement = elements[elements.length - 1];
        const text = lastElement.innerText || lastElement.textContent;
        // Ensure it's not our own message and has enough content
        if (
          text &&
          text.trim().length > 50 &&
          !text.includes("Structure this cricket") &&
          !text.includes("Write a 150-word")
        ) {
          return text.trim();
        }
      }
    }

    // Fallback: Find text after "ChatGPT" or assistant patterns
    const bodyText = document.body.innerText;
    const chatGPTMatch =
      bodyText.match(/ChatGPT said:\s*([\s\S]*?)(?=You said:|$)/i) ||
      bodyText.match(/ChatGPT\s*\n([\s\S]{100,}?)(?=\n\n|$)/);
    if (chatGPTMatch && chatGPTMatch[1]) {
      return chatGPTMatch[1].trim();
    }

    return null;
  });

  // If no response, log available DOM for debugging
  if (!response && CONFIG.DEBUG_SCREENSHOTS) {
    const pageContent = await page.evaluate(() => {
      return document.body.innerText.substring(0, 500);
    });
    console.log(`   🔍 Page preview: ${pageContent.substring(0, 200)}...`);
  }

  return response;
}

/**
 * Step 3: Test data structuring with ChatGPT
 */
async function testDataStructuring(page, articleData) {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🔧 STEP 3: Testing Data Structuring");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Use a shorter, simpler prompt to reduce typing time
  const prompt = `Structure this cricket news as JSON: {"title":"${articleData.title.substring(
    0,
    50
  )}","sentiment":"","topics":[]}. Fill in sentiment and 3 key topics.`;

  console.log(`   📝 Processing: "${articleData.title.substring(0, 50)}..."`);

  const startTime = Date.now();
  const response = await sendMessageToChatGPT(page, prompt);
  const duration = Date.now() - startTime;

  console.log(`   ⏱️  Response received in ${duration}ms`);

  if (response) {
    console.log(`   📥 Response preview: ${response.substring(0, 200)}...`);

    // Try to parse JSON from response
    try {
      // Extract JSON from response (may have markdown code blocks)
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || [
        null,
        response,
      ];
      const jsonStr = jsonMatch[1] || response;
      const parsed = JSON.parse(jsonStr.trim());
      console.log("   ✅ Successfully parsed structured data");
      return { success: true, data: parsed, duration };
    } catch (parseError) {
      console.log("   ⚠️  Could not parse JSON (raw text response)");
      return { success: true, data: response, duration, rawText: true };
    }
  } else {
    console.log("   ❌ No response received");
    return { success: false, error: "No response", duration };
  }
}

/**
 * Step 4: Test blog generation with ChatGPT
 */
async function testBlogGeneration(page, articleData) {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📝 STEP 4: Testing Blog Generation");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Shorter prompt for faster typing
  const prompt = `Write a 150-word cricket blog about: ${articleData.title.substring(
    0,
    60
  )}. Make it engaging and SEO-friendly.`;

  console.log(
    `   📝 Generating blog for: "${articleData.title.substring(0, 50)}..."`
  );

  const startTime = Date.now();
  const response = await sendMessageToChatGPT(
    page,
    prompt,
    CONFIG.BLOG_RESPONSE_WAIT_MS
  );
  const duration = Date.now() - startTime;

  console.log(`   ⏱️  Response received in ${duration}ms`);

  if (response) {
    const wordCount = response.split(/\s+/).length;
    console.log(`   📊 Generated blog: ${wordCount} words`);
    console.log(`   📥 Preview: ${response.substring(0, 200)}...`);
    return { success: true, content: response, wordCount, duration };
  } else {
    console.log("   ❌ No response received");
    return { success: false, error: "No response", duration };
  }
}

/**
 * Step 5: Run the full test suite
 */
async function runChatGPTTests() {
  console.log(
    "\n╔════════════════════════════════════════════════════════════╗"
  );
  console.log("║       ChatGPT Web Automation - Proof of Concept Test       ║");
  console.log("╠════════════════════════════════════════════════════════════╣");
  console.log(`║  Started: ${new Date().toISOString()}              ║`);
  console.log("╚════════════════════════════════════════════════════════════╝");

  let browser = null;
  const results = {
    dataFetch: null,
    sessionInit: null,
    dataStructuring: null,
    blogGeneration: null,
  };

  try {
    // Initialize database connection
    pool = new Pool({
      connectionString: connectionString,
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    prisma = new PrismaClient({
      adapter: new PrismaPg(pool),
    });

    // Step 1: Fetch data from Supabase
    const articles = await fetchSampleDataFromSupabase();
    results.dataFetch = { success: !!articles, count: articles?.length || 0 };

    if (!articles || articles.length === 0) {
      throw new Error("No data available to test");
    }

    // Step 2: Initialize ChatGPT session
    const session = await initializeChatGPTSession();
    browser = session.browser;
    const page = session.page;
    results.sessionInit = { success: true };

    // Use the first article for testing
    const testArticle = articles[0];
    console.log(
      `\n🎯 Testing with article: "${testArticle.title.substring(0, 60)}..."`
    );

    // Step 3: Test data structuring
    results.dataStructuring = await testDataStructuring(page, testArticle);

    // Rate limiting delay
    console.log(
      `\n⏳ Rate limit delay: ${CONFIG.RATE_LIMIT_DELAY_MS / 1000} seconds...`
    );
    await new Promise((resolve) =>
      setTimeout(resolve, CONFIG.RATE_LIMIT_DELAY_MS)
    );

    // Step 4: Test blog generation
    results.blogGeneration = await testBlogGeneration(page, testArticle);

    // Summary
    console.log(
      "\n╔════════════════════════════════════════════════════════════╗"
    );
    console.log(
      "║                      TEST RESULTS SUMMARY                   ║"
    );
    console.log(
      "╠════════════════════════════════════════════════════════════╣"
    );
    console.log(
      `║  Data Fetch:        ${
        results.dataFetch.success ? "✅ PASS" : "❌ FAIL"
      } (${results.dataFetch.count} articles)          ║`
    );
    console.log(
      `║  Session Init:      ${
        results.sessionInit.success ? "✅ PASS" : "❌ FAIL"
      }                              ║`
    );
    console.log(
      `║  Data Structuring:  ${
        results.dataStructuring?.success ? "✅ PASS" : "❌ FAIL"
      } (${results.dataStructuring?.duration || 0}ms)            ║`
    );
    console.log(
      `║  Blog Generation:   ${
        results.blogGeneration?.success ? "✅ PASS" : "❌ FAIL"
      } (${results.blogGeneration?.wordCount || 0} words)         ║`
    );
    console.log(
      "╚════════════════════════════════════════════════════════════╝"
    );

    return results;
  } catch (error) {
    console.error("\n❌ Test suite failed:", error.message);
    console.error(error.stack);
    return { error: error.message, results };
  } finally {
    // Cleanup
    if (browser) {
      console.log("\n🧹 Closing browser...");
      await browser.close();
    }

    console.log("🔌 Disconnecting Prisma...");
    if (prisma) {
      await prisma.$disconnect();
    }
    if (pool) {
      await pool.end();
    }

    console.log("\n✅ Test completed.");
  }
}

// Run the test
runChatGPTTests().catch(console.error);
