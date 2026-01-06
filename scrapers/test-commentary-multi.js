/**
 * Comprehensive Multi-Match Commentary Test
 * Tests commentary extraction across different match types
 *
 * Run: node scrapers/test-commentary-multi.js
 */

const {
  getCommentaryDetails,
  getRecentCommentary,
  getHighlightsCommentary,
} = require("../routes/Cricket/commentary");

// Test matches - variety of formats and states
const TEST_MATCHES = [
  {
    name: "The Ashes 2025-26 (Test)",
    url: "https://www.cricbuzz.com/live-cricket-scores/108811/eng-vs-aus-5th-test-the-ashes-2025-26",
    matchId: "108811",
  },
  {
    name: "SA20 - MICT vs JSK (T20)",
    url: "https://www.cricbuzz.com/live-cricket-scores/126493/mict-vs-jsk-15th-match-sa20-2025-26",
    matchId: "126493",
  },
  {
    name: "BBL - ADS vs SYT (T20)",
    url: "https://www.cricbuzz.com/live-cricket-scores/123287/ads-vs-syt-25th-match-bbl-2025-26",
    matchId: "123287",
  },
  {
    name: "BPL - CHR vs RGR (T20)",
    url: "https://www.cricbuzz.com/live-cricket-scores/140330/chr-vs-rgr-14th-match-bpl-2025-26",
    matchId: "140330",
  },
  {
    name: "SL vs PAK (T20I)",
    url: "https://www.cricbuzz.com/live-cricket-scores/140160/sl-vs-pak-1st-t20i-pakistan-tour-of-sri-lanka-2026",
    matchId: "140160",
  },
];

async function testMatch(match, index) {
  const divider = "─".repeat(60);
  console.log(`\n${divider}`);
  console.log(`📍 TEST ${index + 1}: ${match.name}`);
  console.log(`   ID: ${match.matchId}`);
  console.log(divider);

  try {
    const startTime = Date.now();
    const commentary = await getCommentaryDetails(match.url);
    const fetchTime = Date.now() - startTime;

    if (!commentary) {
      console.log(`   ❌ Failed to fetch commentary`);
      return { match: match.name, success: false, error: "Fetch failed" };
    }

    // Analyze results
    const result = {
      match: match.name,
      matchId: match.matchId,
      success: true,
      fetchTimeMs: fetchTime,
      matchInfo: {
        state: commentary.matchInfo?.state || "N/A",
        status: commentary.matchInfo?.status?.substring(0, 50) || "N/A",
        scores: commentary.matchInfo?.scores || [],
      },
      currentInnings: commentary.currentInnings,
      entryCount: commentary.entryCount,
      activeBatsmenCount: commentary.activeBatsmen?.length || 0,
      overSummaryCount: commentary.overSummaries?.length || 0,
      eventBreakdown: {},
    };

    // Count event types
    if (commentary.entries) {
      commentary.entries.forEach((e) => {
        const type = e.eventType || "unknown";
        result.eventBreakdown[type] = (result.eventBreakdown[type] || 0) + 1;
      });
    }

    // Display results
    console.log(`   ✅ Fetch time: ${fetchTime}ms`);
    console.log(`   📊 Match State: ${result.matchInfo.state}`);
    console.log(`   📊 Match Status: ${result.matchInfo.status}`);

    if (result.matchInfo.scores && result.matchInfo.scores.length > 0) {
      console.log(`   📊 Scores:`);
      result.matchInfo.scores.forEach((s) => {
        console.log(`      - ${s.team}: ${s.score}/${s.wickets} (${s.overs} ov)`);
      });
    }

    console.log(`   📊 Current Innings: ${result.currentInnings || "N/A"}`);
    console.log(`   📊 Commentary Entries: ${result.entryCount}`);
    console.log(`   📊 Active Batsmen: ${result.activeBatsmenCount}`);
    console.log(`   📊 Over Summaries: ${result.overSummaryCount}`);

    if (Object.keys(result.eventBreakdown).length > 0) {
      console.log(`   📊 Event Breakdown:`);
      Object.entries(result.eventBreakdown).forEach(([type, count]) => {
        const icon =
          type === "wicket" ? "🔴" : type === "six" ? "6️⃣" : type === "four" ? "4️⃣" : "⚪";
        console.log(`      ${icon} ${type}: ${count}`);
      });
    }

    // Show sample entry
    if (commentary.entries && commentary.entries.length > 0) {
      const sample = commentary.entries[0];
      console.log(`\n   📝 Most Recent Entry:`);
      console.log(`      Ball: ${sample.ball || "--.-"}`);
      console.log(`      Type: ${sample.eventType}`);
      console.log(`      Text: ${sample.textPlain?.substring(0, 80)}...`);
    }

    // Check for potential issues
    const issues = [];
    if (result.entryCount === 0) issues.push("No commentary entries");
    if (!result.matchInfo.state || result.matchInfo.state === "N/A")
      issues.push("Missing match state");
    if (result.activeBatsmenCount === 0 && result.matchInfo.state === "In Progress")
      issues.push("No active batsmen detected");

    if (issues.length > 0) {
      console.log(`\n   ⚠️ Potential Issues:`);
      issues.forEach((i) => console.log(`      - ${i}`));
    }

    return result;
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return { match: match.name, success: false, error: error.message };
  }
}

async function runTests() {
  console.log("━".repeat(60));
  console.log("🏏 COMPREHENSIVE COMMENTARY EXTRACTION TEST");
  console.log("━".repeat(60));
  console.log(`Testing ${TEST_MATCHES.length} matches across different formats`);

  const results = [];

  for (let i = 0; i < TEST_MATCHES.length; i++) {
    const result = await testMatch(TEST_MATCHES[i], i);
    results.push(result);

    // Small delay between requests to be nice to the server
    if (i < TEST_MATCHES.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // Summary
  console.log("\n" + "━".repeat(60));
  console.log("📊 SUMMARY");
  console.log("━".repeat(60));

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(`\n✅ Successful: ${successful.length}/${results.length}`);
  console.log(`❌ Failed: ${failed.length}/${results.length}`);

  if (successful.length > 0) {
    const avgFetchTime =
      successful.reduce((sum, r) => sum + r.fetchTimeMs, 0) / successful.length;
    const avgEntries =
      successful.reduce((sum, r) => sum + r.entryCount, 0) / successful.length;
    const totalEvents = {};

    successful.forEach((r) => {
      Object.entries(r.eventBreakdown || {}).forEach(([type, count]) => {
        totalEvents[type] = (totalEvents[type] || 0) + count;
      });
    });

    console.log(`\n📈 Statistics (successful matches):`);
    console.log(`   Avg fetch time: ${Math.round(avgFetchTime)}ms`);
    console.log(`   Avg entries per match: ${Math.round(avgEntries)}`);
    console.log(`   Event totals across all matches:`);
    Object.entries(totalEvents)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        console.log(`      - ${type}: ${count}`);
      });
  }

  if (failed.length > 0) {
    console.log(`\n❌ Failed matches:`);
    failed.forEach((r) => {
      console.log(`   - ${r.match}: ${r.error}`);
    });
  }

  // Match states summary
  console.log(`\n🏷️ Match States Found:`);
  const states = [...new Set(successful.map((r) => r.matchInfo?.state).filter(Boolean))];
  states.forEach((s) => {
    const count = successful.filter((r) => r.matchInfo?.state === s).length;
    console.log(`   - ${s}: ${count} match(es)`);
  });

  console.log("\n" + "━".repeat(60));
  console.log("✅ TEST COMPLETE");
  console.log("━".repeat(60) + "\n");

  // Return detailed JSON for further analysis
  return {
    timestamp: new Date().toISOString(),
    totalMatches: results.length,
    successful: successful.length,
    failed: failed.length,
    results,
  };
}

runTests()
  .then((report) => {
    // Output JSON report for programmatic use
    console.log("\n📄 JSON Report (for programmatic use):");
    console.log(JSON.stringify(report, null, 2));
  })
  .catch(console.error);
