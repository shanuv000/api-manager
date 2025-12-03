const axios = require("axios");
const cheerio = require("cheerio");

async function getScorecardDetails(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      timeout: 10000,
    });

    const html = response.data;
    const $ = cheerio.load(html);

    const innings = [];

    // Find all innings blocks
    $('div[id^="scard-team-"]').each((index, element) => {
      const $innings = $(element);
      const inningData = {
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
        
        // The grid structure might vary, so we rely on finding the text nodes or specific classes if possible
        // But based on inspection, they are just divs.
        // We can try to get all child divs
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
        });
      });

      // Scrape Bowling
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

        inningData.bowling.push({
          bowler: bowlerName,
          overs,
          maidens,
          runs,
          wickets,
          nb,
          wd,
          eco,
        });
      });
      
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
