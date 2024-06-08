const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const router = express.Router();

const fetchScores = async () => {
  const url = "https://www.espncricinfo.com/live-cricket-score";
  const url2 =
    "https://www.espncricinfo.com/live-cricket-score?quick_class_id=intl";
  const { data } = await axios.get(url2);
  const $ = cheerio.load(data);

  const matches = [];

  // Parsing regular matches
  const regularMatchElements = $("div.ds-px-4.ds-py-3");
  regularMatchElements.each((index, element) => {
    try {
      const teams = $(element).find("div.ci-team-score");
      if (teams.length < 2) {
        return;
      }

      const team1Data = teams.eq(0);
      const team2Data = teams.eq(1);

      const team1Name =
        team1Data
          .find("p.ds-text-tight-m.ds-font-bold.ds-capitalize.ds-truncate")
          .text() || "N/A";
      const team1Score = team1Data.find("strong").text() || "N/A";

      const team2Name =
        team2Data
          .find("p.ds-text-tight-m.ds-font-bold.ds-capitalize.ds-truncate")
          .text() || "N/A";
      const team2Score = team2Data.find("strong").text() || "N/A";

      const resultElement = $(element).find(
        "p.ds-text-tight-s.ds-font-medium.ds-truncate.ds-text-typo"
      );
      const result = resultElement.text() || "Result not available";

      // Extracting the heading of match status
      const headingElement = $(element).find(
        "span.ds-text-tight-xs.ds-font-bold.ds-uppercase.ds-leading-5"
      );
      const headingOfMatchStatus = headingElement.text() || "N/A";

      // Extracting the commentary
      const commentaryElement = $(element).find(
        "p.ds-text-tight-s.ds-font-medium.ds-truncate.ds-text-typo span"
      );
      const commentary = commentaryElement.text() || "N/A";

      // Extracting the time and place
      const timeAndPlaceElement = $(element).find(
        "div.ds-text-tight-xs.ds-truncate.ds-text-typo-mid3"
      );
      const timeAndPlace = timeAndPlaceElement.text().trim() || "N/A";

      // Extracting the overs and wickets for team1
      const team1AdditionalInfoElement = team1Data.find(
        "div.ds-text-compact-s.ds-text-typo.ds-text-right.ds-whitespace-nowrap"
      );

      const oversAndWickets =
        team1AdditionalInfoElement.find("span").text() || "N/A";
      const team1AdditionalScore =
        team1AdditionalInfoElement.find("strong").text() || "N/A";

      matches.push({
        team1: team1Name,
        team1_score: team1Score,
        team1_overs_and_wickets: oversAndWickets, // Extracted overs and wickets for team1
        team1_additional_score: team1AdditionalScore, // Extracted additional score for team1
        team2: team2Name,
        team2_score: team2Score,
        result: result,
        heading_of_match_status: headingOfMatchStatus, // Added heading of match status
        commentary: commentary, // Added commentary
        time_and_place: timeAndPlace, // Added time and place
      });
    } catch (error) {
      console.error("Error parsing match element:", error);
    }
  });

  return matches;
};

router.get("/espn", async (req, res) => {
  try {
    const scores = await fetchScores();
    res.json(scores);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch scores" });
  }
});

module.exports = router;
