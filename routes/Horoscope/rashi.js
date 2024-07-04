const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const router = express.Router();

const app = express();
const PORT = process.env.PORT || 3000;

const url = "https://www.bhaskar.com/rashifal/2/today/";

async function scrapeData() {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    const rashifalData = [];
    $(".f6017535 .c15b52c6").each((index, element) => {
      const signImage = $(element).find(".a1fb1284 img").attr("src");
      const signName = $(element).find(".a1fb1284 h2").text();
      const signDate = $(element).find(".a1fb1284 h4").text();

      const positive = $(element)
        .find('.a6b3d8fe strong:contains("पॉजिटिव")')
        .parent()
        .text()
        .replace("पॉजिटिव- ", "")
        .split("नेगेटिव-")[0]
        .trim();

      const negative = $(element)
        .find('.a6b3d8fe strong:contains("नेगेटिव")')
        .parent()
        .text()
        .replace("नेगेटिव- ", "")
        .split("व्यवसाय-")[0]
        .trim();

      const business = $(element)
        .find('.a6b3d8fe strong:contains("व्यवसाय")')
        .parent()
        .text()
        .replace("व्यवसाय- ", "")
        .split("लव-")[0]
        .trim();

      const love = $(element)
        .find('.a6b3d8fe strong:contains("लव")')
        .parent()
        .text()
        .replace("लव- ", "")
        .split("स्वास्थ्य-")[0]
        .trim();

      const health = $(element)
        .find('.a6b3d8fe strong:contains("स्वास्थ्य")')
        .parent()
        .text()
        .replace("स्वास्थ्य- ", "")
        .split("भाग्यशाली रंग-")[0]
        .trim();

      const luckyColor = $(element)
        .find('.a6b3d8fe strong:contains("भाग्यशाली रंग")')
        .parent()
        .text()
        .replace("भाग्यशाली रंग- ", "")
        .split("भाग्यशाली अंक-")[0]
        .trim();

      const luckyNumber = $(element)
        .find('.a6b3d8fe strong:contains("भाग्यशाली अंक")')
        .parent()
        .text()
        .replace("भाग्यशाली अंक- ", "")
        .trim();

      rashifalData.push({
        signImage,
        signName,
        signDate,
        positive,
        negative,
        business,
        love,
        health,
        luckyColor,
        luckyNumber,
      });
    });

    return rashifalData;
  } catch (error) {
    console.error(`Error fetching data: ${error}`);
    return [];
  }
}

// Define a route for scraping data
router.get("/rashi", async (req, res) => {
  const data = await scrapeData();
  res.json(data);
});

// Use the router in the app

module.exports = router;
