const axios = require('axios');

async function verifyEndpoints() {
    const endpoints = [
        'http://localhost:5003/api/cricket/recent-scores',
        'http://localhost:5003/api/cricket/upcoming-matches'
    ];

    for (const url of endpoints) {
        console.log(`\nTesting ${url}...`);
        try {
            const response = await axios.get(url);
            const matches = response.data.data;

            console.log(`Found ${matches.length} matches.`);

            let nullCount = 0;
            matches.forEach((match, index) => {
                // For upcoming matches, teams might be empty if not yet decided, but shouldn't be null if scraper works
                // However, playingTeamBat/Ball are for LIVE matches.
                // For recent/upcoming, we should check 'teams' array mostly.

                // Actually, playingTeamBat/Ball are relevant for recent (completed) matches too?
                // Let's check what fields are expected.

                const teams = match.teams;
                const bat = match.playingTeamBat;
                const ball = match.playingTeamBall;

                // The issue was specifically identifying team names.
                // If 'teams' array is populated, the fix worked.

                if (!teams || teams.length === 0) {
                    // It's possible for some upcoming matches to strictly not have teams known yet (e.g. TBD vs TBD), 
                    // but if ALL are empty, it's a bug.
                    // However, mostly we expect teams.
                    if (match.title && match.title.includes('vs')) {
                        console.log(`[WARNING] Match ${index}: ${match.title} has NO teams.`);
                        nullCount++;
                    }
                } else {
                    // Check for null content inside
                }
            });

            if (matches.length > 0) {
                console.log('Sample match:', JSON.stringify(matches[0], null, 2));
            }

            if (nullCount === 0) {
                console.log('✅ Teams populated correctly.');
            } else {
                console.log(`❌ Found ${nullCount} matches with missing teams.`);
            }

        } catch (error) {
            console.error(`Error fetching ${url}:`, error.message);
        }
    }
}

verifyEndpoints();
