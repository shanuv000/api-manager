const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const router = express.Router();
const url =
  "https://www.cricbuzz.com/cricket-series/9237/indian-premier-league-2025/points-table";

async function fetchData() {
  try {
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    throw new Error(`Error fetching data: ${error.message}`);
  }
}

async function scrapeData() {
  try {
    const html = await fetchData();
    const $ = cheerio.load(html);
    const data = {};

    // Extract the title
    data.title = $("h1.cb-nav-hdr.cb-font-24.line-ht30").text().trim();

    // Initialize teams array
    data.teams = [];

    // Iterate over each team row in the points table
    $("table.cb-srs-pnts tbody tr").each((index, element) => {
      // Check if it's a team row (not the details row)
      if ($(element).find(".cb-srs-pnts-name").length > 0) {
        const teamData = {
          team: $(element)
            .find(".cb-srs-pnts-name .cb-col-84")
            .text()
            .trim()
            .replace(/\s*\(E\)$/, ""), // Remove (E) if present
          teamImage: $(element).find(".cb-srs-pnts-name img").attr("src"),
          matches: $(element).find(".cb-srs-pnts-td").eq(0).text().trim(),
          wins: $(element).find(".cb-srs-pnts-td").eq(1).text().trim(),
          losses: $(element).find(".cb-srs-pnts-td").eq(2).text().trim(),
          tied: $(element).find(".cb-srs-pnts-td").eq(3).text().trim(),
          noResult: $(element).find(".cb-srs-pnts-td").eq(4).text().trim(),
          points: $(element).find(".cb-srs-pnts-td").eq(5).text().trim(),
          netRunRate: $(element).find(".cb-srs-pnts-td").eq(6).text().trim(),
          matchesPlayed: [],
        };

        // Extract match details from the nested table
        const teamId = $(element)
          .next()
          .find(".cb-srs-pnts-dwn div")
          .attr("id");
        $(element)
          .next()
          .find(`#${teamId} table.cb-srs-pnts-dwn-tbl tbody tr`)
          .each((i, match) => {
            const matchData = {
              opponent: $(match).find("td").eq(0).text().trim(),
              description: $(match).find("td").eq(1).text().trim(),
              date: $(match).find("td").eq(2).text().trim(),
              result: $(match).find("td").eq(3).text().trim(),
              matchLink: $(match).find("td a").attr("href") || "",
            };
            teamData.matchesPlayed.push(matchData);
          });

        data.teams.push(teamData);
      }
    });

    return data;
  } catch (error) {
    throw new Error(`Error scraping data: ${error.message}`);
  }
}

router.get("/schedule", async (req, res) => {
  try {
    const data = await scrapeData();

    // Standardized JSON response format
    res.json({
      success: true,
      data: data,
    });
  } catch (error) {
    console.error("Error fetching/scraping data:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});
//save
module.exports = router;
