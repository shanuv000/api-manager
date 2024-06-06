const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const router = express.Router();
//
router.get("/", async (req, res) => {
  try {
    console.log("Fetching live scores");
    const { data } = await axios.get(
      "https://www.cricbuzz.com/cricket-match/live-scores"
    );
    const $ = cheerio.load(data);

    let liveScores = [];

    $("div.cb-col.cb-col-100.cb-ltst-wgt-hdr").each((i, elem) => {
      const matchTitle =
        $(elem).find("a.cb-lv-scrs-well-live").attr("title") ||
        $(elem).find("a.cb-lv-scrs-well").attr("title");
      const matchLink =
        $(elem).find("a.cb-lv-scrs-well-live").attr("href") ||
        $(elem).find("a.cb-lv-scrs-well").attr("href");
      const team1 = $(elem)
        .find("div.cb-hmscg-bat-txt div.cb-hmscg-tm-nm")
        .first()
        .text()
        .trim();
      const score1 = $(elem)
        .find("div.cb-hmscg-bat-txt div.cb-ovr-flo")
        .first()
        .text()
        .trim();
      const team2 = $(elem)
        .find("div.cb-hmscg-bwl-txt div.cb-hmscg-tm-nm")
        .first()
        .text()
        .trim();
      const score2 = $(elem)
        .find("div.cb-hmscg-bwl-txt div.cb-ovr-flo")
        .first()
        .text()
        .trim();
      const matchStatus =
        $(elem).find("div.cb-text-live").text().trim() ||
        $(elem).find("div.cb-text-complete").text().trim() ||
        $(elem).find("div.cb-text-preview").text().trim();

      if (matchTitle && matchLink) {
        liveScores.push({
          matchTitle: matchTitle.trim(),
          matchLink: `https://www.cricbuzz.com${matchLink.trim()}`,
          team1,
          score1,
          team2,
          score2,
          matchStatus,
        });
      }
    });

    console.log("Sending live scores response");
    res.json(liveScores);
  } catch (error) {
    console.error("Error fetching live scores:", error);
    res.status(500).json({ error: "Error fetching live scores" });
  }
});

module.exports = router;
