#!/usr/bin/env node
/**
 * BBC Cricket Scraper Test Script
 *
 * Tests the BBC Sport Cricket scraper functionality
 * Run: node scrapers/test-bbc-cricket-scraper.js
 */

const BBCCricketScraper = require("./bbc-cricket-scraper");
const fs = require("fs");
const path = require("path");

// Output directory for test results
const OUTPUT_DIR = path.join(__dirname, "../test-output");

async function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

async function saveToFile(filename, content) {
  await ensureOutputDir();
  const filePath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filePath, content);
  console.log(`💾 Saved to: ${filePath}`);
}

async function testNewsList() {
  console.log("\n" + "=".repeat(70));
  console.log("TEST 1: Fetch News List");
  console.log("=".repeat(70));

  const scraper = new BBCCricketScraper();

  try {
    const news = await scraper.fetchLatestNews();

    console.log(`\n✅ Successfully fetched ${news.length} articles`);

    // Save JSON
    await saveToFile("bbc-news-list.json", JSON.stringify(news, null, 2));

    // Display summary
    console.log("\n📋 Article Summary:");
    console.log("-".repeat(70));

    news.forEach((article, idx) => {
      console.log(`\n[${idx + 1}] ${article.title}`);
      console.log(`    ID: ${article.id}`);
      console.log(`    Category: ${article.category || "Uncategorized"}`);
      console.log(`    Published: ${article.publishedTime || "Unknown"}`);
      console.log(`    Comments: ${article.commentsCount || "0"}`);
      console.log(`    URL: ${article.link}`);
    });

    return news;
  } finally {
    await scraper.closeBrowser();
  }
}

async function testArticleDetails(articleUrl) {
  console.log("\n" + "=".repeat(70));
  console.log("TEST 2: Fetch Article Details");
  console.log("=".repeat(70));
  console.log(`Target: ${articleUrl}`);

  const scraper = new BBCCricketScraper();

  try {
    const details = await scraper.fetchArticleDetails(articleUrl);

    console.log("\n✅ Successfully fetched article details");
    console.log("-".repeat(70));
    console.log(`Title: ${details.title}`);
    console.log(`Author: ${details.author || "Unknown"}`);
    console.log(`Published: ${details.publishedTime || "Unknown"}`);
    console.log(`Word Count: ${details.wordCount}`);
    console.log(`Topics: ${details.topics?.length || 0}`);
    console.log(`Related Articles: ${details.relatedArticles?.length || 0}`);
    console.log(`Embedded Media: ${details.embeddedMedia?.length || 0}`);
    console.log(`Comments: ${details.commentsCount || "0"}`);

    // Save JSON
    await saveToFile(
      "bbc-article-details.json",
      JSON.stringify(details, null, 2)
    );

    // Generate and save markdown
    const markdown = scraper.generateMarkdown({ link: articleUrl, details });
    await saveToFile("bbc-article.md", markdown);

    console.log("\n📄 Content Preview (first 500 chars):");
    console.log("-".repeat(70));
    console.log(details.content?.substring(0, 500) + "...");

    return details;
  } finally {
    await scraper.closeBrowser();
  }
}

async function testDetailedNews(limit = 3) {
  console.log("\n" + "=".repeat(70));
  console.log(`TEST 3: Fetch News with Full Details (Limit: ${limit})`);
  console.log("=".repeat(70));

  const scraper = new BBCCricketScraper();

  try {
    const detailedNews = await scraper.fetchLatestNewsWithDetails(limit);

    console.log(`\n✅ Fetched ${detailedNews.length} articles with details`);

    // Save JSON
    await saveToFile(
      "bbc-detailed-news.json",
      JSON.stringify(detailedNews, null, 2)
    );

    // Generate combined markdown
    let combinedMarkdown = "# BBC Sport Cricket News\n\n";
    combinedMarkdown += `*Scraped at: ${new Date().toISOString()}*\n\n`;
    combinedMarkdown += "---\n\n";

    for (const article of detailedNews) {
      if (article.details) {
        combinedMarkdown += scraper.generateMarkdown(article);
        combinedMarkdown += "\n\n---\n\n";
      }
    }

    await saveToFile("bbc-news-collection.md", combinedMarkdown);

    // Summary
    console.log("\n📊 Detailed News Summary:");
    console.log("-".repeat(70));

    detailedNews.forEach((article, idx) => {
      console.log(`\n[${idx + 1}] ${article.title?.substring(0, 60)}...`);
      if (article.details) {
        console.log(`    Words: ${article.details.wordCount}`);
        console.log(
          `    Topics: ${
            article.details.topics?.map((t) => t.name).join(", ") || "None"
          }`
        );
      } else if (article.fetchError) {
        console.log(`    ⚠️ Error: ${article.fetchError}`);
      }
    });

    return detailedNews;
  } finally {
    await scraper.closeBrowser();
  }
}

async function testScoresAndFixtures() {
  console.log("\n" + "=".repeat(70));
  console.log("TEST 4: Fetch Scores and Fixtures");
  console.log("=".repeat(70));

  const scraper = new BBCCricketScraper();

  try {
    const scores = await scraper.fetchScoresAndFixtures();

    console.log(
      `\n✅ Found ${scores.matches.length} matches for ${scores.date}`
    );

    // Save JSON
    await saveToFile("bbc-scores.json", JSON.stringify(scores, null, 2));

    // Generate markdown
    let markdown = `# BBC Cricket Scores & Fixtures\n\n`;
    markdown += `**Date:** ${scores.date}\n`;
    markdown += `**Fetched:** ${scores.fetchedAt}\n\n`;
    markdown += "---\n\n";

    if (scores.matches.length === 0) {
      markdown += "*No matches scheduled for this date.*\n";
    } else {
      let currentCompetition = "";
      for (const match of scores.matches) {
        if (match.competition && match.competition !== currentCompetition) {
          currentCompetition = match.competition;
          markdown += `## ${currentCompetition}\n\n`;
        }

        const teams =
          match.teams.length >= 2
            ? `${match.teams[0]} vs ${match.teams[1]}`
            : "Match";

        markdown += `### ${teams}\n\n`;
        if (match.time) markdown += `- **Time:** ${match.time}\n`;
        if (match.venue) markdown += `- **Venue:** ${match.venue}\n`;
        markdown += `- **[View Scorecard](${match.link})**\n\n`;
      }
    }

    await saveToFile("bbc-scores.md", markdown);

    // Display summary
    console.log("\n🏏 Today's Matches:");
    console.log("-".repeat(70));

    scores.matches.forEach((match, idx) => {
      console.log(`\n[${idx + 1}] ${match.teams.join(" vs ") || "Match"}`);
      console.log(`    Competition: ${match.competition || "Unknown"}`);
      console.log(`    Time: ${match.time || "TBD"}`);
      if (match.venue) console.log(`    Venue: ${match.venue}`);
    });

    return scores;
  } finally {
    await scraper.closeBrowser();
  }
}

async function runAllTests() {
  console.log("\n" + "█".repeat(70));
  console.log("BBC SPORT CRICKET SCRAPER - FULL TEST SUITE");
  console.log("█".repeat(70));
  console.log(`Started at: ${new Date().toISOString()}`);

  const results = {
    newsList: { success: false, count: 0 },
    articleDetails: { success: false, wordCount: 0 },
    detailedNews: { success: false, count: 0 },
    scores: { success: false, count: 0 },
  };

  try {
    // Test 1: News List
    const news = await testNewsList();
    results.newsList.success = true;
    results.newsList.count = news.length;

    // Test 2: Article Details (first article from list)
    if (news.length > 0) {
      const details = await testArticleDetails(news[0].link);
      results.articleDetails.success = true;
      results.articleDetails.wordCount = details.wordCount;
    }

    // Test 3: Detailed News
    const detailedNews = await testDetailedNews(3);
    results.detailedNews.success = true;
    results.detailedNews.count = detailedNews.filter((a) => a.details).length;

    // Test 4: Scores and Fixtures
    const scores = await testScoresAndFixtures();
    results.scores.success = true;
    results.scores.count = scores.matches.length;
  } catch (error) {
    console.error(`\n❌ Test suite error: ${error.message}`);
  }

  // Final Summary
  console.log("\n" + "█".repeat(70));
  console.log("TEST RESULTS SUMMARY");
  console.log("█".repeat(70));

  console.log("\n📊 Results:");
  console.log("-".repeat(40));
  console.log(
    `News List:        ${results.newsList.success ? "✅ PASS" : "❌ FAIL"} (${
      results.newsList.count
    } articles)`
  );
  console.log(
    `Article Details:  ${
      results.articleDetails.success ? "✅ PASS" : "❌ FAIL"
    } (${results.articleDetails.wordCount} words)`
  );
  console.log(
    `Detailed News:    ${
      results.detailedNews.success ? "✅ PASS" : "❌ FAIL"
    } (${results.detailedNews.count} with details)`
  );
  console.log(
    `Scores/Fixtures:  ${results.scores.success ? "✅ PASS" : "❌ FAIL"} (${
      results.scores.count
    } matches)`
  );

  console.log("\n📁 Output files saved to: " + OUTPUT_DIR);
  console.log(`\nCompleted at: ${new Date().toISOString()}`);

  // Save results summary
  await saveToFile("test-results.json", JSON.stringify(results, null, 2));

  return results;
}

// CLI argument parsing
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
BBC Cricket Scraper Test Script

Usage:
  node test-bbc-cricket-scraper.js [command] [options]

Commands:
  (no command)    Run all tests
  news            Fetch news list only
  article <url>   Fetch single article details
  detailed [n]    Fetch n articles with details (default: 3)
  scores [date]   Fetch scores for date (YYYY-MM-DD, default: today)

Options:
  -h, --help      Show this help message

Examples:
  node test-bbc-cricket-scraper.js
  node test-bbc-cricket-scraper.js news
  node test-bbc-cricket-scraper.js article https://www.bbc.com/sport/cricket/articles/xyz123
  node test-bbc-cricket-scraper.js detailed 5
  node test-bbc-cricket-scraper.js scores 2025-12-24
`);
  process.exit(0);
}

// Main execution
(async () => {
  const command = args[0];

  try {
    switch (command) {
      case "news":
        await testNewsList();
        break;
      case "article":
        if (!args[1]) {
          console.error("❌ Please provide an article URL");
          process.exit(1);
        }
        await testArticleDetails(args[1]);
        break;
      case "detailed":
        const limit = parseInt(args[1]) || 3;
        await testDetailedNews(limit);
        break;
      case "scores":
        const date = args[1] || null;
        if (date) {
          const scraper = new BBCCricketScraper();
          try {
            await scraper.fetchScoresAndFixtures(date);
          } finally {
            await scraper.closeBrowser();
          }
        } else {
          await testScoresAndFixtures();
        }
        break;
      default:
        await runAllTests();
    }
  } catch (error) {
    console.error(`\n❌ Fatal error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
})();
