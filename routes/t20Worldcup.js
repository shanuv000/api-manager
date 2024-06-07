const express = require("express");

const router = express.Router();

const t20WorldCup2024 = {
  t20_world_cup_2024: {
    team: "India",
    matches: [
      {
        date: "2024-06-08",
        opponent: "Pakistan",
        venue: "Melbourne Cricket Ground, Melbourne",
        time: "19:00",
      },
      {
        date: "2024-06-12",
        opponent: "Australia",
        venue: "Sydney Cricket Ground, Sydney",
        time: "15:00",
      },
      {
        date: "2024-06-16",
        opponent: "South Africa",
        venue: "Adelaide Oval, Adelaide",
        time: "18:00",
      },
      {
        date: "2024-06-20",
        opponent: "New Zealand",
        venue: "WACA Ground, Perth",
        time: "14:00",
      },
      {
        date: "2024-06-24",
        opponent: "England",
        venue: "Brisbane Cricket Ground, Brisbane",
        time: "20:00",
      },
      {
        date: "2024-06-28",
        opponent: "Sri Lanka",
        venue: "Manuka Oval, Canberra",
        time: "17:00",
      },
      {
        date: "2024-07-02",
        opponent: "West Indies",
        venue: "Bellerive Oval, Hobart",
        time: "16:00",
      },
      {
        date: "2024-07-06",
        opponent: "Bangladesh",
        venue: "Kardinia Park, Geelong",
        time: "19:00",
      },
    ],
  },
};

router.get("/t20-world-cup-2024", (req, res) => {
  try {
    console.log("Fetching T20 World Cup data");
    res.json(t20WorldCup2024);
  } catch (error) {
    console.error("Error fetching T20 World Cup data:", error);
    res.status(500).json({ error: "Error fetching T20 World Cup data" });
  }
});

module.exports = router;
