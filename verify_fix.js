const cheerio = require("cheerio");
const fs = require("fs");

const html = fs.readFileSync("debug_cricbuzz_desktop.html", "utf8");

// THIS FUNCTION IS COPIED EXACTLY FROM THE MODIFIED live-score-worker.js
function extractMatchesFromNextData(html) {
    const matchesData = [];
    try {
        const cheerio = require('cheerio');
        const $ = cheerio.load(html);

        $("script").each((i, el) => {
            let content = $(el).html();
            if (!content) return;

            const key = '\\"matchesList\\":';
            let idx = content.indexOf(key);
            while (idx !== -1) {
                let start = idx + key.length;
                let balance = 0;
                let inString = false;
                let extracted = "";
                let foundStart = false;

                for (let k = start; k < content.length; k++) {
                    const char = content[k];

                    if (!foundStart) {
                        if (char === '{') {
                            foundStart = true;
                            balance = 1;
                            extracted += char;
                        }
                        continue;
                    }

                    // Inside the object
                    extracted += char;

                    if (char === '\\') {
                        const nextChar = content[k + 1];
                        // If next char is " we are escaping a quote
                        if (nextChar === '"') {
                            // We just skip the backslash in processing, but keep it in extracted
                        }
                        // Skip next char in loop logic to avoid processing escaped quotes
                        k++;
                        if (k < content.length) extracted += content[k];
                        continue;
                    }

                    if (char === '"') {
                        inString = !inString;
                    }

                    if (!inString) {
                        if (char === '{') balance++;
                        else if (char === '}') balance--;
                    }

                    if (balance === 0) {
                        break;
                    }
                }

                if (foundStart && extracted) {
                    try {
                        const unescaped = extracted.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                        const json = JSON.parse(unescaped);
                        if (json.matches) {
                            matchesData.push(...json.matches);
                        }
                    } catch (e) {
                        // console.log("Failed to parse extracted JSON chunk"); 
                    }
                }
                idx = content.indexOf(key, idx + 1);
            }
        });
    } catch (e) {
        console.error("Error extracting Next.js data:", e.message);
    }
    return matchesData;
}

const matches = extractMatchesFromNextData(html);
console.log(`Extracted ${matches.length} matches.`);

// Look for JSK match specifically
const jsk = matches.find(m => m.match && m.match.matchInfo && m.match.matchInfo.team1.teamName.includes("Joburg"));

if (jsk) {
    console.log("Found JSK match!");
    console.log("Keys available:", Object.keys(jsk.match));
    if (jsk.match.matchScore) {
        console.log("matchScore IS present:");
        console.log(JSON.stringify(jsk.match.matchScore, null, 2));
    } else {
        console.log("matchScore is MISSING in raw data.");
    }
} else {
    console.log("JSK match not found.");
}
