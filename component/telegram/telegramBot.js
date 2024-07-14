const TelegramBot = require("node-telegram-bot-api");

// Replace with your bot token from BotFather
const token = "7464816552:AAHvDb4iOmWIeP5Xy35_bHS9M6S44HTs8so";

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(token, { polling: true });

// Function to send a message
const sendMessage = (chatId, message) => {
  return bot.sendMessage(chatId, message);
};

module.exports = { bot, sendMessage };
