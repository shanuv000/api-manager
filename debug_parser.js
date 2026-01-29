const cheerio = require("cheerio");
const fs = require("fs");

const html = fs.readFileSync("debug_cricbuzz_desktop.html", "utf8");

function extractMatchesList(html) {
    const matchesData = [];
    const $ = cheerio.load(html);

    $("script").each((i, el) => {
        let content = $(el).html();
        if (!content) return;

        // Next.js often uses unescaped quotes in the push array string but the content inside IS escaped json
        // Or it works differently.
        // Let's rely on finding "matchesList"

        const key = '\\"matchesList\\":';
        let idx = content.indexOf(key);
        while (idx !== -1) {
            // Found a start. Now extract the value object.
            // value starts at idx + key.length
            let start = idx + key.length;

            // It should be an object "{"
            // But verify formatting.
            // If the JSON is stringified-escaped, it should look like {\"matches\":...}

            // Let's implement a simple brace balancer that respects escaped quotes?
            // Since it's inside a JS string, we might struggle with double escaping.

            // Heuristic approaches:
            // 1. Just grab a chunk and try to clean it?
            // 2. Walk char by char.

            // Let's try walking.
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
                    // Escape next char
                    k++;
                    if (k < content.length) extracted += content[k];
                    continue;
                }

                if (char === '"') {
                    // Check if it's escaped? We handled backslash above.
                    // Wait, checking previous char for backslash is safer if we didn't skip in loop.
                    // But splitting loop logic is better.
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
                // Now we have the stringified object.
                // It is likely fully escaped: {\"matches\":[...]}
                // We need to unescape it to parse it as JSON.
                try {
                    // Unescape quotes: \" -> "
                    // Unescape slashes: \\ -> \
                    // Note: The content itself was inside a JS string, so it was already escaped.
                    // The extracted string is like: {\"matches\": ... }

                    const unescaped = extracted.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                    const json = JSON.parse(unescaped);
                    if (json.matches) {
                        matchesData.push(...json.matches);
                    }
                } catch (e) {
                    console.log("Failed to parse extracted JSON", e.message);
                    // console.log("Extracted chunk:", extracted.substring(0, 100) + "...");
                }
            }

            // Search for next occurrence
            idx = content.indexOf(key, idx + 1);
        }
    });

    return matchesData;
}

const data = extractMatchesList(html);
console.log(`Found ${data.length} matches in hidden data`);
if (data.length > 0) {
    console.log("Sample Match:", JSON.stringify(data[0], null, 2));

    // Check JSK match
    const jsk = data.find(m => m.match && m.match.matchInfo && m.match.matchInfo.team1.teamName.includes("Joburg"));
    if (jsk) {
        console.log("\nJSK Match Data:", JSON.stringify(jsk, null, 2));
    }
}
