const express = require("express");
const sendEmail = require("../component/sendEmail");
const { scrapeMatches } = require("./Cricket/liveScores");
const sendWhatsAppMessage = require("../component/sendWhatsAppMeassage");

const router = express.Router();
const phoneNumbers = ["whatsapp:+917903778038"];
const liveUrl = "https://www.cricbuzz.com/cricket-match/live-scores";

router.get("/", async (req, res) => {
  try {
    const matches = await scrapeMatches(liveUrl);

    const filteredMatches = matches.filter(
      (match) =>
        match.playingTeamBat === "IND" || match.playingTeamBall === "IND"
    );

    if (filteredMatches.length > 0) {
      const match = filteredMatches[0]; // Assuming you only want to send the first match
      const WAmessageBody = `
*Title:* ${match.title}
*Match Details:* ${match.matchDetails}
*Heading:* ${match.heading}
*Location:* ${match.location}
*Playing Team Bat:* ${match.playingTeamBat} ${match.liveScorebat}
*Playing Team Ball:* ${match.playingTeamBall} ${match.liveScoreball}
*Live Commentary:* ${match.liveCommentary}
`;

      // await sendWhatsAppMessage(WAmessageBody, phoneNumbers);
      await sendEmail(filteredMatches);
      res
        .status(200)
        .json({ message: "Messages sent successfully", filteredMatches });
    } else {
      res
        .status(200)
        .json({ message: "No Indian match is live", filteredMatches });
    }
  } catch (error) {
    console.error("Error in route handler:", error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
