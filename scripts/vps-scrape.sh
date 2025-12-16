#!/bin/bash
# VPS Cricket News Scraper
# Runs both Cricbuzz and ESPN scrapers
# Set up cron: crontab -e
# Add: 30 0,6,12,18 * * * /home/ubuntu/app/projects/api_pro/api-manager/scripts/vps-scrape.sh >> /var/log/cricket-scraper.log 2>&1

set -e

cd /home/ubuntu/app/projects/api_pro/api-manager

# Load environment variables
export $(grep -v '^#' .env | xargs)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🏏 VPS Cricket News Scraper - $(date)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Cleanup stale articles
echo "🧹 Cleaning up stale articles..."
node scripts/cleanup-stale.js || true

# Run Cricbuzz scraper
echo "📰 Running Cricbuzz scraper..."
node scrapers/run-scraper.js

# Run ESPN Cricinfo scraper (Puppeteer)
echo "📰 Running ESPN Cricinfo scraper..."
node scrapers/run-espncricinfo-scraper.js

# Prune old articles
echo "🗑️ Pruning articles older than 90 days..."
node scripts/prune-news.js || true

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Scraping completed at $(date)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
