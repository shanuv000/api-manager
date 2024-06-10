const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const router = express.Router();
const url =
  "https://www.espncricinfo.com/series/icc-men-s-t20-world-cup-2024-1411166/points-table-standings";

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
    data.title = $("h1.ds-text-title-m.ds-font-bold.ds-my-2.lg-min\\:ds-mx-2")
      .text()
      .trim();

    // Initialize groups array
    data.groups = [];

    let currentGroup = null;

    // Iterate over each row, checking for group headers and team data rows
    $(
      ".ds-w-full.ds-table tbody tr, .ds-flex.ds-px-4.ds-border-b.ds-border-line.ds-py-3"
    ).each((index, element) => {
      if ($(element).hasClass("ds-flex")) {
        // This is a group header
        currentGroup = {
          groupName: $(element)
            .find(".ds-text-tight-s.ds-font-bold.ds-uppercase")
            .text()
            .trim(),
          teams: [],
        };
        data.groups.push(currentGroup);
      } else {
        // This is a team data row
        const cells = $(element).find("td");
        if (cells.length >= 12) {
          const teamData = {
            team: cells.eq(0).text().trim().slice(1),
            matches: cells.eq(1).text().trim(),
            wins: cells.eq(2).text().trim(),
            losses: cells.eq(3).text().trim(),
            ties: cells.eq(4).text().trim(),
            noResult: cells.eq(5).text().trim(),
            points: cells.eq(6).text().trim(),
            netRunRate: cells.eq(7).text().trim(),
            seriesForm: cells.eq(8).text().trim(),
            nextMatch: {
              nextMatches: cells.eq(9).text().trim(),
              for: cells.eq(10).text().trim(),
              against: cells.eq(11).text().trim(),
            },
          };
          currentGroup.teams.push(teamData);
        } else {
          console.warn(`Skipped row ${index + 1} due to insufficient data.`);
        }
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

module.exports = router;
