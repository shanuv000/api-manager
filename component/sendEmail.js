require("dotenv").config();
const nodemailer = require("nodemailer");
const generateEmailTemplate = require("./emailTemplates/live"); // Correct path

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
    to: "crashxxxbyte@gmail.com, sarvila1212@gmail.com",
    subject: `Live Cricket Scores by Vaibhav`,
    html: generateEmailTemplate(matches), // Use HTML template
    headers: {
      "X-Priority": "1 (Highest)",
      "X-MSMail-Priority": "High",
      Importance: "High",
    },
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("Email sent successfully");
  } catch (error) {
    console.error("Error sending email:", error.message);
  }
}

module.exports = sendEmail;
