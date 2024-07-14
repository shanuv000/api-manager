const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
require("dotenv").config(); // Load environment variables from .env file

// Get the bot token from environment variables
const token = process.env.TELEGRAM_BOT_TOKEN;

// Create a new instance of the Telegram bot with the provided token
const bot = new TelegramBot(token, { polling: true });

// Function to send a message to a specific chat
const sendMessage = (chatId, message, parseMode = "Markdown") => {
  return bot.sendMessage(chatId, message, { parse_mode: parseMode });
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

// Function to fetch data from the API
const fetchScoreData = async () => {
  try {
    const response = await axios.get("https://api-sync.vercel.app/api/test"); // Replace with your actual API URL
    return response.data;
  } catch (error) {
    console.error("Error fetching data from API:", error);
    return null;
  }
};

// Event listener for incoming messages
bot.on("message", async (msg) => {
  const chatId = msg.chat.id; // Get the chat ID from the received message
  const text = msg.text;
  const userName = msg.from.first_name; // Get the user's first name

  if (text === "/score") {
    const data = await fetchScoreData();
    if (data) {
      sendMessage(
        chatId,
        `${userName}, here is the score data: ${JSON.stringify(data, null, 2)}`,
        "Markdown"
      );
    } else {
      sendMessage(
        chatId,
        `${userName}, failed to fetch score data.`,
        "Markdown"
      );
    }
  } else if (text === "/live") {
    try {
      const liveData = await axios.get("https://api-sync.vercel.app/api/test");
    } catch (error) {
      sendMessage(
        chatId,
        `${userName}, an error occurred while fetching live data.`,
        "Markdown"
      );
    }
  } else {
    sendMessage(
      chatId,
      `Got your message, ${userName}! I'll get back to you soon.`,
      "Markdown"
    ); // Send a response back to the same chat
  }
});

// Export the functions for use in other parts of the application
module.exports = { createWebhookHandler, sendMessage, setWebhook };
