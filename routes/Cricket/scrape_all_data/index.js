const axios = require("axios");
const cheerio = require("cheerio");

// Function to fetch and parse the scoreboard dynamically
async function fetchScorecard(url) {
  try {
    // Fetch the HTML content  from the URL
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });
    const html = response.data;

    // Load the HTML into Cheerio for parsing
    const $ = cheerio.load(html);

    // Extract match result
    const matchResult = $(".cb-text-complete").text().trim();

    // Helper function to extract innings data
    function extractInningsData(innings) {
      const header = innings.find(".cb-scrd-hdr-rw span").first().text().trim();
      const battingTeam = header.replace(" Innings", "");
      // Assume the opposing team is the bowling team (simplified logic)
      const bowlingTeam =
        battingTeam === "South Africa A" ? "West Indies A" : "South Africa A";

      // Extract batting, extras, and total
      const battingDiv = innings.find(".cb-ltst-wgt-hdr").first();
      const items = battingDiv.find(".cb-scrd-itms");
      const batting = [];
      let extras, total;

      items.each((i, el) => {
        const firstCol = $(el).find(".cb-col-25, .cb-col-60").first();
        if (firstCol.find("a").length) {
          // Batsman data
          const name = firstCol.find("a").text().trim();
          const dismissal = $(el).find(".cb-col-33").text().trim();
          const runs =
            parseInt($(el).find(".cb-col-8").eq(0).text().trim(), 10) || 0;
          const balls =
            parseInt($(el).find(".cb-col-8").eq(1).text().trim(), 10) || 0;
          const fours =
            parseInt($(el).find(".cb-col-8").eq(2).text().trim(), 10) || 0;
          const sixes =
            parseInt($(el).find(".cb-col-8").eq(3).text().trim(), 10) || 0;
          const sr =
            parseFloat($(el).find(".cb-col-8").eq(4).text().trim()) || 0;
          batting.push({ name, dismissal, runs, balls, fours, sixes, sr });
        } else {
          const label = firstCol.text().trim();
          if (label === "Extras") {
            extras =
              $(el).find(".cb-col-8").text().trim() +
              " " +
              $(el).find(".cb-col-32").text().trim();
          } else if (label === "Total") {
            total =
              $(el).find(".cb-col-8").text().trim() +
              " " +
              $(el).find(".cb-col-32").text().trim();
          }
        }
      });

      // Extract bowling
      const bowlingDiv = innings.find(".cb-ltst-wgt-hdr").last();
      const bowlers = bowlingDiv.find(".cb-scrd-itms");
      const bowling = [];

      bowlers.each((i, el) => {
        const name = $(el).find(".cb-col-38 a").text().trim();
        const overs =
          parseFloat($(el).find(".cb-col-8").eq(0).text().trim()) || 0;
        const maidens =
          parseInt($(el).find(".cb-col-8").eq(1).text().trim(), 10) || 0;
        const runs =
          parseInt($(el).find(".cb-col-10").eq(0).text().trim(), 10) || 0;
        const wickets =
          parseInt($(el).find(".cb-col-8").eq(2).text().trim(), 10) || 0;
        const nb =
          parseInt($(el).find(".cb-col-8").eq(3).text().trim(), 10) || 0;
        const wd =
          parseInt($(el).find(".cb-col-8").eq(4).text().trim(), 10) || 0;
        const eco =
          parseFloat($(el).find(".cb-col-10").eq(1).text().trim()) || 0;
        bowling.push({ name, overs, maidens, runs, wickets, nb, wd, eco });
      });

      // Extract fall of wickets
      const fowDiv = innings.find(".cb-col-rt.cb-font-13");
      const fowText = fowDiv.text().trim();
      const fallOfWickets = fowText
        ? fowText.split(", ").map((item) => item.trim())
        : [];

      return {
        battingTeam,
        bowlingTeam,
        total,
        extras,
        batting,
        bowling,
        fallOfWickets,
      };
    }

    // Extract innings data for both teams
    const innings1 = $("#innings_1");
    const innings2 = $("#innings_2");
    const innings1Data = extractInningsData(innings1);
    const innings2Data = innings2.length ? extractInningsData(innings2) : null;

    // Extract match info
    const matchInfoDiv = $(".cb-col-100.cb-font-13");
    const matchInfo = {};
    matchInfoDiv.find(".cb-mtch-info-itm").each((i, el) => {
      const key = $(el)
        .find(".cb-col-27")
        .text()
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_");
      const value = $(el).find(".cb-col-73").text().trim();
      matchInfo[key] = value;
    });

    // Extract squad details
    const squadDivs = $(".cb-minfo-tm-nm");
    const squads = {
      "Team 1": {
        playing: squadDivs
          .eq(1)
          .find(".cb-col-73 a")
          .map((i, el) => $(el).text().trim())
          .get(),
        bench: squadDivs
          .eq(2)
          .find(".cb-col-73 a")
          .map((i, el) => $(el).text().trim())
          .get(),
      },
      "Team 2": {
        playing: squadDivs
          .eq(4)
          .find(".cb-col-73 a")
          .map((i, el) => $(el).text().trim())
          .get(),
        bench: squadDivs
          .eq(5)
          .find(".cb-col-73 a")
          .map((i, el) => $(el).text().trim())
          .get(),
      },
    };

    // Construct the final JSON output
    const jsonData = {
      matchResult,
      innings: innings2Data ? [innings1Data, innings2Data] : [innings1Data],
      matchInfo,
      squads,
    };

    // Output the structured data
    console.log(JSON.stringify(jsonData, null, 2));
  } catch (error) {
    console.error("Error fetching or parsing the scoreboard:", error.message);
  }
}

// Example usage with a dynamic URL
const url =
  "https://www.cricbuzz.com/live-cricket-scorecard/118367/wia-vs-rsaa-2nd-unofficial-test-south-africa-a-tour-of-west-indies-2025";
fetchScorecard(url);
