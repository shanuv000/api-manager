const express = require("express");
const sendEmail = require("../../component/sendEmail");
const sendWhatsAppMessage = require("../../component/sendWhatsAppMeassage"); // Fixed the import

const router = express.Router();

router.post("/3d", async (req, res) => {
  const { name, email, message, platform, web } = req.body;

  // Validate the request body
  if (!name || !email || !message) {
    return res.status(400).send("Name, email, and message are required.");
  }

  // Construct the WhatsApp message body
  const WAmessageBody = `
    *Name:* ${name}
    *Email:* ${email}
    *Message:* ${message}
    *platform:* ${platform}
    *Website:* ${web}
  `;

  // Define the phone numbers to send the message to
  const phoneNumbers = ["whatsapp:+917903778038"]; // Add more numbers as needed

  try {
    // Send the WhatsApp message
    await sendWhatsAppMessage(WAmessageBody, phoneNumbers);

    // Optionally, you can also send an email or perform other actions here
    // await sendEmail(name, email, message);

    res.status(200).send("Message sent successfully.");
  } catch (error) {
    console.error("Error sending message or performing actions:", error);
    res.status(500).send("Error sending message. Please try again later.");
  }
});

module.exports = router;
