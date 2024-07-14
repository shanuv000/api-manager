const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const bodyParser = require("body-parser");

const token = "7464816552:AAHvDb4iOmWIeP5Xy35_bHS9M6S44HTs8so";
const bot = new TelegramBot(token);

// Replace with your webhook URL
const url = "https://api-sync.vercel.app";

// Set up the webhook
bot.setWebHook(`${url}/bot${token}`);

// Create a function to handle incoming updates from Telegram
const createWebhookHandler = () => {
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

module.exports = { createWebhookHandler };
