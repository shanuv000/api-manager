const express = require("express");
const sendEmail = require("../component/sendEmail");
const { scrapeMatches } = require("./Cricket/liveScores");
const sendWhatsAppMessage = require("../component/sendWhatsAppMeassage");
const { sendMessage } = require("../component/telegram/telegramBot"); // Correct import
const router = express.Router();
const phoneNumbers = ["whatsapp:+917903778038"];
const liveUrl = "https://www.cricbuzz.com/cricket-match/live-scores";

const chatId = "866021016"; // Define your chat ID globally or fetch dynamically if needed

router.get("/", async (req, res) => {
  try {
    const matches = await scrapeMatches(liveUrl);
    const filteredMatches = matches.filter(
      (match) =>
        match.playingTeamBat.includes("WI") ||
        match.playingTeamBall.includes("WI")
    );

    if (filteredMatches.length > 0) {
      let WAmessageBody = filteredMatches
        .map(
          (match, index) => `
*Match ${index + 1}*\n
*Title:* ${match.title}\n
*Playing Team Bat:* ${match.playingTeamBat} *${match.liveScorebat}*\n
*Playing Team Ball:* ${match.playingTeamBall} *${match.liveScoreball}*\n
*Match Details:* ${match.matchDetails}\n
*Heading:* ${match.heading}\n
*Location:* ${match.location}\n

*${match.liveCommentary}\n* 
*Live Score:* ${match.liveScoreLink}\n
`
        )
        .join("\n\n");

      // await sendWhatsAppMessage(WAmessageBody, phoneNumbers);
      // await sendEmail(filteredMatches);
      await sendMessage(chatId, WAmessageBody, "Markdown"); // Sending message via Telegram bot with Markdown parse mode
      res
        .status(200)
        .json({ message: "Messages sent successfully", filteredMatches });
    } else {
      // await sendMessage(chatId, "No INDIAN MATCH is live", "Markdown");
      await sendMessage(chatId, { statue: "No india Match" });
      res
        .status(200)
        .json({ message: "No INDIAN MATCH is live", filteredMatches });
    }
  } catch (error) {
    console.error("Error in route handler:", error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
