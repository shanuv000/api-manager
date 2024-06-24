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

async function sendWhatsAppMessage(WAmessageBody, phoneNumbers) {
  try {
    for (const phoneNumber of phoneNumbers) {
      const message = await client.messages.create({
        body: WAmessageBody,
        from: "whatsapp:+14155238886", // Twilio Sandbox WhatsApp number
        to: phoneNumber,
      });

      console.log("Message sent with SID:", message.sid, "to:", phoneNumber);
    }
  } catch (error) {
    console.error("Error sending message:", error);
  }
}

module.exports = sendWhatsAppMessage;
