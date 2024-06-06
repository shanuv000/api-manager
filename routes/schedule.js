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
  if (html) {
    const $ = cheerio.load(html);
    const data = [];

    $(".ds-table tbody tr ").each((index, element) => {
      const teamData = {};

      teamData.position = $(element).find("td").eq(0).text().trim();
      teamData.team = $(element).find("td").eq(1).text().trim();
      teamData.matches = $(element).find("td").eq(2).text().trim();
      teamData.wins = $(element).find("td").eq(3).text().trim();
      teamData.losses = $(element).find("td").eq(4).text().trim();
      teamData.ties = $(element).find("td").eq(5).text().trim();
      teamData.noResult = $(element).find("td").eq(6).text().trim();
      teamData.points = $(element).find("td").eq(7).text().trim();
      teamData.netRunRate = $(element).find("td").eq(8).text().trim();

      data.push(teamData);
    });

    return data;
  }
  return [];
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
