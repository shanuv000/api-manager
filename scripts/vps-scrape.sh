#!/bin/bash
# VPS Cricket News Scraper
# Runs Cricbuzz, ESPN, ICC Cricket, and BBC Sport scrapers with Discord notifications
#
# RECOMMENDED CRON SETUP (with timeout and lock to prevent overlapping/stuck runs):
# crontab -e
# 30 0,6,9,12,15,18,21 * * * flock -n /tmp/cricket-scraper.lock timeout 1200 /home/dev/app/api-manager/scripts/vps-scrape.sh >> /var/log/cricket-scraper.log 2>&1
#
# This ensures:
# - flock -n: Only one instance runs at a time (non-blocking)
# - timeout 900: Kill if running longer than 15 minutes (increased for 4 scrapers)

set -o pipefail

SCRIPT_DIR="/home/ubuntu/apps/api-manager"
LOCK_FILE="/tmp/cricket-scraper.lock"
SCRAPER_TIMEOUT=120  # 2 minutes max per scraper (actual: ~10s, this is safety net)
BBC_TIMEOUT=180      # 3 minutes for BBC (scrolling + slower page loads)

cd "$SCRIPT_DIR"

# Prevent overlapping runs (PM2 cron may fire while previous run is still active)
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  echo "⚠️ Previous scraper run still active — skipping this cycle"
  exit 0
fi

# Load environment variables
export $(grep -v '^#' .env | xargs)

# Discord notification function
send_discord() {
  local title="$1"
  local description="$2"
  local color="$3"
  
  if [ -n "$DISCORD_WEBHOOK_URL" ]; then
    curl -s -H "Content-Type: application/json" \
      -d "{\"embeds\":[{\"title\":\"$title\",\"description\":\"$description\",\"color\":$color,\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}]}" \
      "$DISCORD_WEBHOOK_URL" > /dev/null
  fi
}

# ============================================
# NORMALIZED ERROR HASHING (order-independent, whitespace-safe)
# ============================================
STATE_FILE="/tmp/news_scraper_state.json"

compute_error_hash() {
  local input="$1"
  # 1. Trim leading/trailing whitespace per line
  # 2. Remove empty lines
  # 3. Sort alphabetically (order-independent)
  # 4. Deduplicate identical entries (-u)
  # 5. Hash the canonical form
  local signature
  signature=$(printf '%s' "$input" \
    | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' \
    | grep -v '^$' \
    | sort -u)
  if [ -z "$signature" ]; then
    # md5 of empty string — deterministic sentinel
    echo "d41d8cd98f00b204e9800998ecf8427e"
    return
  fi
  echo "$signature" | md5sum | awk '{print $1}'
}

# Trap for unexpected exits - send Discord notification on crash
cleanup_on_exit() {
  local exit_code=$?
  if [ $exit_code -ne 0 ] && [ "$NOTIFICATION_SENT" != "true" ]; then
    local duration=$(($(date +%s) - START_TIME))
    send_discord "🚨 Cricket Scraper CRASHED" "❌ **Script exited unexpectedly**\\n\\nExit code: ${exit_code}\\n⏱️ Duration: ${duration}s\\n📋 Check logs: /var/log/cricket-scraper.log" "15158332"
    echo "🚨 Script exited with code $exit_code at $(date)"
  fi
  
  # Kill any remaining child processes
  pkill -P $$ 2>/dev/null || true
}
trap cleanup_on_exit EXIT

START_TIME=$(date +%s)
NOTIFICATION_SENT="false"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🏏 VPS Cricket News Scraper - $(date)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ============================================
# SYSTEM HEALTH CHECKS
# ============================================

# Check disk space - warn if >90%, abort if >95%
DISK_USE=$(df / | awk 'NR==2 {print $5}' | tr -d '%')
DISK_FREE=$(df -h / | awk 'NR==2 {print $4}')
echo "💾 Disk usage: ${DISK_USE}% (${DISK_FREE} free)"

if [ "$DISK_USE" -gt 95 ]; then
  echo "🚨 CRITICAL: Disk usage at ${DISK_USE}%! Aborting to prevent failures."
  send_discord "🚨 Cricket Scraper ABORTED" "**Disk usage critical: ${DISK_USE}%**\\n\\nFree space: ${DISK_FREE}\\nScrapers cannot run without disk space.\\n\\n**Action needed:** Clean up disk space." "15158332"
  NOTIFICATION_SENT="true"
  exit 1
elif [ "$DISK_USE" -gt 90 ]; then
  echo "⚠️ WARNING: Disk usage at ${DISK_USE}%"
  send_discord "⚠️ Disk Space Warning" "Disk usage at **${DISK_USE}%** (${DISK_FREE} free)\\n\\nScrapers may fail if disk fills up.\\nConsider cleaning up old files." "16776960"
fi

# Check available memory - warn if <500MB
MEM_AVAIL=$(free -m | awk 'NR==2 {print $7}')
echo "🧠 Available memory: ${MEM_AVAIL}MB"

if [ "$MEM_AVAIL" -lt 300 ]; then
  echo "🚨 CRITICAL: Only ${MEM_AVAIL}MB memory available! Aborting."
  send_discord "🚨 Cricket Scraper ABORTED" "**Memory critically low: ${MEM_AVAIL}MB**\\n\\nPuppeteer scrapers need at least 500MB.\\n\\n**Action needed:** Free up memory or restart services." "15158332"
  NOTIFICATION_SENT="true"
  exit 1
elif [ "$MEM_AVAIL" -lt 500 ]; then
  echo "⚠️ WARNING: Low memory (${MEM_AVAIL}MB)"
  send_discord "⚠️ Low Memory Warning" "Available memory: **${MEM_AVAIL}MB**\\n\\nScrapers may be slow or fail.\\nRecommended: 500MB+ available." "16776960"
fi

# Kill stale Chrome/Chromium processes from previous runs
echo "🧹 Cleaning up stale browser processes..."
STALE_COUNT=$(pgrep -c -f "chromium.*--headless" 2>/dev/null || echo "0")
STALE_COUNT=$(echo "$STALE_COUNT" | tr -d '[:space:]')
STALE_COUNT=${STALE_COUNT:-0}
if [ "$STALE_COUNT" -gt 0 ] 2>/dev/null; then
  echo "   Found $STALE_COUNT stale Chromium processes, killing..."
  pkill -9 -f "chromium.*--headless" 2>/dev/null || true
  sleep 1
fi

# ============================================
# TRACK RESULTS
# ============================================

# Track results
CRICBUZZ_STATUS="❌ Failed"
ESPN_STATUS="❌ Failed"
ICC_STATUS="❌ Failed"
BBC_STATUS="❌ Failed"
# IPL_STATUS="❌ Failed"  # IPL scraper disabled (no longer needed)
CRICBUZZ_NEW=0
CRICBUZZ_UPDATED=0
CRICBUZZ_SKIPPED=0
ESPN_NEW=0
ESPN_UPDATED=0
ESPN_SKIPPED=0
ICC_NEW=0
ICC_UPDATED=0
ICC_SKIPPED=0
BBC_NEW=0
BBC_UPDATED=0
BBC_SKIPPED=0
# IPL_NEW=0             # IPL scraper disabled
# IPL_UPDATED=0
# IPL_SKIPPED=0
DB_TOTAL=0
SCRAPER_ERRORS=""
WARNINGS=""

# Cleanup stale articles (with timeout)
echo "🧹 Cleaning up stale articles..."
timeout 30 node scripts/cleanup-stale.js 2>&1 || echo "⚠️ Cleanup skipped or failed"

# Run Cricbuzz scraper (with timeout)
CRICBUZZ_START=$(date +%s)
echo "📰 Running Cricbuzz scraper..."
if CRICBUZZ_OUTPUT=$(timeout --kill-after=10s $SCRAPER_TIMEOUT node scrapers/run-cricbuzz-scraper.js 2>&1); then
  CRICBUZZ_STATUS="✅ Success"
  CRICBUZZ_NEW=$(echo "$CRICBUZZ_OUTPUT" | grep -oP "New articles saved:\s*\K\d+" || echo "0")
  CRICBUZZ_UPDATED=$(echo "$CRICBUZZ_OUTPUT" | grep -oP "Updated articles:\s*\K\d+" || echo "0")
  CRICBUZZ_SKIPPED=$(echo "$CRICBUZZ_OUTPUT" | grep -oP "Skipped.*duplicate.*:\s*\K\d+" || echo "0")
else
  exit_code=$?
  if [ $exit_code -eq 124 ] || [ $exit_code -eq 137 ]; then
    SCRAPER_ERRORS="${SCRAPER_ERRORS}Cricbuzz timed out (>${SCRAPER_TIMEOUT}s)\\n"
    echo "⚠️ Cricbuzz scraper timed out after ${SCRAPER_TIMEOUT}s"
  else
    SCRAPER_ERRORS="${SCRAPER_ERRORS}Cricbuzz failed (exit: $exit_code)\\n"
  fi
fi
CRICBUZZ_DURATION=$(( $(date +%s) - CRICBUZZ_START ))
echo "$CRICBUZZ_OUTPUT"

# Check WARP proxy status before ESPN (ESPN uses Akamai which blocks VPS datacenter IPs)
echo "🔀 Checking Cloudflare WARP proxy..."
if WARP_IP=$(curl --proxy socks5://127.0.0.1:40000 --connect-timeout 5 -s https://api.ipify.org 2>/dev/null); then
  echo "   ✅ WARP proxy active (exit IP: $WARP_IP)"
else
  echo "   ⚠️ WARP proxy not available — ESPN will use direct connection"
  WARNINGS="${WARNINGS}WARP proxy down — ESPN may be blocked\\n"
  # Try to reconnect WARP
  warp-cli connect 2>/dev/null || true
fi

# Run ESPN Cricinfo scraper (Puppeteer + WARP proxy - with timeout)
ESPN_START=$(date +%s)
echo "📰 Running ESPN Cricinfo scraper (via WARP proxy)..."
if ESPN_OUTPUT=$(timeout --kill-after=10s $SCRAPER_TIMEOUT node scrapers/run-espncricinfo-scraper.js 2>&1); then
  ESPN_STATUS="✅ Success"
  ESPN_NEW=$(echo "$ESPN_OUTPUT" | grep -oP "New articles saved:\s*\K\d+" || echo "0")
  ESPN_UPDATED=$(echo "$ESPN_OUTPUT" | grep -oP "Updated articles:\s*\K\d+" || echo "0")
  ESPN_SKIPPED=$(echo "$ESPN_OUTPUT" | grep -oP "Skipped.*duplicate.*:\s*\K\d+" || echo "0")
else
  exit_code=$?
  if [ $exit_code -eq 124 ] || [ $exit_code -eq 137 ]; then
    SCRAPER_ERRORS="${SCRAPER_ERRORS}ESPN timed out (>${SCRAPER_TIMEOUT}s)\\n"
    echo "⚠️ ESPN scraper timed out after ${SCRAPER_TIMEOUT}s"
  else
    SCRAPER_ERRORS="${SCRAPER_ERRORS}ESPN failed (exit: $exit_code)\\n"
  fi
fi
ESPN_DURATION=$(( $(date +%s) - ESPN_START ))
echo "$ESPN_OUTPUT"

# Run ICC Cricket scraper (Puppeteer - with timeout)
ICC_START=$(date +%s)
echo "📰 Running ICC Cricket scraper..."
if ICC_OUTPUT=$(timeout --kill-after=10s $SCRAPER_TIMEOUT node scrapers/run-icc-scraper.js 2>&1); then
  ICC_STATUS="✅ Success"
  ICC_NEW=$(echo "$ICC_OUTPUT" | grep -oP "New articles saved:\s*\K\d+" || echo "0")
  ICC_UPDATED=$(echo "$ICC_OUTPUT" | grep -oP "Updated articles:\s*\K\d+" || echo "0")
  ICC_SKIPPED=$(echo "$ICC_OUTPUT" | grep -oP "Skipped.*duplicate.*:\s*\K\d+" || echo "0")
  DB_TOTAL=$(echo "$ICC_OUTPUT" | grep -oP "Total articles:\s*\K\d+" || echo "?")
else
  exit_code=$?
  if [ $exit_code -eq 124 ] || [ $exit_code -eq 137 ]; then
    SCRAPER_ERRORS="${SCRAPER_ERRORS}ICC timed out (>${SCRAPER_TIMEOUT}s)\\n"
    echo "⚠️ ICC scraper timed out after ${SCRAPER_TIMEOUT}s"
  else
    SCRAPER_ERRORS="${SCRAPER_ERRORS}ICC failed (exit: $exit_code)\\n"
  fi
fi
ICC_DURATION=$(( $(date +%s) - ICC_START ))
echo "$ICC_OUTPUT"

# Run BBC Sport scraper (Puppeteer - with timeout)
BBC_START=$(date +%s)
echo "📰 Running BBC Sport scraper..."
if BBC_OUTPUT=$(timeout --kill-after=10s $BBC_TIMEOUT node scrapers/run-bbc-scraper.js 2>&1); then
  BBC_STATUS="✅ Success"
  BBC_NEW=$(echo "$BBC_OUTPUT" | grep -oP "New articles saved:\s*\K\d+" || echo "0")
  BBC_UPDATED=$(echo "$BBC_OUTPUT" | grep -oP "Updated articles:\s*\K\d+" || echo "0")
  BBC_SKIPPED=$(echo "$BBC_OUTPUT" | grep -oP "Skipped.*duplicate.*:\s*\K\d+" || echo "0")
  DB_TOTAL=$(echo "$BBC_OUTPUT" | grep -oP "Total articles:\s*\K\d+" || echo "$DB_TOTAL")
else
  exit_code=$?
  if [ $exit_code -eq 124 ] || [ $exit_code -eq 137 ]; then
    SCRAPER_ERRORS="${SCRAPER_ERRORS}BBC timed out (>${BBC_TIMEOUT}s)\\n"
    echo "⚠️ BBC scraper timed out after ${BBC_TIMEOUT}s"
  else
    SCRAPER_ERRORS="${SCRAPER_ERRORS}BBC failed (exit: $exit_code)\\n"
  fi
fi
BBC_DURATION=$(( $(date +%s) - BBC_START ))
echo "$BBC_OUTPUT"

# --- IPL T20 scraper disabled (no longer needed) ---
# echo "📰 Running IPL T20 scraper..."
# if IPL_OUTPUT=$(timeout $SCRAPER_TIMEOUT node scrapers/run-iplt20-scraper.js 2>&1); then
#   IPL_STATUS="✅ Success"
#   IPL_NEW=$(echo "$IPL_OUTPUT" | grep -oP "New articles saved:\s*\K\d+" || echo "0")
#   IPL_UPDATED=$(echo "$IPL_OUTPUT" | grep -oP "Updated articles:\s*\K\d+" || echo "0")
#   IPL_SKIPPED=$(echo "$IPL_OUTPUT" | grep -oP "Skipped.*duplicate.*:\s*\K\d+" || echo "0")
#   DB_TOTAL=$(echo "$IPL_OUTPUT" | grep -oP "Total articles:\s*\K\d+" || echo "$DB_TOTAL")
# else
#   exit_code=$?
#   if [ $exit_code -eq 124 ]; then
#     ERRORS="${ERRORS}IPL timed out (>${SCRAPER_TIMEOUT}s)\\n"
#     echo "⚠️ IPL scraper timed out after ${SCRAPER_TIMEOUT}s"
#   else
#     ERRORS="${ERRORS}IPL failed (exit: $exit_code)\\n"
#   fi
# fi
# echo "$IPL_OUTPUT"

# Content enhancer runs independently via PM2 cron (see ecosystem.config.js)
# It processes all pending articles in a loop-until-done pattern

# Prune old articles (with timeout)
echo "🗑️ Pruning articles older than 90 days..."
timeout 30 node scripts/prune-news.js 2>&1 || echo "⚠️ Prune skipped or failed"

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

# Get final system stats
DISK_FINAL=$(df / | awk 'NR==2 {print $5}')
MEM_FINAL=$(free -m | awk 'NR==2 {print $7}')

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Scraping completed at $(date) (${DURATION}s)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Send Discord notification - ALWAYS notify (success or failure)
TOTAL_NEW=$((CRICBUZZ_NEW + ESPN_NEW + ICC_NEW + BBC_NEW))
TOTAL_UPDATED=$((CRICBUZZ_UPDATED + ESPN_UPDATED + ICC_UPDATED + BBC_UPDATED))

# Sanitize all numeric vars (pipefail can cause "0\n0" multiline values)
TOTAL_NEW=$(echo "$TOTAL_NEW" | head -1 | tr -dc '0-9'); TOTAL_NEW=${TOTAL_NEW:-0}
TOTAL_UPDATED=$(echo "$TOTAL_UPDATED" | head -1 | tr -dc '0-9'); TOTAL_UPDATED=${TOTAL_UPDATED:-0}

# Clear API Cache if changes detected
if [ "$TOTAL_NEW" -gt 0 ] || [ "$TOTAL_UPDATED" -gt 0 ]; then
  echo "🧹 Changes detected. clearing API cache..."
  node scripts/clear_news_cache.js || echo "⚠️ Cache clear failed"
else
  echo "⏭️  No changes detected, skipping cache clear"
fi


# Get enhancement coverage with alert status (pipe-separated: LEVEL|SUMMARY|DETAILS)
COVERAGE_LEVEL="ok"
COVERAGE_SUMMARY=""
COVERAGE_DETAILS=""
if COVERAGE_OUTPUT=$(timeout 15 node utils/enhancement-stats.js --status 2>&1); then
  COVERAGE_LEVEL=$(echo "$COVERAGE_OUTPUT" | cut -d'|' -f1)
  COVERAGE_SUMMARY=$(echo "$COVERAGE_OUTPUT" | cut -d'|' -f2)
  COVERAGE_DETAILS=$(echo "$COVERAGE_OUTPUT" | cut -d'|' -f3-)
  echo "📊 Coverage: $COVERAGE_LEVEL - $COVERAGE_DETAILS"
else
  echo "⚠️ Failed to get coverage stats"
  COVERAGE_DETAILS="Stats unavailable"
fi

# Build status line for each scraper

SCRAPER_DETAILS="**Scrapers:**\\n"
SCRAPER_DETAILS="${SCRAPER_DETAILS}• Cricbuzz: ${CRICBUZZ_STATUS} (${CRICBUZZ_NEW} new, ${CRICBUZZ_DURATION:-?}s)\\n"
SCRAPER_DETAILS="${SCRAPER_DETAILS}• ESPN: ${ESPN_STATUS} (${ESPN_NEW} new, ${ESPN_DURATION:-?}s)\\n"
SCRAPER_DETAILS="${SCRAPER_DETAILS}• ICC: ${ICC_STATUS} (${ICC_NEW} new, ${ICC_DURATION:-?}s)\\n"
SCRAPER_DETAILS="${SCRAPER_DETAILS}• BBC: ${BBC_STATUS} (${BBC_NEW} new, ${BBC_DURATION:-?}s)\\n"
# SCRAPER_DETAILS="${SCRAPER_DETAILS}• IPL: ${IPL_STATUS} (${IPL_NEW} new)\\n"  # IPL disabled
SCRAPER_DETAILS="${SCRAPER_DETAILS}• AI Enhance: Runs independently (pm2 logs content-enhancer)"

# Build coverage section based on alert level
if [ "$COVERAGE_LEVEL" = "critical" ]; then
  COVERAGE_SECTION="\\n\\n🚨 **Coverage Alert (CRITICAL):**\\n${COVERAGE_SUMMARY}\\n📊 ${COVERAGE_DETAILS}"
elif [ "$COVERAGE_LEVEL" = "warning" ]; then
  COVERAGE_SECTION="\\n\\n⚠️ **Coverage Warning:**\\n${COVERAGE_SUMMARY}\\n📊 ${COVERAGE_DETAILS}"
else
  COVERAGE_SECTION="\\n\\n📊 **Enhancement Coverage:**\\n${COVERAGE_DETAILS}"
fi

# System status
SYSTEM_INFO="\\n\\n**System:**\\n💾 Disk: ${DISK_FINAL} | 🧠 Memory: ${MEM_FINAL}MB | ⏱️ Duration: ${DURATION}s"

# ============================================
# 3-TIER SEVERITY CLASSIFICATION
# ============================================
if [ -n "$SCRAPER_ERRORS" ]; then
  CURRENT_STATUS="critical"
elif [ -n "$WARNINGS" ]; then
  CURRENT_STATUS="degraded"
else
  CURRENT_STATUS="healthy"
fi

# Compute order-independent, whitespace-safe error hash
ERROR_SIGNATURE=$(printf "%s\n%s" "$SCRAPER_ERRORS" "$WARNINGS")
CURRENT_HASH=$(compute_error_hash "$ERROR_SIGNATURE")
echo "🔑 Error hash: $CURRENT_HASH (status: $CURRENT_STATUS)"

# ============================================
# STATE-CHANGE DETECTION (suppress duplicate alerts)
# ============================================
SHOULD_NOTIFY="true"
PREV_STATUS=""
PREV_HASH=""

if [ -f "$STATE_FILE" ] && [ -r "$STATE_FILE" ]; then
  # Use jq for safe JSON parsing (available on this VPS)
  if PREV_STATUS=$(jq -r '.status // empty' "$STATE_FILE" 2>/dev/null) \
     && PREV_HASH=$(jq -r '.errors_hash // empty' "$STATE_FILE" 2>/dev/null) \
     && [ -n "$PREV_STATUS" ] && [ -n "$PREV_HASH" ]; then
    # Suppress ONLY if both status AND hash are identical
    if [ "$CURRENT_STATUS" = "$PREV_STATUS" ] && [ "$CURRENT_HASH" = "$PREV_HASH" ]; then
      SHOULD_NOTIFY="false"
      echo "📱 State unchanged ($CURRENT_STATUS, hash=$CURRENT_HASH) — notification suppressed"
    # Cooldown: suppress repeat critical alerts within 2 hours (prevents spam when different scrapers rotate failures)
    elif [ "$CURRENT_STATUS" = "critical" ] && [ "$PREV_STATUS" = "critical" ]; then
      COOLDOWN_SECONDS=7200  # 2 hours
      PREV_NOTIFIED=$(jq -r '.last_notified_at // .timestamp // empty' "$STATE_FILE" 2>/dev/null)
      if [ -n "$PREV_NOTIFIED" ]; then
        PREV_EPOCH=$(date -d "$PREV_NOTIFIED" +%s 2>/dev/null || echo "0")
        NOW_EPOCH=$(date +%s)
        ELAPSED=$((NOW_EPOCH - PREV_EPOCH))
        if [ "$ELAPSED" -le "$COOLDOWN_SECONDS" ]; then
          SHOULD_NOTIFY="false"
          echo "📱 Critical alert suppressed (cooldown: ${ELAPSED}s < ${COOLDOWN_SECONDS}s)"
        else
          echo "📱 Critical alert cooldown expired (${ELAPSED}s) — notifying"
        fi
      else
        echo "📱 State changed: $PREV_STATUS→$CURRENT_STATUS (hash: ${PREV_HASH:0:8}→${CURRENT_HASH:0:8})"
      fi
    else
      echo "📱 State changed: $PREV_STATUS→$CURRENT_STATUS (hash: ${PREV_HASH:0:8}→${CURRENT_HASH:0:8})"
    fi
  else
    echo "⚠️ State file corrupt or unreadable — will notify (fail-open)"
  fi
else
  echo "📱 No previous state file — will notify (first run)"
fi

# ============================================
# BUILD DISCORD MESSAGE
# ============================================
if [ "$CURRENT_STATUS" = "healthy" ]; then
  # Check if this is a recovery from a previous bad state
  if [ "$PREV_STATUS" = "critical" ] || [ "$PREV_STATUS" = "degraded" ]; then
    TITLE="🏏 Cricket Scraper ✅ Recovered"
    COLOR="3066993"  # Green
  elif [ "$COVERAGE_LEVEL" = "critical" ]; then
    TITLE="🏏 Cricket Scraper ⚠️ Coverage Critical"
    COLOR="15158332"  # Red
  elif [ "$COVERAGE_LEVEL" = "warning" ]; then
    TITLE="🏏 Cricket Scraper ✅ Success (Coverage Warning)"
    COLOR="16776960"  # Yellow
  else
    TITLE="🏏 Cricket Scraper ✅ Success"
    COLOR="3066993"  # Green
  fi
  DESC="📰 **New:** ${TOTAL_NEW} | 🔄 **Updated:** ${TOTAL_UPDATED}\\n\\n${SCRAPER_DETAILS}${COVERAGE_SECTION}\\n\\n📊 **Total in DB:** ${DB_TOTAL}${SYSTEM_INFO}"
elif [ "$CURRENT_STATUS" = "degraded" ]; then
  TITLE="🏏 Cricket Scraper ⚠️ Degraded"
  DESC="${SCRAPER_DETAILS}${COVERAGE_SECTION}\\n\\n⚠️ **Warnings:**\\n${WARNINGS}${SYSTEM_INFO}"
  COLOR="16776960"  # Yellow
else
  # critical
  TITLE="🚨 Cricket Scraper Issues"
  COMBINED_ISSUES=""
  [ -n "$SCRAPER_ERRORS" ] && COMBINED_ISSUES="❌ **Errors:**\\n${SCRAPER_ERRORS}"
  [ -n "$WARNINGS" ] && COMBINED_ISSUES="${COMBINED_ISSUES}\\n⚠️ **Warnings:**\\n${WARNINGS}"
  DESC="${SCRAPER_DETAILS}${COVERAGE_SECTION}\\n\\n${COMBINED_ISSUES}${SYSTEM_INFO}"
  COLOR="15158332"  # Red
fi

# ============================================
# SEND (or suppress) + WRITE STATE
# ============================================
if [ "$SHOULD_NOTIFY" = "true" ]; then
  send_discord "$TITLE" "$DESC" "$COLOR"
  NOTIFICATION_SENT="true"
  echo "📱 Discord notification sent: $TITLE"
else
  NOTIFICATION_SENT="true"  # Prevent trap from firing
  echo "📱 Notification suppressed (no state change)"
fi

# Write state file AFTER send decision (crash before here = re-evaluate next run)
# last_notified_at only updates when we actually send — this makes cooldown work correctly
if [ "$SHOULD_NOTIFY" = "true" ]; then
  LAST_NOTIFIED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
else
  # Carry forward previous last_notified_at (or fall back to now for first run)
  LAST_NOTIFIED=$(jq -r '.last_notified_at // empty' "$STATE_FILE" 2>/dev/null)
  LAST_NOTIFIED="${LAST_NOTIFIED:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
fi
cat > "$STATE_FILE" <<STATEEOF
{
  "status": "$CURRENT_STATUS",
  "errors_hash": "$CURRENT_HASH",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "last_notified_at": "$LAST_NOTIFIED"
}
STATEEOF
echo "💾 State saved: $CURRENT_STATUS ($CURRENT_HASH)"

# ═══════════════════════════════════════
# UPTIME-KUMA PUSH HEARTBEAT
# ═══════════════════════════════════════
# Signal successful completion to Uptime-Kuma push monitor.
# If this line is never reached (script crash/hang), the push monitor
# will detect the missed heartbeat and fire an alert.
curl -s "http://127.0.0.1:3999/api/push/d181f8aada07d841?status=up&msg=OK&ping=${DURATION}" > /dev/null 2>&1 || true
echo "💓 Uptime-Kuma heartbeat sent"
