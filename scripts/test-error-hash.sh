#!/bin/bash
# Edge-case test suite for compute_error_hash()
# Tests order-independence, whitespace-safety, deduplication, and state comparison
#
# Usage: bash scripts/test-error-hash.sh

set -euo pipefail

PASS=0
FAIL=0
STATE_FILE="/tmp/test_scraper_state.json"

# ============================================
# Import compute_error_hash from vps-scrape.sh
# ============================================
compute_error_hash() {
  local input="$1"
  local signature
  signature=$(printf '%s' "$input" \
    | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' \
    | grep -v '^$' \
    | sort -u)
  if [ -z "$signature" ]; then
    echo "d41d8cd98f00b204e9800998ecf8427e"
    return
  fi
  echo "$signature" | md5sum | awk '{print $1}'
}

assert_equal() {
  local test_name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  ✅ PASS: $test_name"
    PASS=$((PASS + 1))
  else
    echo "  ❌ FAIL: $test_name"
    echo "     Expected: $expected"
    echo "     Actual:   $actual"
    FAIL=$((FAIL + 1))
  fi
}

assert_not_equal() {
  local test_name="$1" val1="$2" val2="$3"
  if [ "$val1" != "$val2" ]; then
    echo "  ✅ PASS: $test_name"
    PASS=$((PASS + 1))
  else
    echo "  ❌ FAIL: $test_name (values should differ)"
    echo "     Both: $val1"
    FAIL=$((FAIL + 1))
  fi
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧪 Error Hash Edge-Case Test Suite"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ============================================
# Case A: Same errors, different order → SAME hash
# ============================================
echo ""
echo "📋 Case A: Order independence"
ERRORS_A1=$(printf "ESPN failed (exit: 1)\\nICC timed out (>300s)")
ERRORS_A2=$(printf "ICC timed out (>300s)\\nESPN failed (exit: 1)")
HASH_A1=$(compute_error_hash "$ERRORS_A1")
HASH_A2=$(compute_error_hash "$ERRORS_A2")
assert_equal "Same errors, different order → same hash" "$HASH_A1" "$HASH_A2"

# ============================================
# Case B: Same errors, different whitespace → SAME hash
# ============================================
echo ""
echo "📋 Case B: Whitespace tolerance"
ERRORS_B1=$(printf "ESPN failed (exit: 1)\\nICC timed out (>300s)")
ERRORS_B2=$(printf "  ESPN failed (exit: 1)  \\n  ICC timed out (>300s)  ")
HASH_B1=$(compute_error_hash "$ERRORS_B1")
HASH_B2=$(compute_error_hash "$ERRORS_B2")
assert_equal "Same errors, extra whitespace → same hash" "$HASH_B1" "$HASH_B2"

# Also test with empty lines interspersed
ERRORS_B3=$(printf "\\nESPN failed (exit: 1)\\n\\nICC timed out (>300s)\\n")
HASH_B3=$(compute_error_hash "$ERRORS_B3")
assert_equal "Same errors, extra empty lines → same hash" "$HASH_B1" "$HASH_B3"

# ============================================
# Case C: New error added → DIFFERENT hash
# ============================================
echo ""
echo "📋 Case C: New error detection"
ERRORS_C1=$(printf "ESPN failed (exit: 1)")
ERRORS_C2=$(printf "ESPN failed (exit: 1)\\nBBC timed out (>420s)")
HASH_C1=$(compute_error_hash "$ERRORS_C1")
HASH_C2=$(compute_error_hash "$ERRORS_C2")
assert_not_equal "New error added → different hash" "$HASH_C1" "$HASH_C2"

# ============================================
# Case D: Error removed → DIFFERENT hash
# ============================================
echo ""
echo "📋 Case D: Error removal detection"
ERRORS_D1=$(printf "ESPN failed (exit: 1)\\nICC timed out (>300s)\\nBBC timed out (>420s)")
ERRORS_D2=$(printf "ESPN failed (exit: 1)\\nBBC timed out (>420s)")
HASH_D1=$(compute_error_hash "$ERRORS_D1")
HASH_D2=$(compute_error_hash "$ERRORS_D2")
assert_not_equal "Error removed → different hash" "$HASH_D1" "$HASH_D2"

# ============================================
# Case E: Empty input → deterministic sentinel hash
# ============================================
echo ""
echo "📋 Case E: Empty/no-error handling"
HASH_EMPTY1=$(compute_error_hash "")
HASH_EMPTY2=$(compute_error_hash "")
HASH_EMPTY3=$(compute_error_hash "   ")
HASH_EMPTY4=$(compute_error_hash $'\n\n\n')
assert_equal "Empty string → deterministic hash" "d41d8cd98f00b204e9800998ecf8427e" "$HASH_EMPTY1"
assert_equal "Two empty calls → same hash" "$HASH_EMPTY1" "$HASH_EMPTY2"
assert_equal "Whitespace-only → empty hash" "$HASH_EMPTY1" "$HASH_EMPTY3"
assert_equal "Newlines-only → empty hash" "$HASH_EMPTY1" "$HASH_EMPTY4"

# ============================================
# Case F: Duplicate entries → SAME hash as deduplicated
# ============================================
echo ""
echo "📋 Case F: Deduplication"
ERRORS_F1=$(printf "ESPN failed (exit: 1)")
ERRORS_F2=$(printf "ESPN failed (exit: 1)\\nESPN failed (exit: 1)")
HASH_F1=$(compute_error_hash "$ERRORS_F1")
HASH_F2=$(compute_error_hash "$ERRORS_F2")
assert_equal "Duplicate entries → same hash as single" "$HASH_F1" "$HASH_F2"

# ============================================
# Case G: State file lifecycle (jq parsing)
# ============================================
echo ""
echo "📋 Case G: State file lifecycle"

# Write state file
cat > "$STATE_FILE" <<EOF
{
  "status": "critical",
  "errors_hash": "$HASH_C2",
  "timestamp": "2026-02-28T15:30:00Z"
}
EOF

PREV_STATUS=$(jq -r '.status // empty' "$STATE_FILE" 2>/dev/null)
PREV_HASH=$(jq -r '.errors_hash // empty' "$STATE_FILE" 2>/dev/null)
assert_equal "jq reads status correctly" "critical" "$PREV_STATUS"
assert_equal "jq reads hash correctly" "$HASH_C2" "$PREV_HASH"

# Test corrupt state file
echo "NOT JSON" > "$STATE_FILE"
CORRUPT_STATUS=$(jq -r '.status // empty' "$STATE_FILE" 2>/dev/null || echo "")
assert_equal "Corrupt state file → empty result (fail-open)" "" "$CORRUPT_STATUS"

# Clean up
rm -f "$STATE_FILE"

# Missing state file
if [ ! -f "$STATE_FILE" ]; then
  echo "  ✅ PASS: Missing state file detected correctly"
  PASS=$((PASS + 1))
else
  echo "  ❌ FAIL: State file should not exist"
  FAIL=$((FAIL + 1))
fi

# ============================================
# RESULTS
# ============================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🏁 Results: $PASS passed, $FAIL failed ($(($PASS + $FAIL)) total)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
