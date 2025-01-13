const express = require("express");
const { scrapeMatches } = require("../Cricket/liveScores");
const { sendMessage } = require("../../component/telegram/telegramBot");
const router = express.Router();

const liveUrl =
  "https://www.cricbuzz.com/cricket-match/live-scores/recent-matches";
const chatId = "866021016"; // Replace with your Telegram chat ID

router.get("/recent", async (req, res) => {
  try {
    const matches = await scrapeMatches(liveUrl);

    if (matches.length > 0) {
      // Group matches into chunks of 5 games per message
      const chunkSize = 5;
      const matchChunks = [];

      for (let i = 0; i < matches.length; i += chunkSize) {
        matchChunks.push(matches.slice(i, i + chunkSize));
      }

      // Send each chunk as a separate message
      for (const [chunkIndex, chunk] of matchChunks.entries()) {
        let WAmessageBody = `🏏 *Upcoming Matches - Group ${
          chunkIndex + 1
        }*\n\n`;

        WAmessageBody += chunk
          .map(
            (match, index) => `
*Game ${chunkIndex * chunkSize + index + 1}*\n
*Title:* ${match.title || "N/A"}\n
*Match Details:* ${match.matchDetails || "N/A"}\n
*Heading:* ${match.heading || "N/A"}\n
*Location:* ${match.location || "N/A"}\n
*Playing Team Bat:* ${match.playingTeamBat || "N/A"} *(${
              match.liveScorebat || "N/A"
            })*\n
*Playing Team Ball:* ${match.playingTeamBall || "N/A"} *(${
              match.liveScoreball || "N/A"
            })*\n
[Live Score](${match.liveScoreLink || "#"})\n
`
          )
          .join("\n");

        // Send the message chunk
        await sendMessage(chatId, WAmessageBody, "Markdown");
      }

      res.status(200).json({ message: "Messages sent successfully", matches });
    } else {
      const fallbackMessage = "No upcoming matches are available.";
      await sendMessage(chatId, fallbackMessage, "Markdown");
      res.status(200).json({ message: fallbackMessage, matches });
    }
  } catch (error) {
    console.error("Error in route handler:", error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
