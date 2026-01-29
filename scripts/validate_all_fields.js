const axios = require('axios');

const endpoints = [
    'http://localhost:5003/api/cricket/live-scores',
    'http://localhost:5003/api/cricket/recent-scores',
    'http://localhost:5003/api/cricket/upcoming-matches'
];

async function validate() {
    for (const url of endpoints) {
        console.log(`\n==========================================`);
        console.log(`Checking ${url}...`);
        console.log(`==========================================`);

        try {
            const { data } = await axios.get(url);
            if (!data.success) {
                console.error(`Failed to fetch ${url}`);
                continue;
            }

            const matches = data.data;
            console.log(`Analyzing ${matches.length} matches...`);

            let issueCount = 0;

            matches.forEach((match, i) => {
                const issues = [];

                // Critical fields that must never be null/N/A
                if (!match.title) issues.push('Missing title');
                if (!match.matchLink) issues.push('Missing matchLink');
                if (!match.teams || match.teams.length === 0) issues.push('Empty teams array');
                if (match.location === 'N/A') issues.push('Location is N/A');

                // Context-aware checks
                if (match.matchStatus === 'live') {
                    if (match.playingTeamBat === 'N/A' || !match.playingTeamBat) issues.push('Missing playingTeamBat (Live)');
                    // playingTeamBall CAN be N/A if innings just started or between innings? 
                    // But usually there is a bowling team.
                    if (match.playingTeamBall === 'N/A' || !match.playingTeamBall) issues.push('Missing playingTeamBall (Live)');

                    if (match.liveScorebat === 'N/A' || !match.liveScorebat) issues.push('Missing liveScorebat (Live)');
                }

                if (match.matchStatus === 'upcoming') {
                    if (!match.matchStartTime) issues.push('Missing matchStartTime');
                }

                if (issues.length > 0) {
                    issueCount++;
                    console.warn(`⚠️  Match ${i} "${match.title || 'Unknown'}" has issues:`);
                    issues.forEach(issue => console.warn(`   - ${issue}`));
                    console.warn(`   Raw data:`, JSON.stringify(match, null, 2));
                }
            });

            if (issueCount === 0) {
                console.log(`✅ All ${matches.length} matches passed validation.`);
            } else {
                console.log(`❌ Found issues in ${issueCount} matches.`);
            }

        } catch (e) {
            console.error(`Error checking ${url}:`, e.message);
        }
    }
}

validate();
