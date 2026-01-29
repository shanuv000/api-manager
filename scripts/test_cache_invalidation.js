require("dotenv").config();
const { setCache, getCache, invalidateNewsCache } = require("../component/redisClient");

async function testInvalidation() {
    console.log("Testing Cache Invalidation...");
    const TEST_KEY_1 = "cricket:news:test:1";
    const TEST_KEY_2 = "cricket:news:test:2";

    // 1. Set keys
    await setCache(TEST_KEY_1, { data: "test1" }, 300);
    await setCache(TEST_KEY_2, { data: "test2" }, 300);

    // 2. Verify they exist
    const v1 = await getCache(TEST_KEY_1);
    if (!v1) {
        console.error("❌ Failed to set test keys. Aborting.");
        return;
    }
    console.log("✅ Test keys set successfully.");

    // 3. Invalidate
    console.log("Calling invalidateNewsCache()...");
    const count = await invalidateNewsCache();
    console.log(`Invalidation returned count: ${count}`);

    // 4. Verify deletion
    const v1_after = await getCache(TEST_KEY_1);
    const v2_after = await getCache(TEST_KEY_2);

    if (!v1_after && !v2_after) {
        console.log("✅ SUCCESS: Keys invalidated.");
    } else {
        console.log("❌ FAILURE: Keys still exist.");
        if (v1_after) console.log(`   - ${TEST_KEY_1} still exists`);
        if (v2_after) console.log(`   - ${TEST_KEY_2} still exists`);
    }
}

testInvalidation();
