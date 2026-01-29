const axios = require('axios');
const cheerio = require('cheerio');

async function debugUpcoming() {
    try {
        const url = "https://www.cricbuzz.com/cricket-match/live-scores/upcoming-matches";
        console.log(`Fetching ${url}...`);

        const response = await axios.get(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
        });

        const html = response.data;
        const $ = cheerio.load(html);

        // Check if the selector used in code matches anything
        const matchElements = $("a.w-full.bg-cbWhite.flex.flex-col");
        console.log(`Found ${matchElements.length} match elements with existing selector.`);

        if (matchElements.length > 0) {
            const firstMatch = matchElements.first();
            console.log('--- First Match HTML Structure ---');
            console.log(firstMatch.html());
            console.log('--- End First Match ---');

            // Specifically check inside the team rows
            firstMatch.find("div.flex.items-center.gap-4.justify-between").each((i, row) => {
                console.log(`Row ${i} HTML:`);
                console.log($(row).html());
            });
        } else {
            console.log('No elements found with selector a.w-full.bg-cbWhite.flex.flex-col');
            // Try broader selector
            const allLinks = $('a');
            console.log(`Total links: ${allLinks.length}`);
        }

    } catch (error) {
        console.error('Error:', error.message);
    }
}

debugUpcoming();
