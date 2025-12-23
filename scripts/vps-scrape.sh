#!/bin/bash
# VPS Cricket News Scraper
# Runs Cricbuzz, ESPN, and ICC Cricket scrapers with Discord notifications
#
# RECOMMENDED CRON SETUP (with timeout and lock to prevent overlapping/stuck runs):
# crontab -e
# 30 0,6,12,18 * * * flock -n /tmp/cricket-scraper.lock timeout 900 /home/ubuntu/app/projects/api_pro/api-manager/scripts/vps-scrape.sh >> /var/log/cricket-scraper.log 2>&1
#
# This ensures:
# - flock -n: Only one instance runs at a time (non-blocking)
# - timeout 900: Kill if running longer than 15 minutes (increased for 3 scrapers)

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

# Track results
CRICBUZZ_STATUS="❌ Failed"
ESPN_STATUS="❌ Failed"
ICC_STATUS="❌ Failed"
CRICBUZZ_NEW=0
CRICBUZZ_UPDATED=0
CRICBUZZ_SKIPPED=0
ESPN_NEW=0
ESPN_UPDATED=0
ESPN_SKIPPED=0
ICC_NEW=0
ICC_UPDATED=0
ICC_SKIPPED=0
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

# Prune old articles (with timeout)
echo "🗑️ Pruning articles older than 90 days..."
timeout 30 node scripts/prune-news.js 2>&1 || echo "⚠️ Prune skipped or failed"

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Scraping completed at $(date) (${DURATION}s)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Send Discord notification
TOTAL_NEW=$((CRICBUZZ_NEW + ESPN_NEW + ICC_NEW))
TOTAL_UPDATED=$((CRICBUZZ_UPDATED + ESPN_UPDATED + ICC_UPDATED))

if [ -z "$ERRORS" ]; then
  DESC="📰 **New Articles:** ${TOTAL_NEW}\\n🔄 **Updated:** ${TOTAL_UPDATED}\\n\\n**Cricbuzz:** ${CRICBUZZ_NEW} new, ${CRICBUZZ_UPDATED} updated\\n**ESPN:** ${ESPN_NEW} new, ${ESPN_UPDATED} updated\\n**ICC:** ${ICC_NEW} new, ${ICC_UPDATED} updated\\n\\n📊 **Total in DB:** ${DB_TOTAL}\\n⏱️ **Duration:** ${DURATION}s"
  send_discord "🏏 Cricket Scraper Success" "$DESC" "3066993"
else
  DESC="⚠️ **Errors occurred**\\n\\n**Cricbuzz:** ${CRICBUZZ_STATUS}\\n**ESPN:** ${ESPN_STATUS}\\n**ICC:** ${ICC_STATUS}\\n\\n${ERRORS}\\n⏱️ **Duration:** ${DURATION}s\\n📋 Check logs for details"
  send_discord "⚠️ Cricket Scraper Issues" "$DESC" "15158332"
fi

NOTIFICATION_SENT="true"

