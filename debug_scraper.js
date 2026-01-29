const axios = require('axios');
const cheerio = require('cheerio');

async function debugScraper() {
    try {
        const url = "https://www.cricbuzz.com/cricket-match/live-scores";
        console.log(`Fetching ${url}...`);

        const response = await axios.get(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
        });

        const html = response.data;
        const $ = cheerio.load(html);

        const matchElements = $("a.w-full.bg-cbWhite.flex.flex-col");
        console.log(`Found ${matchElements.length} match elements.`);

        if (matchElements.length > 0) {
            const firstMatch = matchElements.first();
            console.log('--- First Match HTML Structure ---');

            // Print the team rows inner HTML
            firstMatch.find("div.flex.items-center.gap-4.justify-between").each((i, row) => {
                console.log(`Row ${i} HTML:`);
                console.log($(row).html());
                console.log('---');
                // Also try to find text directly
                console.log('Text content:', $(row).text());
            });

            console.log('--- End First Match ---');
        }

    } catch (error) {
        console.error('Error:', error.message);
    }
}

debugScraper();
