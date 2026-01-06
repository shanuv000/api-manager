/**
 * Data Quality Verification Script
 * Run: node scrapers/verify-commentary-quality.js
 */

const { getCommentaryDetails } = require("../routes/Cricket/commentary");

async function dataQualityCheck() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("📋 DATA QUALITY VERIFICATION");
  console.log("═══════════════════════════════════════════════════════════\n");

  const url =
    "https://www.cricbuzz.com/live-cricket-scores/108811/eng-vs-aus-5th-test-the-ashes-2025-26";
  const data = await getCommentaryDetails(url);

  console.log("1️⃣ MATCH INFO QUALITY");
  console.log(
    "─────────────────────────────────────────────────────────────"
  );
  console.log("   matchId present:", data.matchInfo?.matchId ? "✅" : "❌");
  console.log("   state present:", data.matchInfo?.state ? "✅" : "❌");
  console.log("   status present:", data.matchInfo?.status ? "✅" : "❌");
  console.log(
    "   scores array:",
    data.matchInfo?.scores?.length > 0
      ? "✅ (" + data.matchInfo.scores.length + " teams)"
      : "⚠️ empty"
  );

  if (data.matchInfo?.scores?.length > 0) {
    console.log("   Score data quality:");
    data.matchInfo.scores.forEach((s, i) => {
      const valid =
        s.team && typeof s.score === "number" && typeof s.wickets === "number";
      console.log(
        "     Team " + (i + 1) + ":",
        valid ? "✅" : "❌",
        s.team,
        s.score + "/" + s.wickets
      );
    });
  }

  console.log("\n2️⃣ COMMENTARY ENTRIES QUALITY");
  console.log(
    "─────────────────────────────────────────────────────────────"
  );
  console.log("   Total entries:", data.entries?.length || 0);

  let validEntries = 0;
  let issues = [];

  data.entries?.forEach((entry, i) => {
    const hasText = entry.textPlain && entry.textPlain.length > 5;
    const hasType =
      ["ball", "update", "four", "six", "wicket", "over-end"].includes(
        entry.type
      ) ||
      ["ball", "update", "four", "six", "wicket", "over-end"].includes(
        entry.eventType
      );
    const hasTimestamp = typeof entry.timestamp === "number";

    if (hasText && hasType && hasTimestamp) {
      validEntries++;
    } else {
      issues.push({
        index: i,
        ball: entry.ball,
        hasText,
        hasType,
        hasTimestamp,
      });
    }
  });

  console.log(
    "   Valid entries:",
    validEntries + "/" + data.entries?.length,
    validEntries === data.entries?.length ? "✅" : "⚠️"
  );

  if (issues.length > 0 && issues.length <= 3) {
    console.log("   Issues found:");
    issues.forEach((i) =>
      console.log("     Entry " + i.index + ":", JSON.stringify(i))
    );
  }

  // Check entry text quality - no HTML tags, no weird characters
  console.log("\n3️⃣ TEXT QUALITY CHECK");
  console.log(
    "─────────────────────────────────────────────────────────────"
  );
  let htmlTags = 0;
  let weirdChars = 0;
  let shortEntries = 0;

  data.entries?.forEach((e) => {
    if (/<[^>]+>/.test(e.textPlain)) htmlTags++;
    if (/\\u00|\\n|\$undefined/.test(e.textPlain)) weirdChars++;
    if (e.textPlain && e.textPlain.length < 10 && e.type !== "update")
      shortEntries++;
  });

  console.log(
    "   No HTML tags in textPlain:",
    htmlTags === 0 ? "✅" : "❌ (" + htmlTags + " found)"
  );
  console.log(
    "   No unescaped unicode:",
    weirdChars === 0 ? "✅" : "❌ (" + weirdChars + " found)"
  );
  console.log(
    "   No unusually short entries:",
    shortEntries === 0 ? "✅" : "⚠️ (" + shortEntries + " found)"
  );

  console.log("\n4️⃣ BATSMEN & OVER SUMMARIES");
  console.log(
    "─────────────────────────────────────────────────────────────"
  );
  console.log(
    "   Active batsmen detected:",
    data.activeBatsmen?.length > 0
      ? "✅ (" + data.activeBatsmen.length + ")"
      : "⚠️ none"
  );

  if (data.activeBatsmen?.length > 0) {
    data.activeBatsmen.forEach((b) => {
      console.log("     -", b.playerName, "(ID:", b.playerId + ")");
    });
  }

  console.log(
    "   Over summaries detected:",
    data.overSummaries?.length > 0
      ? "✅ (" + data.overSummaries.length + ")"
      : "⚠️ none"
  );

  if (data.overSummaries?.length > 0) {
    data.overSummaries.slice(0, 2).forEach((o) => {
      console.log(
        "     - Over",
        o.overNumber + ":",
        o.summary,
        "(" + o.teamScore + ")"
      );
    });
  }

  console.log("\n5️⃣ EVENT TYPE DISTRIBUTION");
  console.log(
    "─────────────────────────────────────────────────────────────"
  );
  const eventCounts = {};
  data.entries?.forEach((e) => {
    eventCounts[e.eventType] = (eventCounts[e.eventType] || 0) + 1;
  });
  Object.entries(eventCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      const icon =
        type === "wicket"
          ? "🔴"
          : type === "six"
            ? "6️⃣"
            : type === "four"
              ? "4️⃣"
              : "⚪";
      console.log("   ", icon, type + ":", count);
    });

  console.log(
    "\n═══════════════════════════════════════════════════════════"
  );
  console.log("✅ DATA QUALITY CHECK COMPLETE");
  console.log(
    "═══════════════════════════════════════════════════════════\n"
  );
}

dataQualityCheck().catch(console.error);
