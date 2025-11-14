#!/bin/bash

# Production Verification Script
# This script tests all cricket API endpoints

BASE_URL="http://localhost:5003/api/cricket"
PASS=0
FAIL=0

echo "======================================"
echo "Cricket API Production Verification"
echo "======================================"
echo ""

# Test Recent Scores
echo "Testing Recent Scores..."
RESPONSE=$(curl -s "${BASE_URL}/recent-scores")
COUNT=$(echo $RESPONSE | python3 -c "import sys, json; print(json.load(sys.stdin)['count'])" 2>/dev/null)
if [ ! -z "$COUNT" ] && [ "$COUNT" -gt 0 ]; then
    echo "✅ Recent Scores: $COUNT matches found"
    PASS=$((PASS + 1))
else
    echo "❌ Recent Scores: Failed"
    FAIL=$((FAIL + 1))
fi

# Test Live Scores
echo "Testing Live Scores..."
RESPONSE=$(curl -s "${BASE_URL}/live-scores")
COUNT=$(echo $RESPONSE | python3 -c "import sys, json; print(json.load(sys.stdin)['count'])" 2>/dev/null)
if [ ! -z "$COUNT" ]; then
    echo "✅ Live Scores: $COUNT matches found"
    PASS=$((PASS + 1))
else
    echo "❌ Live Scores: Failed"
    FAIL=$((FAIL + 1))
fi

# Test Upcoming Matches
echo "Testing Upcoming Matches..."
RESPONSE=$(curl -s "${BASE_URL}/upcoming-matches")
COUNT=$(echo $RESPONSE | python3 -c "import sys, json; print(json.load(sys.stdin)['count'])" 2>/dev/null)
if [ ! -z "$COUNT" ]; then
    echo "✅ Upcoming Matches: $COUNT matches found"
    PASS=$((PASS + 1))
else
    echo "❌ Upcoming Matches: Failed"
    FAIL=$((FAIL + 1))
fi

echo ""
echo "======================================"
echo "Results: $PASS passed, $FAIL failed"
echo "======================================"

if [ $FAIL -eq 0 ]; then
    echo "✅ All tests passed! API is production ready."
    exit 0
else
    echo "❌ Some tests failed. Please check the API."
    exit 1
fi
