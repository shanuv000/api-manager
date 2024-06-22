const twilio = require("twilio");
require("dotenv").config();

// Load Twilio credentials from environment variables
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

if (!accountSid || !authToken) {
  console.error(
    "Twilio credentials are missing. Please check your environment variables."
  );
  process.exit(1);
}

const client = new twilio(accountSid, authToken);

async function sendWhatsAppMessage(filteredMatches) {
  try {
    const match = filteredMatches[0]; // Assuming you only want to send the first match

    const messageBody = `
*Title:* ${match.title}
*Match Details:* ${match.matchDetails}
*Heading:* ${match.heading}
*Location:* ${match.location}
*Playing Team Bat:* ${match.playingTeamBat} ${match.liveScorebat}
*Playing Team Ball:* ${match.playingTeamBall} ${match.liveScoreball}
*Live Commentary:* ${match.liveCommentary}
`;

    const message = await client.messages.create({
      body: messageBody,
      from: "whatsapp:+14155238886", // Twilio Sandbox WhatsApp number
      to: "whatsapp:+917903778038", // Your WhatsApp number (receiver)
    });

    console.log("Message sent with SID:", message.sid);
  } catch (error) {
    console.error("Error sending message:", error);
  }
}

module.exports = sendWhatsAppMessage;
