require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_BASE_URL = 'https://ai.urtechy.com';
const API_KEY = 'agp_9dS82kP1J7xWmQZs';
const MODEL = 'claude-opus-4-5-thinking';

// Load system prompt
const SYSTEM_PROMPT_PATH = '/home/dev/.gemini/antigravity/brain/d878ff10-ddbe-40fd-973c-6d13f2d4ba6d/system_prompt_formatter.md';
const SYSTEM_PROMPT = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8');

// Load input data (from previous step)
const INPUT_PATH = path.join(__dirname, 'final_enhanced_result.json');

async function main() {
    try {
        if (!fs.existsSync(INPUT_PATH)) {
            console.error("Input file not found. Run the previous step first.");
            return;
        }

        const inputData = fs.readFileSync(INPUT_PATH, 'utf-8');
        const inputJson = JSON.parse(inputData);

        // Flatten if necessary (the previous step might have produced [[{...}]])
        const flattenedInput = inputJson.flat(Infinity);

        console.log(`Sending ${flattenedInput.length} items to Formatting Agent...`);

        const payload = {
            model: MODEL,
            max_tokens: 8192,
            system: SYSTEM_PROMPT,
            messages: [
                {
                    role: "user",
                    content: JSON.stringify(flattenedInput)
                }
            ]
        };

        try {
            console.log("Processing with Claude Opus...");
            const response = await axios.post(`${API_BASE_URL}/v1/messages`, payload, {
                headers: {
                    'x-api-key': API_KEY,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json'
                }
            });

            // Extract and Clean
            const rContent = response.data.content?.[0]?.text || JSON.stringify(response.data);
            const cleanContent = rContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');

            let finalJson;
            try {
                finalJson = JSON.parse(cleanContent);
            } catch (e) {
                console.error("JSON Parse Error on result");
                // Save raw for debugging
                fs.writeFileSync(path.join(__dirname, 'formatter_debug_raw.txt'), rContent);
                return;
            }

            // Save output
            const outputPath = path.join(__dirname, 'final_formatted_result.json');
            fs.writeFileSync(outputPath, JSON.stringify(finalJson, null, 2));
            console.log(`\nFinal Formatted Output saved to: ${outputPath}`);

        } catch (err) {
            console.error("API Error:", err.message);
            if (err.response) {
                console.error(JSON.stringify(err.response.data));
            }
        }

    } catch (error) {
        console.error("Script Error:", error);
    }
}

main();
