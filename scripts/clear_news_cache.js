require("dotenv").config();
const { invalidateNewsCache } = require("../component/redisClient");

async function run() {
    console.log("🧹 Clearing Cricket News Cache...");
    try {
        const count = await invalidateNewsCache();
        console.log(`✅ Successfully invalidated ${count} cache entries.`);
    } catch (error) {
        console.error("❌ Failed to clear news cache:", error);
        process.exit(1);
    }
}

run();
