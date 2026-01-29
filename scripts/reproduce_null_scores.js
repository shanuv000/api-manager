const axios = require('axios');

async function checkLiveScores() {
    try {
        console.log('Fetching live scores...');
        // Assuming running locally on port 3000 based on user context, or use relative if possible but script needs URL
        // I'll check port 3000
        const response = await axios.get('http://localhost:5003/api/cricket/live-scores');

        if (!response.data || !response.data.success) {
            console.error('Failed to fetch live scores:', response.data);
            return;
        }

        const matches = response.data.data;
        console.log(`Found ${matches.length} matches.`);

        let nullCount = 0;
        matches.forEach((match, index) => {
            const bat = match.playingTeamBat;
            const ball = match.playingTeamBall;

            if (bat === null || ball === null) {
                console.log(`Match ${index}: ${match.title}`);
                console.log(`  playingTeamBat: ${bat}`);
                console.log(`  playingTeamBall: ${ball}`);
                console.log(`  teams:`, match.teams);
                nullCount++;
            }
        });

        if (nullCount === 0) {
            console.log('No matches found with null playingTeamBat/playingTeamBall.');
            // Print the first match just to see what headers look like
            if (matches.length > 0) {
                console.log('Sample match data:', JSON.stringify(matches[0], null, 2));
            }
        } else {
            console.log(`Found ${nullCount} matches with null fields.`);
        }

    } catch (error) {
        console.error('Error executing script:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
    }
}

checkLiveScores();
