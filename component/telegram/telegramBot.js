const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
require("dotenv").config(); // Load environment variables from .env file

// Get the bot token from environment variables
const token = process.env.TELEGRAM_BOT_TOKEN;

// Create a new instance of the Telegram bot with polling mode enabled
const bot = new TelegramBot(token, { polling: true });

/**
 * Function to send a message to a specific chat
 * @param {number} chatId - The chat ID to send the message to
 * @param {string} message - The message content
 * @param {string} parseMode - The parse mode for formatting (default: Markdown)
 */
const sendMessage = async (chatId, message, parseMode = "Markdown") => {
  try {
    await bot.sendMessage(chatId, message, { parse_mode: parseMode });
  } catch (error) {
    console.error(`Error sending message to chat ${chatId}:`, error.message);
  }
};

/**
 * Function to fetch match data from the provided API URL
 * @param {string} apiUrl - The API URL to fetch data from
 * @returns {Array|null} - Match data or null in case of an error
 */
const fetchMatchData = async (apiUrl) => {
  try {
    const response = await axios.get(apiUrl);
    return response.data || null;
  } catch (error) {
    console.error(`Error fetching data from ${apiUrl}:`, error.message);
    return null;
  }
};

/**
 * Format match data into readable text for Telegram
 * @param {Array} matches - Array of match data
 * @returns {string} - Formatted match data
 */
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
[Live Score](${match.liveScoreLink || "#"})`;
    })
    .join("\n\n");
};

/**
 * Handle incoming messages and commands
 */
bot.on("message", async (msg) => {
  const chatId = msg.chat.id; // Chat ID of the sender
  const text = msg.text; // Message text
  const userName = msg.from.first_name || "User"; // Sender's first name

  try {
    switch (text) {
      case "/start":
        sendMessage(
          chatId,
          `👋 Hi ${userName}!\n\nWelcome to the Telegram bot! Here’s what I can do for you:\n\n` +
            `/score - Fetch the latest score data\n` +
            `/live - Get live updates from the API\n` +
            `/show_all_live_matches - Show all live cricket matches\n` +
            `/about - Learn more about the bot and its creator\n` +
            `/settings - Adjust your preferences or notifications\n` +
            `/help - Get a list of all available commands`
        );
        break;

      case "/help":
        sendMessage(
          chatId,
          `🛠 *Help Menu*\n\nHere are the available commands:\n\n` +
            `/start - Start interacting with the bot\n` +
            `/help - Get a list of all available commands\n` +
            `/score - Fetch the latest score data\n` +
            `/live - Get live updates from the API\n` +
            `/show_all_live_matches - Show all live cricket matches\n` +
            `/about - Learn more about the bot and its creator\n` +
            `/settings - Adjust your preferences or notifications`,
          "Markdown"
        );
        break;

      case "/score":
      case "/live":
        const scoreData = await fetchMatchData(
          "https://api-sync.vercel.app/api/test"
        );
        if (scoreData) {
          const formattedData = formatMatchData(scoreData.filteredMatches);
          sendMessage(
            chatId,
            `📊 *Match Data*\n\n${userName}, here is the match data:\n\n${formattedData}`,
            "Markdown"
          );
        } else {
          sendMessage(
            chatId,
            `${userName}, I couldn't fetch match data. Please try again later.`,
            "Markdown"
          );
        }
        break;

      case "/show_all_live_matches":
        const liveMatchesData = await fetchMatchData(
          "https://api-sync.vercel.app/api/cricket/live-scores"
        );
        if (liveMatchesData) {
          const formattedMatches = formatMatchData(liveMatchesData.matches);
          sendMessage(
            chatId,
            `🏏 *All Live Matches*\n\n${userName}, here are the live matches:\n\n${formattedMatches}`,
            "Markdown"
          );
        } else {
          sendMessage(
            chatId,
            `${userName}, I couldn't fetch live matches data. Please try again later.`,
            "Markdown"
          );
        }
        break;

      case "/about":
        sendMessage(
          chatId,
          `🤖 *About This Bot*\n\n` +
            `This bot was created to provide live updates and score data using Telegram Bot API. ` +
            `It’s a simple and interactive tool for getting real-time information.\n\n` +
            `*Developed by:* Vaibhav`,
          "Markdown"
        );
        break;

      case "/settings":
        sendMessage(
          chatId,
          `⚙️ *Settings*\n\nYou can adjust your preferences here. Use the following commands:\n` +
            `/enable_notifications - Enable notifications\n` +
            `/disable_notifications - Disable notifications`,
          "Markdown"
        );
        break;

      default:
        sendMessage(
          chatId,
          `🤔 I didn’t understand that, ${userName}.\nType /help to see the list of available commands.`,
          "Markdown"
        );
        break;
    }
  } catch (error) {
    console.error("Error processing command:", error.message);
    sendMessage(
      chatId,
      "An error occurred. Please try again later.",
      "Markdown"
    );
  }
});

module.exports = { sendMessage };
