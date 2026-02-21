require('dotenv').config();
const Redis = require("ioredis");

const redis = new Redis({
    host: "127.0.0.1",
    port: 6379,
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

    redis.disconnect();
}

clearCache();
