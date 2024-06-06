const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const router = express.Router();
const url =
  "https://www.espncricinfo.com/series/icc-men-s-t20-world-cup-2024-1411166/points-table-standings";

// Function to fetch and scrape data
async function fetchData() {
  try {
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    console.error(`Error fetching data: ${error}`);
    return null;
  }
}

// Function to scrape and structure data into JSON
async function scrapeData() {
  const html = await fetchData();
  if (!html) {
    return [];
  }

  const $ = cheerio.load(html);
  const data = [];

  $(".ds-table tbody tr").each((index, element) => {
    const teamData = {};
    const cells = $(element).find("td");
    console.log(cells);
    if (cells.length >= 9) {
      //   teamData.position = cells.eq(0).text().trim();
      teamData.team = cells.eq(0).text().trim().slice(1);
      teamData.matches = cells.eq(1).text().trim();
      teamData.wins = cells.eq(2).text().trim();
      teamData.losses = cells.eq(3).text().trim();
      teamData.ties = cells.eq(4).text().trim();
      teamData.noResult = cells.eq(5).text().trim();
      teamData.points = cells.eq(6).text().trim();
      teamData.netRunRate = cells.eq(7).text().trim();
      teamData.seriesForm = cells.eq(8).text().trim();

      data.push(teamData);
    }
  });

  return data;
}

// Define the route
router.get("/", async (req, res) => {
  try {
    console.log("Fetching T20 World Cup data");
    const data = await scrapeData();
    res.json(data);
  } catch (error) {
    console.error("Error fetching T20 World Cup data:", error);
    res.status(500).json({ error: "Error fetching T20 World Cup data" });
  }
});

module.exports = router;
