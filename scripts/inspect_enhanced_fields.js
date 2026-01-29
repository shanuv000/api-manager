const axios = require('axios');

async function checkEnhancedFields() {
    try {
        const { data } = await axios.get('http://localhost:5003/api/cricket/live-scores');
        if (!data.success) throw new Error("API call failed");

        console.log(`Checking ${data.data.length} matches for enhanced fields...`);

        data.data.forEach((m, i) => {
            // Only print if fields are present or if it's a type of match that SHOULD have them (e.g. Test)
            const hasEnhanced = m.day || m.session || m.target || m.lead || m.trail || m.winner || m.matchNumberInfo;

            if (hasEnhanced || m.matchFormat === 'Test') {
                console.log(`\nMatch ${i + 1}: ${m.title}`);
                console.log(`   Format: ${m.matchFormat}`);
                console.log(`   Status: ${m.matchStatus}`);
                console.log(`   Day: ${m.day}, Session: ${m.session}`);
                console.log(`   Target: ${m.target}, Lead: ${m.lead}, Trail: ${m.trail}`);
                console.log(`   Winner: ${m.winner}`);
                console.log(`   MatchNumberInfo: ${m.matchNumberInfo}`);
            }
        });
    } catch (e) {
        console.error(e.message);
    }
}

checkEnhancedFields();
