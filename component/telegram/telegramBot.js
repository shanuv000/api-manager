const TelegramBot = require("node-telegram-bot-api");

// Replace with your bot token from BotFather
const token = "7464816552:AAHvDb4iOmWIeP5Xy35_bHS9M6S44HTs8so";

// Create a bot instance without polling
const bot = new TelegramBot(token);

// Function to send a message
const sendMessage = (chatId, message) => {
  return bot.sendMessage(chatId, message);
};

// Set the webhook URL
const setWebhook = (url) => {
  bot.setWebHook(`${url}/bot${token}`);
};

// Create a function to handle incoming updates from Telegram
const createWebhookHandler = () => {
  const express = require("express");
  const bodyParser = require("body-parser");
  const app = express();
  app.use(bodyParser.json());

  app.post(`/bot${token}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });

  return app;
};

// Example of handling a text message
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "Received your message");
});

module.exports = { createWebhookHandler, sendMessage, setWebhook };
