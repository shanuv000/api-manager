require('dotenv').config();
const { Redis } = require("@upstash/redis");

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function clearCache() {
    console.log('Clearing cache keys...');
    const keys = ['cricket:upcoming-matches', 'cricket:recent-scores'];

    for (const key of keys) {
        try {
            const result = await redis.del(key);
            console.log(`Deleted ${key}: ${result}`);
        } catch (error) {
            console.error(`Failed to delete ${key}:`, error.message);
        }
    }
}

clearCache();
