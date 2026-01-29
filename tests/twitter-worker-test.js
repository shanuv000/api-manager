/**
 * Deep Test Script for Twitter Worker Improvements
 * Tests: emoji detection, hashtag dedup, A/B formats, engagement tracking
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
const {
    getContentEmoji,
    generateHashtags,
    formatTweet,
    validateCredentials,
    CONFIG,
} = require('../services/twitter-service');

// ============================================
// TEST UTILITIES
// ============================================

let passed = 0;
let failed = 0;

function test(name, condition, details = '') {
    if (condition) {
        console.log(`✅ ${name}`);
        passed++;
    } else {
        console.log(`❌ ${name} ${details}`);
        failed++;
    }
}

function section(title) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📋 ${title}`);
    console.log('='.repeat(60));
}

// ============================================
// TEST 1: Enhanced Emoji Detection
// ============================================

section('EMOJI DETECTION TESTS');

// Breaking news
test('Breaking news → 🔥', getContentEmoji('Record-breaking century!') === '🔥');
test('Injury news → 🚨', getContentEmoji('Player ruled out of match') === '🚨');
test('Suspension → ⚠️', getContentEmoji('Player suspended for 2 matches') === '⚠️');
test('Shock result → 😱', getContentEmoji('Shocking upset by underdog') === '😱');

// Achievements
test('Victory → 🏆', getContentEmoji('Team wins the series') === '🏆');
test('Century → 💯', getContentEmoji('Batsman scores century in test') === '💯');
test('Five-fer → 🎳', getContentEmoji('Bowler takes fifer in innings') === '🎳');
test('Hat-trick → 🎩', getContentEmoji('Amazing hatrick by pace bowler') === '🎩');
test('First/debut → ⭐', getContentEmoji('Debut match for young player') === '⭐');
test('Fastest → ⚡', getContentEmoji('Fastest fifty in T20 format') === '⚡');

// Team flags (test strings without achievement words)
test('India → 🇮🇳', getContentEmoji('BCCI confirms playing eleven') === '🇮🇳');
test('Australia → 🇦🇺', getContentEmoji('Australia board confirms tour') === '🇦🇺');
test('England → 🏴󠁧󠁢󠁥󠁮󠁧󠁿', getContentEmoji('ECB announces new coaching staff') === '🏴󠁧󠁢󠁥󠁮󠁧󠁿');
test('Pakistan → 🇵🇰', getContentEmoji('PCB meeting scheduled for March') === '🇵🇰');
test('New Zealand → 🇳🇿', getContentEmoji('BlackCaps prepare for upcoming tour') === '🇳🇿');
test('South Africa → 🇿🇦', getContentEmoji('Proteas name squad for series') === '🇿🇦');
test('West Indies → 🌴', getContentEmoji('Windies board names new chief') === '🌴');
test('Sri Lanka → 🇱🇰', getContentEmoji('SLC confirms dates for matches') === '🇱🇰');
test('Bangladesh → 🇧🇩', getContentEmoji('Tigers prepare for home series') === '🇧🇩');
test('Afghanistan → 🇦🇫', getContentEmoji('ACB announces new training camp') === '🇦🇫');

// Star players (test strings without achievement/team words)
test('Kohli → ⭐', getContentEmoji('Virat Kohli talks about training') === '⭐');
test('Rohit → ⭐', getContentEmoji('Rohit Sharma discusses strategy') === '⭐');
test('Root → ⭐', getContentEmoji('Joe Root on his approach') === '⭐');
test('Babar → ⭐', getContentEmoji('Babar Azam press conference') === '⭐');
test('Cummins → ⭐', getContentEmoji('Pat Cummins shares thoughts') === '⭐');

// Tournaments
test('World Cup → 🌍', getContentEmoji('World Cup preparations begin') === '🌍');
test('IPL → 💰', getContentEmoji('IPL mega auction 2026') === '💰');
test('Ashes → 🔥', getContentEmoji('Ashes series schedule released') === '🔥');
test('BGT → 🏆', getContentEmoji('BGT trophy goes to hosts') === '🏆');

// Event types (test strings without higher priority patterns)
test('Announce → 📢', getContentEmoji('Squad announced for tour') === '📢');
test('Retire → 👏', getContentEmoji('Legendary cricketer retires today') === '👏');
test('Interview → 🎤', getContentEmoji('Player speaks to media') === '🎤');
test('Preview → 👀', getContentEmoji('Match preview for upcoming game') === '👀');
test('Captain → 👨‍✈️', getContentEmoji('New captain for the side') === '👨‍✈️');

// ============================================
// TEST 2: Hashtag Deduplication
// ============================================

section('HASHTAG DEDUPLICATION TESTS');

// Should dedupe Cricket + cricket
const tags1 = generateHashtags(['Cricket', 'Test Match']);
test('Dedupes Cricket + cricket', !hasDuplicates(tags1), `Got: ${tags1.join(', ')}`);

// Should handle empty
const tags2 = generateHashtags([]);
test('Empty tags → just #Cricket', tags2.length === 1 && tags2[0] === '#Cricket');

// Should handle duplicates in input
const tags3 = generateHashtags(['IPL', 'IPL', 'IPL']);
test('Dedupes same tag repeated', tags3.length === 2, `Got: ${tags3.join(', ')}`);

// Max 3 hashtags
const tags4 = generateHashtags(['Tag1', 'Tag2', 'Tag3', 'Tag4', 'Tag5']);
test('Max 3 hashtags enforced', tags4.length <= 3, `Got: ${tags4.length}`);

function hasDuplicates(arr) {
    const lower = arr.map(t => t.toLowerCase());
    return lower.length !== new Set(lower).size;
}

// ============================================
// TEST 3: A/B Format Variants
// ============================================

section('A/B FORMAT VARIANT TESTS');

const mockArticle = {
    title: 'Test article title for testing formats',
    slug: 'test-article-slug',
    tags: ['India', 'Test Match'],
};

const mockEnhanced = {
    title: 'Enhanced test article title for testing',
};

// Run formatTweet multiple times to see all variants
const formatCounts = { A: 0, B: 0, C: 0 };
for (let i = 0; i < 100; i++) {
    const tweet = formatTweet(mockArticle, mockEnhanced);
    // Format B starts with hashtags
    if (tweet.startsWith('#')) {
        formatCounts.B++;
        // Format C has hashtags in middle (between title and URL)
    } else if (tweet.indexOf('#Cricket') < tweet.indexOf('play.urtechy.com')) {
        formatCounts.C++;
    } else {
        formatCounts.A++;
    }
}

console.log(`   Format distribution over 100 runs: A=${formatCounts.A}, B=${formatCounts.B}, C=${formatCounts.C}`);
test('Format A appears (should be ~60%)', formatCounts.A >= 40 && formatCounts.A <= 80);
test('Format B appears (should be ~20%)', formatCounts.B >= 5 && formatCounts.B <= 40);
test('Format C appears (should be ~20%)', formatCounts.C >= 5 && formatCounts.C <= 40);

// Check tweet length
const singleTweet = formatTweet(mockArticle, mockEnhanced);
test('Tweet under 280 chars', singleTweet.length <= 280, `Got: ${singleTweet.length} chars`);

// ============================================
// TEST 4: Config Setup
// ============================================

section('CONFIGURATION TESTS');

test('CONFIG.MAX_TWEET_LENGTH = 280', CONFIG.MAX_TWEET_LENGTH === 280);
test('CONFIG.MAX_HASHTAGS = 3', CONFIG.MAX_HASHTAGS === 3);
test('CONFIG has cachedUsername field', 'cachedUsername' in CONFIG);

// ============================================
// TEST 5: Credential Validation (if creds available)
// ============================================

section('CREDENTIAL VALIDATION TEST');

async function testCredentials() {
    if (!CONFIG.API_KEY) {
        console.log('⏭️ Skipping credential test (no API_KEY in env)');
        return;
    }

    try {
        const result = await validateCredentials();
        test('validateCredentials() returns result', result !== null);
        test('Caches username on success', result.valid && CONFIG.cachedUsername !== null,
            `Username: ${CONFIG.cachedUsername}`);
        if (result.valid) {
            console.log(`   ✨ Authenticated as: @${result.user?.username}`);
        }
    } catch (err) {
        console.log(`⚠️ Credential test error: ${err.message}`);
    }
}

// ============================================
// RUN ASYNC TESTS AND PRINT SUMMARY
// ============================================

(async () => {
    await testCredentials();

    console.log(`\n${'='.repeat(60)}`);
    console.log('📊 FINAL RESULTS');
    console.log('='.repeat(60));
    console.log(`   ✅ Passed: ${passed}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
    console.log('='.repeat(60) + '\n');

    if (failed > 0) {
        process.exit(1);
    }
})();
