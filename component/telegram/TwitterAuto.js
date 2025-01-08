require("dotenv").config();
const { TwitterApi } = require("twitter-api-v2");

// Initialize Twitter client with your credentials
const client = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_KEY_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

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
