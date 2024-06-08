const express = require("express");
const cheerio = require("cheerio");
const axios = require("axios");

const router = express.Router();

// Route to scrape data
router.post("/flipkart", async (req, res) => {
  try {
    console.log("Received request to /flipkart");
    const defaultUrl =
      "https://www.flipkart.com/noise-loop-1-85-display-advanced-bluetooth-calling-550-nits-brightness-smartwatch/p/itmac8486a914a48?pid=SMWGG6GFSWZDVG57&lid=LSTSMWGG6GFSWZDVG57BZK6VC&marketplace=FLIPKART&store=ajy%2Fbuh&srno=b_1_6&otracker=browse&fm=organic&iid=baa1d91d-8f76-4f71-acac-a787e4c286db.SMWGG6GFSWZDVG57.SEARCH&ppt=browse&ppn=browse&ssid=gszrcdn0g00000001717749581727";
    const url = req.body.url || defaultUrl;
    console.log("URL to scrape:", url);

    if (!url.startsWith("https://www.flipkart.com/")) {
      console.log("Invalid URL provided");
      return res
        .status(400)
        .send("Invalid URL. Please provide a valid Flipkart URL.");
    }

    // Increase the timeout for the axios request to 10 seconds
    const { data } = await axios.get(url, { timeout: 10000 }); // 10 seconds timeout
    console.log("Received data from Flipkart");

    const $ = cheerio.load(data);

    // Extracting the required data
    const productName = $("h1._6EBuvT span.VU-ZEz").text().trim();
    const productRating = $(".XQDdHH").text().trim();
    const ratingsCount = $(".Wphh3N span span:first-child").text().trim();
    const reviewsCount = $(".Wphh3N span span:nth-child(3)").text().trim();
    const price = $(".Nx9bqj.CxhGGd").text().trim();
    const originalPrice = $(".yRaY8j.A6+E6v").first().text().trim();
    const discount = $(".UkUFwK.WW8yVX span").text().trim();
    const specialPrice = $("div._2lX4N0 span").text().trim();

    console.log("Extracted product details");

    if (!productName) {
      throw new Error(
        "Failed to extract product details. The structure of the page might have changed."
      );
    }

    // Extracting images
    const images = [];
    $("img.DByuf4.IZexXJ.jLEJ7H").each((i, elem) => {
      images.push($(elem).attr("src"));
    });

    console.log("Sending response with extracted data");

    res.json({
      productName,
      productRating,
      ratingsCount,
      reviewsCount,
      price,
      originalPrice,
      discount,
      specialPrice,
      images,
    });
  } catch (error) {
    console.error("Scraping error:", error.message);
    console.error("Full error:", error);
    if (error.response) {
      res
        .status(error.response.status)
        .send(`Error occurred while fetching the page: ${error.message}`);
    } else if (error.request) {
      res
        .status(500)
        .send(
          "No response received from Flipkart. Please check your network connection."
        );
    } else {
      res.status(500).send(`Error occurred while scraping: ${error.message}`);
    }
  }
});

module.exports = router;
