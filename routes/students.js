const express = require("express");

const router = express.Router();
const studentData = require("../assets/studentsjson");

router.get("/", (req, res) => {
  try {
    console.log("Fetching T20 World Cup data");
    res.json(studentData);
  } catch (error) {
    console.error("Error fetching T20 World Cup data:", error);
    res.status(500).json({ error: "Error fetching T20 World Cup data" });
  }
});

module.exports = router;
