/**
 * Deep Test for BOTH Puppeteer Scrapers
 * Tests Cricbuzz and ESPN scrapers side by side
 */

const CricbuzzScraper = require("./cricbuzz-news-scraper");
const ESPNScraper = require("./espncricinfo-puppeteer-scraper");

async function validateArticle(article, source) {
  const tests = [];
  let passed = true;

  // Title
  if (article.title && article.title.length > 10) {
    tests.push({
      field: "title",
      status: "✅",
      value: article.title.substring(0, 40) + "...",
    });
  } else {
    tests.push({ field: "title", status: "❌", value: "Missing" });
    passed = false;
  }

  // URL
  if (article.link || article.url) {
    tests.push({ field: "url", status: "✅", value: "Valid" });
  } else {
    tests.push({ field: "url", status: "❌", value: "Missing" });
    passed = false;
  }

  // Details
  const d = article.details;
  if (!d) {
    tests.push({ field: "details", status: "❌", value: "No details object" });
    return { passed: false, tests };
  }

  // Content
  const wordCount = d.wordCount || d.content?.split(/\s+/).length || 0;
  if (d.content && wordCount >= 50) {
    tests.push({ field: "content", status: "✅", value: `${wordCount} words` });
  } else if (d.content) {
    tests.push({
      field: "content",
      status: "⚠️",
      value: `${wordCount} words (low)`,
    });
  } else {
    tests.push({ field: "content", status: "❌", value: "No content" });
    passed = false;
  }

  // Published Time
  if (d.publishedTime && /\d{4}/.test(d.publishedTime)) {
    tests.push({
      field: "publishedTime",
      status: "✅",
      value: d.publishedTime.substring(0, 25),
    });
  } else if (d.publishedTime) {
    tests.push({
      field: "publishedTime",
      status: "⚠️",
      value: d.publishedTime.substring(0, 25),
    });
  } else {
    tests.push({ field: "publishedTime", status: "❌", value: "NULL" });
    passed = false;
  }

  // Main Image
  if (d.mainImage && d.mainImage.startsWith("http")) {
    tests.push({ field: "mainImage", status: "✅", value: "Present" });
  } else {
    tests.push({ field: "mainImage", status: "⚠️", value: "Missing" });
  }

  return { passed, tests };
}

async function testScraper(name, scraper, limit = 5) {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`   🧪 Testing ${name}`);
  console.log("═".repeat(70) + "\n");

  const results = { passed: 0, failed: 0, warnings: 0, articles: [] };

  try {
    const articles = await scraper.fetchLatestNewsWithDetails(limit);

    console.log(`📊 Testing ${articles.length} articles...\n`);

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      const { passed, tests } = await validateArticle(article, name);

      console.log(`${i + 1}. ${article.title?.substring(0, 50)}...`);
      tests.forEach((t) =>
        console.log(`   ${t.status} ${t.field}: ${t.value}`)
      );

      if (passed) {
        results.passed++;
        console.log(`   📋 PASSED`);
      } else {
        results.failed++;
        console.log(`   📋 FAILED`);
      }

      results.warnings += tests.filter((t) => t.status === "⚠️").length;
      results.articles.push({ title: article.title, passed, tests });
    }

    return results;
  } catch (error) {
    console.error(`❌ ${name} error:`, error.message);
    return { passed: 0, failed: 0, error: error.message };
  }
}

async function main() {
  console.log("\n" + "█".repeat(70));
  console.log("   🏏 BOTH PUPPETEER SCRAPERS - DEEP TEST");
  console.log("█".repeat(70));

  const cricbuzz = new CricbuzzScraper();
  const espn = new ESPNScraper();

  try {
    // Test Cricbuzz
    const cbResults = await testScraper("CRICBUZZ", cricbuzz, 5);
    await cricbuzz.closeBrowser();

    // Test ESPN
    const espnResults = await testScraper("ESPN CRICINFO", espn, 5);
    await espn.close();

    // Final Report
    console.log("\n" + "█".repeat(70));
    console.log("   📊 FINAL COMPARISON");
    console.log("█".repeat(70) + "\n");

    console.log("┌─────────────────────┬──────────────┬──────────────┐");
    console.log("│ Metric              │ Cricbuzz     │ ESPN         │");
    console.log("├─────────────────────┼──────────────┼──────────────┤");
    console.log(
      `│ Passed              │ ${String(cbResults.passed).padEnd(
        12
      )} │ ${String(espnResults.passed).padEnd(12)} │`
    );
    console.log(
      `│ Failed              │ ${String(cbResults.failed).padEnd(
        12
      )} │ ${String(espnResults.failed).padEnd(12)} │`
    );
    console.log(
      `│ Warnings            │ ${String(cbResults.warnings).padEnd(
        12
      )} │ ${String(espnResults.warnings).padEnd(12)} │`
    );
    console.log("└─────────────────────┴──────────────┴──────────────┘");

    const cbRate =
      (cbResults.passed / (cbResults.passed + cbResults.failed)) * 100 || 0;
    const espnRate =
      (espnResults.passed / (espnResults.passed + espnResults.failed)) * 100 ||
      0;

    console.log(`\n✅ Cricbuzz Success Rate:     ${cbRate.toFixed(0)}%`);
    console.log(`✅ ESPN Cricinfo Success Rate: ${espnRate.toFixed(0)}%`);
    console.log("");
  } catch (error) {
    console.error("❌ Test error:", error);
  }
}

main();
