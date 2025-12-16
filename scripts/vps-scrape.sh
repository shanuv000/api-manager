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
ERRORS=""

# Cleanup stale articles
echo "🧹 Cleaning up stale articles..."
node scripts/cleanup-stale.js 2>&1 || true

# Run Cricbuzz scraper
echo "📰 Running Cricbuzz scraper..."
if CRICBUZZ_OUTPUT=$(node scrapers/run-scraper.js 2>&1); then
  CRICBUZZ_STATUS="✅ Success"
  # Extract article count if present
  CRICBUZZ_COUNT=$(echo "$CRICBUZZ_OUTPUT" | grep -oP "New articles saved:\s*\K\d+" || echo "?")
  CRICBUZZ_STATUS="✅ $CRICBUZZ_COUNT new"
else
  ERRORS="$ERRORS\nCricbuzz: $CRICBUZZ_OUTPUT"
fi
echo "$CRICBUZZ_OUTPUT"

# Run ESPN Cricinfo scraper (Puppeteer)
echo "📰 Running ESPN Cricinfo scraper..."
if ESPN_OUTPUT=$(node scrapers/run-espncricinfo-scraper.js 2>&1); then
  ESPN_STATUS="✅ Success"
  ESPN_COUNT=$(echo "$ESPN_OUTPUT" | grep -oP "New articles saved:\s*\K\d+" || echo "?")
  ESPN_STATUS="✅ $ESPN_COUNT new"
else
  ERRORS="$ERRORS\nESPN: $ESPN_OUTPUT"
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
if [ -z "$ERRORS" ]; then
  DESC="**Cricbuzz:** $CRICBUZZ_STATUS\n**ESPN:** $ESPN_STATUS\n**Duration:** ${DURATION}s"
  send_discord "🏏 Cricket Scraper Success" "$DESC" "3066993"
else
  DESC="**Cricbuzz:** $CRICBUZZ_STATUS\n**ESPN:** $ESPN_STATUS\n**Errors:** Check logs"
  send_discord "⚠️ Cricket Scraper Issues" "$DESC" "15158332"
fi
