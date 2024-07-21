const express = require("express");
const cheerio = require("cheerio");
const axios = require("axios");

const router = express.Router();
const app = express();

const url =
  "https://www.cricbuzz.com/cricket-series/7476/icc-mens-t20-world-cup-2024/points-table";
const url2 =
  "https://www.espncricinfo.com/series/women-s-asia-cup-2024-1426636/points-table-standings";
router.get("/schedule2", async (req, res) => {
  try {
    // Fetch the HTML from the URL
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    const pointsTable = [{ success: true }];
    let groupName = "";

    // Find each points table group
    $("table.cb-srs-pnts").each((i, table) => {
      // Extract the group name
      groupName = $(table).find("thead th").first().text().trim();

      // Process each team row within the group
      $(table)
        .find("tbody > tr")
        .each((j, row) => {
          const rowData = {};
          const columns = $(row).find("td");

          if (columns.length > 1) {
            // Extract team name and image URL
            const teamCell = $(columns[0]);
            rowData.team = teamCell.find("div.cb-col-84").text().trim();
            rowData.image = teamCell.find("img").attr("src");
            rowData.group = groupName;

            // Extract other columns data
            rowData.mat = $(columns[1]).text().trim();
            rowData.won = $(columns[2]).text().trim();
            rowData.lost = $(columns[3]).text().trim();
            rowData.tied = $(columns[4]).text().trim();
            rowData.nr = $(columns[5]).text().trim();
            rowData.pts = $(columns[6]).text().trim();
            rowData.nrr = $(columns[7]).text().trim();

            if (rowData.team) {
              pointsTable.push(rowData);
            }

            const detailedRows = $(row)
              .next()
              .find(".cb-srs-pnts-dwn-tbl tbody tr");
            if (detailedRows.length) {
              rowData.details = [];
              detailedRows.each((k, detailRow) => {
                const detailColumns = $(detailRow).find("td");
                const detailData = {
                  opponent: $(detailColumns[0]).text().trim(),
                  description: $(detailColumns[1]).text().trim(),
                  date: $(detailColumns[2]).text().trim(),
                  result: $(detailColumns[3]).text().trim(),
                };
                rowData.details.push(detailData);
              });
            }
          }
        });
    });

    res.json(pointsTable);
  } catch (error) {
    console.error("Error fetching the data:", error);
    res.status(500).send("Error fetching the data");
  }
});
module.exports = router;
