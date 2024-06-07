const express = require("express");
const cheerio = require("cheerio");
const axios = require("axios");

const app = express();
const router = express.Router();

// Middleware to parse JSON bodies
// app.use(express.json());

// Route to scrape data
router.post("/flipkart", async (req, res) => {
  try {
    const defaultUrl =
      "https://www.flipkart.com/noise-loop-1-85-display-advanced-bluetooth-calling-550-nits-brightness-smartwatch/p/itmac8486a914a48?pid=SMWGG6GFSWZDVG57&lid=LSTSMWGG6GFSWZDVG57BZK6VC&marketplace=FLIPKART&store=ajy%2Fbuh&srno=b_1_6&otracker=browse&fm=organic&iid=baa1d91d-8f76-4f71-acac-a787e4c286db.SMWGG6GFSWZDVG57.SEARCH&ppt=browse&ppn=browse&ssid=gszrcdn0g00000001717749581727";
    const url = req.body.url || defaultUrl;
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    // Extracting the required data
    const productName = $("h1._6EBuvT span.VU-ZEz").text();
    const productRating = $(".XQDdHH").text();
    const ratingsCount = $(".Wphh3N span span:first-child").text();
    const reviewsCount = $(".Wphh3N span span:nth-child(3)").text();
    const price = $(".Nx9bqj.CxhGGd").text();
    const originalPrice = $(".yRaY8j .A6+E6v").first().text();
    const discount = $(".UkUFwK.WW8yVX span").text();
    const specialPrice = $("div._2lX4N0 span").text();

    // Extracting images
    const images = [];
    $("img.DByuf4.IZexXJ.jLEJ7H").each((i, elem) => {
      images.push($(elem).attr("src"));
    });

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
    res.status(500).send("Error occurred while scraping");
  }
});

// Use the router
module.exports = router;

// app.use("/api", router);

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   console.log(`Server is running on port ${PORT}`);
// });
