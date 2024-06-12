const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cron = require("node-cron");
const nodemailer = require("nodemailer");

const router = express.Router();

// URL of the website you want to scrape
const url = "https://www.cricbuzz.com/cricket-match/live-scores";

// Function to fetch and scrape the webpage
async function fetchLiveScores() {
  try {
    console.log("Fetching live scores...");
    const response = await axios.get(url);
    const html = response.data;
    const $ = cheerio.load(html); // Load HTML into cheerio

    const matches = []; // Array to hold match details

    // Select each match element and extract information
    $(".cb-mtch-lst.cb-col.cb-col-100.cb-tms-itm").each((index, element) => {
      const match = {}; // Object to hold individual match details

      try {
        const titleElement = $(element).find("h3 a");
        match.title = titleElement.text().trim() || "N/A"; // Match title
        match.matchDetails =
          $(element).find("span.text-gray").first().text().trim() || "N/A"; // Match details
      } catch (err) {
        match.title = "N/A";
        match.matchDetails = "N/A";
      }

      try {
        const timeElement = $(element)
          .find("span.ng-binding")
          .filter(function () {
            return $(this)
              .text()
              .trim()
              .match(/^\d{1,2}:\d{2} [AP]M$/);
          })
          .first();
        match.time = timeElement.length ? timeElement.text().trim() : "N/A"; // Match time
      } catch (err) {
        match.time = "N/A";
      }

      try {
        const headingElement = $(element)
          .closest(".cb-plyr-tbody.cb-rank-hdr.cb-lv-main")
          .find("h2.cb-lv-grn-strip.text-bold.cb-lv-scr-mtch-hdr a");
        match.heading = headingElement.length
          ? headingElement.text().trim()
          : "N/A"; // Match heading
      } catch (err) {
        match.heading = "N/A";
      }

      try {
        const locationElement = $(element).find(".text-gray").last();
        match.location = locationElement.text().trim() || "N/A"; // Match location
      } catch (err) {
        match.location = "N/A";
      }

      try {
        const liveDetailsElement = $(element).find(".cb-lv-scrs-well");
        match.playingTeamBat =
          liveDetailsElement
            .find(".cb-hmscg-bat-txt .cb-hmscg-tm-nm")
            .first()
            .text()
            .trim() || "N/A"; // Batting team
        match.playingTeamBall =
          liveDetailsElement
            .find(".cb-hmscg-bwl-txt .cb-hmscg-tm-nm")
            .first()
            .text()
            .trim() || "N/A"; // Bowling team
        match.liveScorebat =
          liveDetailsElement
            .find(".cb-hmscg-bat-txt .cb-ovr-flo")
            .last()
            .text()
            .trim() || "N/A"; // Batting team score
        match.liveScoreball =
          liveDetailsElement
            .find(".cb-hmscg-bwl-txt .cb-ovr-flo")
            .eq(1)
            .text()
            .trim() || "N/A"; // Bowling team score
        match.liveCommentary =
          liveDetailsElement.find(".cb-text-live").text().trim() ||
          liveDetailsElement.find(".cb-text-complete").text().trim() ||
          liveDetailsElement.find(".cb-text-preview").text().trim() ||
          "N/A"; // Live commentary
      } catch (err) {
        match.playingTeam = "N/A";
        match.liveScore = "N/A";
        match.liveCommentary = "N/A";
      }

      try {
        const liveScoreLinkElement = $(element)
          .find(".cb-lv-scrs-well")
          .attr("href");
        match.liveScoreLink = liveScoreLinkElement
          ? `https://www.cricbuzz.com${liveScoreLinkElement}`
          : null; // Live score link
      } catch (err) {
        match.liveScoreLink = null;
      }

      match.links = {};
      try {
        $(element)
          .find("nav.cb-col-100.cb-col.padt5 a")
          .each((i, linkElement) => {
            const title = $(linkElement).attr("title");
            const href = $(linkElement).attr("href");
            match.links[title] = href
              ? `https://www.cricbuzz.com${href}`
              : null; // Additional links
          });
      } catch (err) {
        match.links = {};
      }

      // Add the match object to the matches array
      matches.push(match);
    });

    console.log("Scraped matches:", JSON.stringify(matches, null, 2)); // Debug log
    return matches;
  } catch (error) {
    console.error("Error fetching the webpage:", error.message);
    throw new Error("Error fetching the webpage");
  }
}

// Variable to store the latest scraped data
let latestMatches = [];

// Schedule the scraping function to run every minute
cron.schedule("* * * * *", async () => {
  try {
    latestMatches = await fetchLiveScores();
    console.log("Successfully updated live scores");
  } catch (error) {
    console.error("Error updating live scores:", error.message);
  }
});

// Function to send email
async function sendEmail(matches) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "shanuvatika@gmail.com", // Your email
      pass: "nnmfayrshqakttoi", // Your  an app-specific password
    },
  });

  const mailOptions = {
    from: "shanuvatika@gmail.com",
    to: "crashxxxbyte@gmail.com",
    subject: "Live Cricket Scores",
    text: JSON.stringify(matches, null, 2), // Format matches as a JSON string
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("Email sent successfully");
  } catch (error) {
    console.error("Error sending email:", error.message);
  }
}

// Schedule email sending every minute
cron.schedule("* * * * *", async () => {
  try {
    console.log("Sending email with latest live scores...");
    await sendEmail(latestMatches);
  } catch (error) {
    console.error("Error in scheduled email sending:", error.message);
  }
});

// Define a GET route to return the latest live scores
router.get("/", async (req, res) => {
  if (latestMatches.length === 0) {
    console.log(
      "No live scores available from cron job, fetching immediately..."
    );
    try {
      latestMatches = await fetchLiveScores();
      res.json(latestMatches);
    } catch (error) {
      console.error("Error fetching live scores immediately:", error.message);
      res
        .status(503)
        .json({ error: "Live scores not available. Please try again later." });
    }
  } else {
    res.json(latestMatches);
  }
});

// Export the router for use in the main app
module.exports = router;
