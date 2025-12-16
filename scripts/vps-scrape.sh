#!/bin/bash
# VPS Cricket News Scraper
# Runs both Cricbuzz and ESPN scrapers with Discord notifications
# Set up cron: crontab -e
# Add: 30 0,6,12,18 * * * /home/ubuntu/app/projects/api_pro/api-manager/scripts/vps-scrape.sh >> /var/log/cricket-scraper.log 2>&1

cd /home/ubuntu/app/projects/api_pro/api-manager

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

START_TIME=$(date +%s)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🏏 VPS Cricket News Scraper - $(date)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Track results
CRICBUZZ_STATUS="❌ Failed"
ESPN_STATUS="❌ Failed"
CRICBUZZ_NEW=0
CRICBUZZ_UPDATED=0
CRICBUZZ_SKIPPED=0
ESPN_NEW=0
ESPN_UPDATED=0
ESPN_SKIPPED=0
DB_TOTAL=0
ERRORS=""

# Cleanup stale articles
echo "🧹 Cleaning up stale articles..."
node scripts/cleanup-stale.js 2>&1 || true

# Run Cricbuzz scraper
echo "📰 Running Cricbuzz scraper..."
if CRICBUZZ_OUTPUT=$(node scrapers/run-scraper.js 2>&1); then
  CRICBUZZ_STATUS="✅ Success"
  CRICBUZZ_NEW=$(echo "$CRICBUZZ_OUTPUT" | grep -oP "New articles saved:\s*\K\d+" || echo "0")
  CRICBUZZ_UPDATED=$(echo "$CRICBUZZ_OUTPUT" | grep -oP "Updated articles:\s*\K\d+" || echo "0")
  CRICBUZZ_SKIPPED=$(echo "$CRICBUZZ_OUTPUT" | grep -oP "Skipped.*:\s*\K\d+" | tail -1 || echo "0")
else
  ERRORS="${ERRORS}Cricbuzz failed\n"
fi
echo "$CRICBUZZ_OUTPUT"

# Run ESPN Cricinfo scraper (Puppeteer)
echo "📰 Running ESPN Cricinfo scraper..."
if ESPN_OUTPUT=$(node scrapers/run-espncricinfo-scraper.js 2>&1); then
  ESPN_STATUS="✅ Success"
  ESPN_NEW=$(echo "$ESPN_OUTPUT" | grep -oP "New articles saved:\s*\K\d+" || echo "0")
  ESPN_UPDATED=$(echo "$ESPN_OUTPUT" | grep -oP "Updated articles:\s*\K\d+" || echo "0")
  ESPN_SKIPPED=$(echo "$ESPN_OUTPUT" | grep -oP "Skipped.*duplicate.*:\s*\K\d+" || echo "0")
  DB_TOTAL=$(echo "$ESPN_OUTPUT" | grep -oP "Total articles:\s*\K\d+" || echo "?")
else
  ERRORS="${ERRORS}ESPN failed\n"
fi
echo "$ESPN_OUTPUT"

# Prune old articles
echo "🗑️ Pruning articles older than 90 days..."
node scripts/prune-news.js 2>&1 || true

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Scraping completed at $(date) (${DURATION}s)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Send Discord notification
TOTAL_NEW=$((CRICBUZZ_NEW + ESPN_NEW))
TOTAL_UPDATED=$((CRICBUZZ_UPDATED + ESPN_UPDATED))

if [ -z "$ERRORS" ]; then
  DESC="📰 **New Articles:** ${TOTAL_NEW}\n🔄 **Updated:** ${TOTAL_UPDATED}\n\n**Cricbuzz:** ${CRICBUZZ_NEW} new, ${CRICBUZZ_UPDATED} updated, ${CRICBUZZ_SKIPPED} skipped\n**ESPN:** ${ESPN_NEW} new, ${ESPN_UPDATED} updated, ${ESPN_SKIPPED} skipped\n\n📊 **Total in DB:** ${DB_TOTAL}\n⏱️ **Duration:** ${DURATION}s"
  send_discord "🏏 Cricket Scraper Success" "$DESC" "3066993"
else
  DESC="⚠️ **Errors occurred**\n\n**Cricbuzz:** ${CRICBUZZ_STATUS}\n**ESPN:** ${ESPN_STATUS}\n\n⏱️ **Duration:** ${DURATION}s\n📋 Check logs for details"
  send_discord "⚠️ Cricket Scraper Issues" "$DESC" "15158332"
fi

