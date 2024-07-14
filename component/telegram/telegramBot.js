const TelegramBot = require("node-telegram-bot-api");
require("dotenv").config(); // Load environment variables from .env file

// Get the bot token from environment variables
const token = process.env.TELEGRAM_BOT_TOKEN;

// Create a new instance of the Telegram bot with the provided token
const bot = new TelegramBot(token);

// Function to send a message to a specific chat
const sendMessage = (chatId, message) => {
  return bot.sendMessage(chatId, message);
};

// Function to set the webhook URL for the bot
const setWebhook = (url) => {
  bot.setWebHook(`${url}/bot${token}`);
};

// Function to create an Express app to handle incoming updates from Telegram
const createWebhookHandler = () => {
  const express = require("express");
  const bodyParser = require("body-parser");
  const app = express();

  // Middleware to parse JSON bodies
  app.use(bodyParser.json());

  // Route to handle webhook POST requests from Telegram
  app.post(`/bot${token}`, (req, res) => {
    bot.processUpdate(req.body); // Process the incoming update
    res.sendStatus(200); // Respond with a 200 status code to indicate success
  });

  return app; // Return the Express app
};

// Event listener for incoming messages
bot.on("message", (msg) => {
  const chatId = msg.chat.id; // Get the chat ID from the received message
  bot.sendMessage(chatId, "Got your message! I'll get back to you soon."); // Send a response back to the same chat
});

// Export the functions for use in other parts of the application
module.exports = { createWebhookHandler, sendMessage, setWebhook };
