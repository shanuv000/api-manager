/**
 * Deep Test for ESPN Puppeteer Scraper
 * Validates all aspects of content extraction
 */

const ESPNCricinfoPuppeteerScraper = require("./espncricinfo-puppeteer-scraper");

async function deepTest() {
  const scraper = new ESPNCricinfoPuppeteerScraper();
  const results = {
    totalArticles: 0,
    passed: 0,
    failed: 0,
    warnings: 0,
    details: [],
  };

  console.log("\n" + "═".repeat(70));
  console.log("   🧪 ESPN PUPPETEER SCRAPER - DEEP TEST");
  console.log("═".repeat(70) + "\n");

  try {
    // Scrape 10 articles for thorough testing
    const articles = await scraper.fetchLatestNewsWithDetails(10);
    results.totalArticles = articles.length;

    console.log(`\n📊 Testing ${articles.length} articles...\n`);
    console.log("─".repeat(70));

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      const tests = [];
      let articlePassed = true;

      // Test 1: Title
      if (article.title && article.title.length > 10) {
        tests.push({
          field: "title",
          status: "✅",
          value: article.title.substring(0, 50) + "...",
        });
      } else {
        tests.push({
          field: "title",
          status: "❌",
          value: "Missing or too short",
        });
        articlePassed = false;
      }

      // Test 2: URL
      if (article.url && article.url.includes("espncricinfo.com/story/")) {
        tests.push({ field: "url", status: "✅", value: "Valid ESPN URL" });
      } else {
        tests.push({ field: "url", status: "❌", value: "Invalid URL" });
        articlePassed = false;
      }

      // Test 3: Details object
      if (!article.details) {
        tests.push({
          field: "details",
          status: "❌",
          value: "Missing details object",
        });
        articlePassed = false;
      } else {
        const d = article.details;

        // Test 4: Content
        if (d.content && d.wordCount >= 50) {
          tests.push({
            field: "content",
            status: "✅",
            value: `${d.wordCount} words, ${
              d.contentParagraphs?.length || 0
            } paragraphs`,
          });
        } else if (d.content && d.wordCount > 0) {
          tests.push({
            field: "content",
            status: "⚠️",
            value: `Only ${d.wordCount} words (low)`,
          });
          results.warnings++;
        } else {
          tests.push({
            field: "content",
            status: "❌",
            value: "No content extracted",
          });
          articlePassed = false;
        }

        // Test 5: Published Time (CRITICAL)
        if (d.publishedTime && /^\d{4}-\d{2}-\d{2}T/.test(d.publishedTime)) {
          const date = new Date(d.publishedTime);
          const age = Math.round(
            (Date.now() - date.getTime()) / (1000 * 60 * 60)
          );
          tests.push({
            field: "publishedTime",
            status: "✅",
            value: `${d.publishedTime} (${age}h ago)`,
          });
        } else if (d.publishedTime) {
          tests.push({
            field: "publishedTime",
            status: "⚠️",
            value: `Non-ISO format: ${d.publishedTime}`,
          });
          results.warnings++;
        } else {
          tests.push({
            field: "publishedTime",
            status: "❌",
            value: "NULL - extraction failed",
          });
          articlePassed = false;
        }

        // Test 6: Author
        if (d.author && d.author.length > 2) {
          tests.push({ field: "author", status: "✅", value: d.author });
        } else {
          tests.push({
            field: "author",
            status: "⚠️",
            value: "Missing author",
          });
          results.warnings++;
        }

        // Test 7: Main Image
        if (d.mainImage && d.mainImage.startsWith("http")) {
          tests.push({ field: "mainImage", status: "✅", value: "Present" });
        } else {
          tests.push({ field: "mainImage", status: "⚠️", value: "Missing" });
          results.warnings++;
        }

        // Test 8: Keywords
        if (d.keywords && d.keywords.length > 0) {
          tests.push({
            field: "keywords",
            status: "✅",
            value: d.keywords.slice(0, 3).join(", "),
          });
        } else {
          tests.push({ field: "keywords", status: "⚠️", value: "None" });
          results.warnings++;
        }

        // Test 9: Related Articles
        if (d.relatedArticles && d.relatedArticles.length > 0) {
          tests.push({
            field: "relatedArticles",
            status: "✅",
            value: `${d.relatedArticles.length} found`,
          });
        } else {
          tests.push({ field: "relatedArticles", status: "⚠️", value: "None" });
          results.warnings++;
        }

        // Test 10: Content Quality (no boilerplate)
        const boilerplate = ["cookie", "privacy", "subscribe", "newsletter"];
        const hasBoilerplate = boilerplate.some((b) =>
          (d.content || "").toLowerCase().includes(b)
        );
        if (!hasBoilerplate || d.wordCount > 200) {
          tests.push({
            field: "contentQuality",
            status: "✅",
            value: "Clean content",
          });
        } else {
          tests.push({
            field: "contentQuality",
            status: "⚠️",
            value: "May contain boilerplate",
          });
          results.warnings++;
        }
      }

      // Summary for this article
      const failedTests = tests.filter((t) => t.status === "❌").length;
      const warningTests = tests.filter((t) => t.status === "⚠️").length;

      console.log(`\n${i + 1}. ${article.title?.substring(0, 55)}...`);
      tests.forEach((t) => {
        console.log(`   ${t.status} ${t.field}: ${t.value}`);
      });

      if (articlePassed) {
        results.passed++;
        console.log(
          `   📋 RESULT: PASSED ${
            warningTests > 0 ? `(${warningTests} warnings)` : ""
          }`
        );
      } else {
        results.failed++;
        console.log(`   📋 RESULT: FAILED (${failedTests} critical issues)`);
      }

      results.details.push({
        title: article.title,
        passed: articlePassed,
        tests,
      });
    }

    // Final Summary
    console.log("\n" + "═".repeat(70));
    console.log("   📊 DEEP TEST SUMMARY");
    console.log("═".repeat(70));
    console.log(`   Total Articles Tested:  ${results.totalArticles}`);
    console.log(`   ✅ Passed:              ${results.passed}`);
    console.log(`   ❌ Failed:              ${results.failed}`);
    console.log(`   ⚠️  Warnings:           ${results.warnings}`);
    console.log(
      `   Success Rate:           ${Math.round(
        (results.passed / results.totalArticles) * 100
      )}%`
    );
    console.log("═".repeat(70) + "\n");

    // Critical field coverage
    const withPublishedTime = results.details.filter((d) =>
      d.tests.find((t) => t.field === "publishedTime" && t.status === "✅")
    ).length;
    const withContent = results.details.filter((d) =>
      d.tests.find((t) => t.field === "content" && t.status === "✅")
    ).length;

    console.log("📈 CRITICAL FIELD COVERAGE:");
    console.log(
      `   publishedTime: ${withPublishedTime}/${
        results.totalArticles
      } (${Math.round((withPublishedTime / results.totalArticles) * 100)}%)`
    );
    console.log(
      `   content:       ${withContent}/${results.totalArticles} (${Math.round(
        (withContent / results.totalArticles) * 100
      )}%)`
    );
    console.log("");

    return results;
  } catch (error) {
    console.error("❌ Test error:", error);
    throw error;
  } finally {
    await scraper.close();
  }
}

deepTest().catch(console.error);
