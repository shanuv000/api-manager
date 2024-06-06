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
    throw new Error(`Error fetching data: ${error.message}`); // Throw an error for easier handling
  }
}

async function scrapeData() {
  try {
    const html = await fetchData();

    const $ = cheerio.load(html);
    const data = [];

    $(".ds-table tbody tr").each((index, element) => {
      const teamData = {};

      const cells = $(element).find("td");
      if (cells.length >= 12) {
        // Ensure enough cells for the data
        teamData.team = cells.eq(0).text().trim().slice(1);
        teamData.matches = cells.eq(1).text().trim();
        teamData.wins = cells.eq(2).text().trim();
        teamData.losses = cells.eq(3).text().trim();
        teamData.ties = cells.eq(4).text().trim();
        teamData.noResult = cells.eq(5).text().trim();
        teamData.points = cells.eq(6).text().trim();
        teamData.netRunRate = cells.eq(7).text().trim();
        teamData.seriesForm = cells.eq(8).text().trim();
        teamData.nextMatch = {
          nextMatches: cells.eq(9).text().trim(),
          for: cells.eq(10).text().trim(),
          against: cells.eq(11).text().trim(),
        };

        data.push(teamData);
      } else {
        console.warn(`Skipped row ${index + 1} due to insufficient data.`);
      }
    });

    return data;
  } catch (error) {
    throw new Error(`Error scraping data: ${error.message}`); // Throw an error for easier handling
  }
}

router.get("/", async (req, res) => {
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
      error: error.message, // Send a more specific error message
    });
  }
});

module.exports = router;
