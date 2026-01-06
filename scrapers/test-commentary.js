/**
 * Test script for Commentary Extraction
 *
 * Run: node scrapers/test-commentary.js
 */

const {
  getCommentaryDetails,
  getRecentCommentary,
  getHighlightsCommentary,
} = require("../routes/Cricket/commentary");

async function testCommentary() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🏏 Commentary Extraction Test");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Test with the Ashes match (live)
  const testUrl =
    "https://www.cricbuzz.com/live-cricket-scores/108811/aus-vs-eng-5th-test-the-ashes-2025-26";

  console.log(`\n📡 Fetching commentary from:\n   ${testUrl}\n`);

  try {
    // Test 1: Full commentary
    console.log("═══ TEST 1: Full Commentary ═══");
    const full = await getCommentaryDetails(testUrl);

    if (!full) {
      console.log("❌ Failed to fetch commentary");
      return;
    }

    console.log(`✅ Match Info:`);
    console.log(`   Match ID: ${full.matchInfo.matchId || "N/A"}`);
    console.log(`   State: ${full.matchInfo.state || "N/A"}`);
    console.log(`   Status: ${full.matchInfo.status || "N/A"}`);
    console.log(`   Current Innings: ${full.currentInnings || "N/A"}`);
    console.log(`   Total Entries: ${full.entryCount}`);

    if (full.activeBatsmen && full.activeBatsmen.length > 0) {
      console.log(`\n🏏 Active Batsmen:`);
      full.activeBatsmen.forEach((b) => {
        console.log(`   - ${b.playerName} (ID: ${b.playerId})`);
      });
    }

    if (full.overSummaries && full.overSummaries.length > 0) {
      console.log(`\n📊 Recent Over Summaries:`);
      full.overSummaries.slice(0, 5).forEach((os) => {
        console.log(
          `   Over ${os.overNumber}: ${os.summary} (${os.teamName} ${os.teamScore})`
        );
      });
    }

    console.log(`\n📜 Sample Commentary Entries (first 5):`);
    full.entries.slice(0, 5).forEach((entry, i) => {
      const ballStr = entry.ball ? `[${entry.ball}]` : "[--.-]";
      const eventStr =
        entry.eventType !== "ball" ? ` 🔴 ${entry.eventType.toUpperCase()}` : "";
      console.log(`\n   ${i + 1}. ${ballStr}${eventStr}`);
      console.log(
        `      ${entry.textPlain.substring(0, 150)}${entry.textPlain.length > 150 ? "..." : ""}`
      );
    });

    // Test 2: Recent commentary (last 10)
    console.log("\n\n═══ TEST 2: Recent Commentary (10 balls) ═══");
    const recent = await getRecentCommentary(testUrl, 10);
    console.log(`✅ Retrieved ${recent.entryCount} of ${recent.totalAvailable} entries`);

    // Test 3: Highlights only
    console.log("\n═══ TEST 3: Highlights (4s, 6s, Wickets) ═══");
    const highlights = await getHighlightsCommentary(testUrl);
    console.log(`✅ Found ${highlights.entryCount} highlight events`);

    if (highlights.entries.length > 0) {
      console.log("\n   Highlight Events:");
      highlights.entries.slice(0, 10).forEach((entry) => {
        const icon =
          entry.eventType === "wicket"
            ? "🔴"
            : entry.eventType === "six"
              ? "6️⃣"
              : "4️⃣";
        console.log(
          `   ${icon} [${entry.ball || "--"}] ${entry.textPlain.substring(0, 80)}...`
        );
      });
    }

    // Output sample JSON
    console.log("\n\n═══ SAMPLE JSON OUTPUT ═══");
    const sampleOutput = {
      matchInfo: full.matchInfo,
      currentInnings: full.currentInnings,
      activeBatsmen: full.activeBatsmen?.slice(0, 2),
      recentCommentary: full.entries.slice(0, 3).map((e) => ({
        ball: e.ball,
        text: e.textPlain.substring(0, 100),
        eventType: e.eventType,
        team: e.teamName,
      })),
      overSummaries: full.overSummaries?.slice(0, 2),
    };
    console.log(JSON.stringify(sampleOutput, null, 2));

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✅ All tests completed successfully!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  } catch (error) {
    console.error("❌ Test failed:", error);
  }
}

testCommentary();
