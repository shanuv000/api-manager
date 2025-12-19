const axios = require("axios");
const cheerio = require("cheerio");
const { withAxiosRetry } = require("../../utils/scraper-retry");

async function getScorecardDetails(url) {
  try {
    const response = await withAxiosRetry(
      () =>
        axios.get(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
          timeout: 15000,
        }),
      { operationName: "Scorecard Fetch", maxRetries: 2 }
    );

    const html = response.data;
    const $ = cheerio.load(html);

    const innings = [];

    // Find all innings blocks
    $('div[id^="scard-team-"]').each((index, element) => {
      const $innings = $(element);
      // The header is usually the previous sibling div
      const headerText = $innings.prev().text().trim();

      let teamName = "";
      // Try to extract team name (e.g. "IND" from "IND 349-8")
      // Usually it's the text before the first digit
      const teamMatch = headerText.match(/^([A-Z0-9\s]+?)\s*\d/);
      if (teamMatch) {
        teamName = teamMatch[1].trim();
      }

      const inningData = {
        inningsId: index + 1,
        inningsHeader: headerText, // e.g. "IND 349-8 (50 Ov)"
        teamName: teamName,
        batting: [],
        bowling: [],
      };

      // Scrape Batting
      $innings.find(".scorecard-bat-grid").each((i, row) => {
        const $row = $(row);
        // Skip header row (checking if it has 'Batter' text)
        if ($row.text().includes("Batter") && $row.text().includes("R")) return;

        const batterName = $row.find("a.text-cbTextLink").first().text().trim();
        if (!batterName) return; // Skip if no batter name (e.g. extras row)

        const dismissal = $row.find(".text-cbTxtSec").text().trim();

        // Check if currently batting
        const isBatting = dismissal === "batting" || dismissal === "not out";

        const cols = $row.children();
        // 0: Name/Dismissal container
        // 1: Runs
        // 2: Balls
        // 3: 4s
        // 4: 6s
        // 5: SR

        const runs = cols.eq(1).text().trim();
        const balls = cols.eq(2).text().trim();
        const fours = cols.eq(3).text().trim();
        const sixes = cols.eq(4).text().trim();
        const sr = cols.eq(5).text().trim();

        inningData.batting.push({
          batter: batterName,
          dismissal,
          runs,
          balls,
          fours,
          sixes,
          sr,
          isBatting,
        });
      });

      // Scrape Bowling
      const bowlers = [];
      $innings.find(".scorecard-bowl-grid").each((i, row) => {
        const $row = $(row);
        if ($row.text().includes("Bowler") && $row.text().includes("O")) return;

        const bowlerName = $row.find("a.text-cbTextLink").first().text().trim();
        if (!bowlerName) return;

        const cols = $row.children();
        const overs = cols.eq(1).text().trim();
        const maidens = cols.eq(2).text().trim();
        const runs = cols.eq(3).text().trim();
        const wickets = cols.eq(4).text().trim();
        const nb = cols.eq(5).text().trim();
        const wd = cols.eq(6).text().trim();
        const eco = cols.eq(7).text().trim();

        bowlers.push({
          bowler: bowlerName,
          overs,
          maidens,
          runs,
          wickets,
          nb,
          wd,
          eco,
          isBowling: false, // Default to false
        });
      });

      // Identify active bowler: The last bowler in the list with incomplete overs (decimal part)
      // This is a heuristic: usually the current bowler has a partial over (e.g. 9.1)
      // and appears later in the list than any previous bowler who might have been taken off mid-over.
      let activeBowlerIndex = -1;
      for (let i = bowlers.length - 1; i >= 0; i--) {
        const overs = bowlers[i].overs;
        if (overs.includes(".")) {
          activeBowlerIndex = i;
          break;
        }
      }

      if (activeBowlerIndex !== -1) {
        bowlers[activeBowlerIndex].isBowling = true;
      }

      inningData.bowling = bowlers;

      if (inningData.batting.length > 0 || inningData.bowling.length > 0) {
        innings.push(inningData);
      }
    });

    return innings;
  } catch (error) {
    console.error(`Error fetching scorecard from ${url}:`, error.message);
    return null;
  }
}

module.exports = getScorecardDetails;
