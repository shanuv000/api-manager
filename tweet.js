require("dotenv").config();
const { TwitterApi } = require("twitter-api-v2");

// Initialize Twitter client with the Bearer token
const client = new TwitterApi(process.env.TWITTER_BEARER_TOKEN);

const rwClient = client.readWrite;

const tweet = async (message) => {
  try {
    const response = await rwClient.v2.tweet(message);
    console.log("Tweeted successfully!", response);
  } catch (error) {
    console.error("Error while tweeting:", error);
  }
};

// Example usage
tweet("Hello, this is an automated tweet!");
