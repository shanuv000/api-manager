require("dotenv").config();
const nodemailer = require("nodemailer");

async function sendEmail(matches) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
  });

  const mailOptions = {
    from: process.env.GMAIL_USER,
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

module.exports = sendEmail;
