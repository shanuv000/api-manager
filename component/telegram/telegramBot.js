const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
require("dotenv").config(); // Load environment variables from .env file

// Get the bot token from environment variables
const token = process.env.TELEGRAM_BOT_TOKEN;

// Create a new instance of the Telegram bot with polling mode enabled
const bot = new TelegramBot(token, { polling: true });

// Function to send a message to a specific chat
const sendMessage = async (chatId, message, parseMode = "Markdown") => {
  try {
    await bot.sendMessage(chatId, message, { parse_mode: parseMode });
  } catch (error) {
    console.error(`Error sending message to chat ${chatId}:`, error.message);
  }
};

// Function to fetch match data from the API
const fetchScoreData = async () => {
  try {
    const response = await axios.get("https://api-sync.vercel.app/api/test"); // Replace with your actual API URL
    return response.data;
  } catch (error) {
    console.error("Error fetching data from API:", error.message);
    return null;
  }
};

// Format match data into readable text for Telegram
const formatMatchData = (matches) => {
  if (!matches || matches.length === 0) {
    return "*No live matches are available.*";
  }

  return matches
    .map((match, index) => {
      return `
*Match ${index + 1}:*
*Title:* ${match.title || "N/A"}
*Details:* ${match.matchDetails || "N/A"}
*Location:* ${match.location || "N/A"}
*Team Bat:* ${match.playingTeamBat || "N/A"} (${match.liveScorebat || "N/A"})
*Team Ball:* ${match.playingTeamBall || "N/A"} (${match.liveScoreball || "N/A"})
*Commentary:* ${match.liveCommentary || "N/A"}
[Live Score](${match.liveScoreLink || "#"})
      `;
    })
    .join("\n\n");
};

// Event listener for incoming messages
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const userName = msg.from.first_name;

  try {
    if (text === "/score" || text === "/live") {
      const data = await fetchScoreData();
      if (data && data.filteredMatches && data.filteredMatches.length > 0) {
        const formattedData = formatMatchData(data.filteredMatches);
        sendMessage(
          chatId,
          `${userName}, here is the match data:\n\n${formattedData}`
        );
      } else {
        sendMessage(chatId, `${userName}, no matches found.`);
      }
    } else {
      sendMessage(chatId, `Hi ${userName}, I don't recognize that command.`);
    }
  } catch (error) {
    console.error("Error processing message:", error.message);
    sendMessage(chatId, "An error occurred. Please try again later.");
  }
});

module.exports = { sendMessage };
