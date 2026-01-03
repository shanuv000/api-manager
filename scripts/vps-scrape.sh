#!/bin/bash
# VPS Cricket News Scraper
# Runs Cricbuzz, ESPN, ICC Cricket, and BBC Sport scrapers with Discord notifications
#
# RECOMMENDED CRON SETUP (with timeout and lock to prevent overlapping/stuck runs):
# crontab -e
# 30 0,6,9,12,15,18,21 * * * flock -n /tmp/cricket-scraper.lock timeout 1200 /home/ubuntu/app/projects/api_pro/api-manager/scripts/vps-scrape.sh >> /var/log/cricket-scraper.log 2>&1
#
# This ensures:
# - flock -n: Only one instance runs at a time (non-blocking)
# - timeout 900: Kill if running longer than 15 minutes (increased for 4 scrapers)

set -o pipefail

SCRIPT_DIR="/home/ubuntu/app/projects/api_pro/api-manager"
LOCK_FILE="/tmp/cricket-scraper.lock"
SCRAPER_TIMEOUT=300  # 5 minutes max per scraper (increased to accommodate retries)

cd "$SCRIPT_DIR"

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
if [ "$STALE_COUNT" -gt 0 ]; then
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
IPL_STATUS="❌ Failed"
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
IPL_NEW=0
IPL_UPDATED=0
IPL_SKIPPED=0
DB_TOTAL=0
ERRORS=""

# Cleanup stale articles (with timeout)
echo "🧹 Cleaning up stale articles..."
timeout 30 node scripts/cleanup-stale.js 2>&1 || echo "⚠️ Cleanup skipped or failed"

# Run Cricbuzz scraper (with timeout)
echo "📰 Running Cricbuzz scraper..."
if CRICBUZZ_OUTPUT=$(timeout $SCRAPER_TIMEOUT node scrapers/run-scraper.js 2>&1); then
  CRICBUZZ_STATUS="✅ Success"
  # Note: Cricbuzz outputs "New articles:" not "New articles saved:"
  CRICBUZZ_NEW=$(echo "$CRICBUZZ_OUTPUT" | grep -oP "New articles:\s*\K\d+" || echo "0")
  CRICBUZZ_UPDATED=$(echo "$CRICBUZZ_OUTPUT" | grep -oP "Updated:\s*\K\d+" || echo "0")
  CRICBUZZ_SKIPPED=$(echo "$CRICBUZZ_OUTPUT" | grep -oP "Skipped.*:\s*\K\d+" | tail -1 || echo "0")
else
  exit_code=$?
  if [ $exit_code -eq 124 ]; then
    ERRORS="${ERRORS}Cricbuzz timed out (>${SCRAPER_TIMEOUT}s)\\n"
    echo "⚠️ Cricbuzz scraper timed out after ${SCRAPER_TIMEOUT}s"
  else
    ERRORS="${ERRORS}Cricbuzz failed (exit: $exit_code)\\n"
  fi
fi
echo "$CRICBUZZ_OUTPUT"

# Run ESPN Cricinfo scraper (Puppeteer - with timeout)
echo "📰 Running ESPN Cricinfo scraper..."
if ESPN_OUTPUT=$(timeout $SCRAPER_TIMEOUT node scrapers/run-espncricinfo-scraper.js 2>&1); then
  ESPN_STATUS="✅ Success"
  ESPN_NEW=$(echo "$ESPN_OUTPUT" | grep -oP "New articles saved:\s*\K\d+" || echo "0")
  ESPN_UPDATED=$(echo "$ESPN_OUTPUT" | grep -oP "Updated articles:\s*\K\d+" || echo "0")
  ESPN_SKIPPED=$(echo "$ESPN_OUTPUT" | grep -oP "Skipped.*duplicate.*:\s*\K\d+" || echo "0")
else
  exit_code=$?
  if [ $exit_code -eq 124 ]; then
    ERRORS="${ERRORS}ESPN timed out (>${SCRAPER_TIMEOUT}s)\\n"
    echo "⚠️ ESPN scraper timed out after ${SCRAPER_TIMEOUT}s"
  else
    ERRORS="${ERRORS}ESPN failed (exit: $exit_code)\\n"
  fi
fi
echo "$ESPN_OUTPUT"

# Run ICC Cricket scraper (Puppeteer - with timeout)
echo "📰 Running ICC Cricket scraper..."
if ICC_OUTPUT=$(timeout $SCRAPER_TIMEOUT node scrapers/run-icc-scraper.js 2>&1); then
  ICC_STATUS="✅ Success"
  ICC_NEW=$(echo "$ICC_OUTPUT" | grep -oP "New articles saved:\s*\K\d+" || echo "0")
  ICC_UPDATED=$(echo "$ICC_OUTPUT" | grep -oP "Updated articles:\s*\K\d+" || echo "0")
  ICC_SKIPPED=$(echo "$ICC_OUTPUT" | grep -oP "Skipped.*duplicate.*:\s*\K\d+" || echo "0")
  DB_TOTAL=$(echo "$ICC_OUTPUT" | grep -oP "Total articles:\s*\K\d+" || echo "?")
else
  exit_code=$?
  if [ $exit_code -eq 124 ]; then
    ERRORS="${ERRORS}ICC timed out (>${SCRAPER_TIMEOUT}s)\\n"
    echo "⚠️ ICC scraper timed out after ${SCRAPER_TIMEOUT}s"
  else
    ERRORS="${ERRORS}ICC failed (exit: $exit_code)\\n"
  fi
fi
echo "$ICC_OUTPUT"

# Run BBC Sport scraper (Puppeteer - with timeout)
echo "📰 Running BBC Sport scraper..."
if BBC_OUTPUT=$(timeout $SCRAPER_TIMEOUT node scrapers/run-bbc-scraper.js 2>&1); then
  BBC_STATUS="✅ Success"
  BBC_NEW=$(echo "$BBC_OUTPUT" | grep -oP "New articles saved:\s*\K\d+" || echo "0")
  BBC_UPDATED=$(echo "$BBC_OUTPUT" | grep -oP "Updated articles:\s*\K\d+" || echo "0")
  BBC_SKIPPED=$(echo "$BBC_OUTPUT" | grep -oP "Skipped.*duplicate.*:\s*\K\d+" || echo "0")
  DB_TOTAL=$(echo "$BBC_OUTPUT" | grep -oP "Total articles:\s*\K\d+" || echo "$DB_TOTAL")
else
  exit_code=$?
  if [ $exit_code -eq 124 ]; then
    ERRORS="${ERRORS}BBC timed out (>${SCRAPER_TIMEOUT}s)\\n"
    echo "⚠️ BBC scraper timed out after ${SCRAPER_TIMEOUT}s"
  else
    ERRORS="${ERRORS}BBC failed (exit: $exit_code)\\n"
  fi
fi
echo "$BBC_OUTPUT"

# Run IPL T20 scraper (Puppeteer - with timeout)
echo "📰 Running IPL T20 scraper..."
if IPL_OUTPUT=$(timeout $SCRAPER_TIMEOUT node scrapers/run-iplt20-scraper.js 2>&1); then
  IPL_STATUS="✅ Success"
  IPL_NEW=$(echo "$IPL_OUTPUT" | grep -oP "New articles saved:\s*\K\d+" || echo "0")
  IPL_UPDATED=$(echo "$IPL_OUTPUT" | grep -oP "Updated articles:\s*\K\d+" || echo "0")
  IPL_SKIPPED=$(echo "$IPL_OUTPUT" | grep -oP "Skipped.*duplicate.*:\s*\K\d+" || echo "0")
  DB_TOTAL=$(echo "$IPL_OUTPUT" | grep -oP "Total articles:\s*\K\d+" || echo "$DB_TOTAL")
else
  exit_code=$?
  if [ $exit_code -eq 124 ]; then
    ERRORS="${ERRORS}IPL timed out (>${SCRAPER_TIMEOUT}s)\\n"
    echo "⚠️ IPL scraper timed out after ${SCRAPER_TIMEOUT}s"
  else
    ERRORS="${ERRORS}IPL failed (exit: $exit_code)\\n"
  fi
fi
echo "$IPL_OUTPUT"

# Run Perplexity Content Enhancer (AI enhancement with timeout - increased for 10 articles)
echo "🤖 Running Perplexity Content Enhancer..."
ENHANCE_STATUS="❌ Failed"
ENHANCE_COUNT=0
if ENHANCE_OUTPUT=$(timeout 180 node scrapers/content-enhancer-perplexity.js 2>&1); then
  ENHANCE_STATUS="✅ Success"
  ENHANCE_COUNT=$(echo "$ENHANCE_OUTPUT" | grep -oP "Successfully enhanced:\s*\K\d+" || echo "0")
else
  exit_code=$?
  if [ $exit_code -eq 124 ]; then
    ERRORS="${ERRORS}Perplexity enhancer timed out (>180s)\\n"
    echo "⚠️ Perplexity enhancer timed out after 180s"
  else
    ERRORS="${ERRORS}Perplexity enhancer failed (exit: $exit_code)\\n"
  fi
fi
echo "$ENHANCE_OUTPUT"

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
TOTAL_NEW=$((CRICBUZZ_NEW + ESPN_NEW + ICC_NEW + BBC_NEW + IPL_NEW))
TOTAL_UPDATED=$((CRICBUZZ_UPDATED + ESPN_UPDATED + ICC_UPDATED + BBC_UPDATED + IPL_UPDATED))

# Build status line for each scraper
SCRAPER_DETAILS="**Scrapers:**\\n"
SCRAPER_DETAILS="${SCRAPER_DETAILS}• Cricbuzz: ${CRICBUZZ_STATUS} (${CRICBUZZ_NEW} new)\\n"
SCRAPER_DETAILS="${SCRAPER_DETAILS}• ESPN: ${ESPN_STATUS} (${ESPN_NEW} new)\\n"
SCRAPER_DETAILS="${SCRAPER_DETAILS}• ICC: ${ICC_STATUS} (${ICC_NEW} new)\\n"
SCRAPER_DETAILS="${SCRAPER_DETAILS}• BBC: ${BBC_STATUS} (${BBC_NEW} new)\\n"
SCRAPER_DETAILS="${SCRAPER_DETAILS}• IPL: ${IPL_STATUS} (${IPL_NEW} new)\\n"
SCRAPER_DETAILS="${SCRAPER_DETAILS}• AI Enhance: ${ENHANCE_STATUS} (${ENHANCE_COUNT} enhanced)"

# System status
SYSTEM_INFO="\\n\\n**System:**\\n💾 Disk: ${DISK_FINAL} | 🧠 Memory: ${MEM_FINAL}MB | ⏱️ Duration: ${DURATION}s"

if [ -z "$ERRORS" ]; then
  # SUCCESS - Green notification
  TITLE="🏏 Cricket Scraper ✅ Success"
  DESC="📰 **New:** ${TOTAL_NEW} | 🔄 **Updated:** ${TOTAL_UPDATED} | 🤖 **Enhanced:** ${ENHANCE_COUNT}\\n\\n${SCRAPER_DETAILS}\\n\\n📊 **Total in DB:** ${DB_TOTAL}${SYSTEM_INFO}"
  COLOR="3066993"
else
  # FAILURE - Red notification
  TITLE="⚠️ Cricket Scraper Issues"
  DESC="${SCRAPER_DETAILS}\\n\\n❌ **Errors:**\\n${ERRORS}${SYSTEM_INFO}"
  COLOR="15158332"
fi

send_discord "$TITLE" "$DESC" "$COLOR"

NOTIFICATION_SENT="true"
echo "📱 Discord notification sent: $TITLE"

