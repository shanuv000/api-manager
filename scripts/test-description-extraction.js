/**
 * Test script for SEO Description Extraction
 * Runs the scraper and displays description quality metrics
 */

const CricbuzzNewsScraper = require("../scrapers/cricbuzz-news-scraper");

async function testDescriptionExtraction() {
  console.log("🧪 Testing SEO Description Extraction Enhancement\n");
  console.log("=".repeat(60));

  const scraper = new CricbuzzNewsScraper({
    VERBOSE_LOGGING: false, // Keep output clean
    MAX_ARTICLES: 5, // Limit for testing
  });

  try {
    // Test 1: Fetch news listing (basic descriptions from DOM)
    console.log("\n📰 Test 1: Fetching news articles from listing page...\n");
    const articles = await scraper.fetchLatestNews();

    console.log(`Found ${articles.length} articles\n`);
    console.log("-".repeat(60));

    let withDesc = 0;
    let withoutDesc = 0;

    articles.slice(0, 5).forEach((article, i) => {
      console.log(`\n${i + 1}. ${article.title.substring(0, 60)}...`);
      console.log(`   Source: ${article.descriptionSource || "unknown"}`);
      console.log(`   Length: ${article.descriptionLength || 0} chars`);
      console.log(
        `   Description: ${
          article.description
            ? article.description.substring(0, 80) + "..."
            : "NONE"
        }`
      );

      if (article.description && article.description.length > 50) {
        withDesc++;
      } else {
        withoutDesc++;
      }
    });

    console.log("\n" + "=".repeat(60));
    console.log("📊 LISTING PAGE METRICS:");
    console.log(`   ✅ With description: ${withDesc}/5`);
    console.log(`   ❌ Without description: ${withoutDesc}/5`);
    console.log("=".repeat(60));

    // Test 2: Fetch article details (meta tag descriptions)
    if (articles.length > 0) {
      console.log("\n📄 Test 2: Fetching article detail page (meta tags)...\n");

      const testArticle = articles[0];
      console.log(`Testing: ${testArticle.title}\n`);

      const details = await scraper.fetchArticleDetails(testArticle.link);

      console.log("-".repeat(60));
      console.log(
        `SEO Description Source: ${details.descriptionSource || "none"}`
      );
      console.log(
        `SEO Description Length: ${details.seoDescription?.length || 0} chars`
      );
      console.log(
        `SEO Description: ${
          details.seoDescription
            ? details.seoDescription.substring(0, 150) + "..."
            : "NONE"
        }`
      );
      console.log("-".repeat(60));

      // Generate first paragraph as fallback comparison
      const firstPara = details.contentParagraphs?.[0]?.substring(0, 150);
      console.log(`First Paragraph (fallback): ${firstPara || "N/A"}...`);
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ Test completed successfully!");
    console.log("=".repeat(60));

    await scraper.closeBrowser();
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    await scraper.closeBrowser();
    process.exit(1);
  }
}

testDescriptionExtraction();
