const axios = require("axios");

/**
 * Send a message to a specific chat
 * @param {object} bot - Telegram bot instance
 * @param {number} chatId - The chat ID to send the message to
 * @param {string} message - The message content
 * @param {string} parseMode - The parse mode for formatting (default: Markdown)
 */
const sendMessage = (bot, chatId, message, parseMode = "Markdown") => {
  return bot.sendMessage(chatId, message, { parse_mode: parseMode });
};

/**
 * Fetch data from an external API
 * @returns {object|null} - The fetched data or null in case of an error
 */
const fetchScoreData = async () => {
  try {
    console.log("Fetching data from API...");
    const response = await axios.get("https://api-sync.vercel.app/api/test");
    console.log("API Response:", response.data);
    return response.data;
  } catch (error) {
    console.error("Error fetching data from API:", error.message);
    return null; // Return null if an error occurs
  }
};

/**
 * Handle incoming commands
 * @param {object} bot - Telegram bot instance
 * @param {object} msg - The incoming message object
 */
const handleCommand = async (bot, msg) => {
  const chatId = msg.chat.id; // Chat ID of the incoming message
  const text = msg.text; // The message content
  const userName = msg.from.first_name || "User"; // Sender's first name

  switch (text) {
    case "/start":
      sendMessage(
        bot,
        chatId,
        `👋 Hi ${userName}!\n\nWelcome to the Telegram bot! Here’s what I can do for you:\n\n` +
          `/score - Fetch the latest score data\n` +
          `/live - Get live updates\n` +
          `/about - Learn more about this bot\n` +
          `/settings - Adjust your preferences\n` +
          `/help - Get a list of all available commands`
      );
      break;

    case "/help":
      sendMessage(
        bot,
        chatId,
        `🛠 *Help Menu*\n\nHere are the available commands:\n\n` +
          `/start - Start interacting with the bot\n` +
          `/help - Get a list of all commands\n` +
          `/score - Fetch the latest score data\n` +
          `/live - Get live updates\n` +
          `/about - Learn more about this bot\n` +
          `/settings - Adjust your preferences`,
        "Markdown"
      );
      break;

    case "/score":
      const data = await fetchScoreData();
      if (data) {
        sendMessage(
          bot,
          chatId,
          `📊 *Score Data*\n\n${userName}, here is the score data:\n\`\`\`\n${JSON.stringify(
            data,
            null,
            2
          )}\n\`\`\``,
          "Markdown"
        );
      } else {
        sendMessage(
          bot,
          chatId,
          `${userName}, I couldn't fetch the score data. Please try again later.`,
          "Markdown"
        );
      }
      break;

    case "/live":
      try {
        const response = await axios.get(
          "https://api-sync.vercel.app/api/test"
        );
        sendMessage(
          bot,
          chatId,
          `🔴 *Live Updates*\n\n${userName}, live data fetched successfully:\n\`\`\`\n${JSON.stringify(
            response.data,
            null,
            2
          )}\n\`\`\``,
          "Markdown"
        );
      } catch (error) {
        sendMessage(
          bot,
          chatId,
          `${userName}, an error occurred while fetching live updates.`,
          "Markdown"
        );
      }
      break;

    case "/about":
      sendMessage(
        bot,
        chatId,
        `🤖 *About This Bot*\n\n` +
          `This bot was created to provide live updates and score data using Telegram Bot API. ` +
          `It’s a simple and interactive tool for getting real-time information.\n\n` +
          `Developed by: Vaibhav`,
        "Markdown"
      );
      break;

    case "/settings":
      sendMessage(
        bot,
        chatId,
        `⚙️ *Settings*\n\nYou can adjust your preferences here. Use the following commands:\n` +
          `/enable_notifications - Enable notifications\n` +
          `/disable_notifications - Disable notifications`,
        "Markdown"
      );
      break;

    default:
      sendMessage(
        bot,
        chatId,
        `🤔 I didn’t understand that, ${userName}.\nType /help to see the list of available commands.`,
        "Markdown"
      );
      break;
  }
};

module.exports = { handleCommand, sendMessage };
