#!/bin/bash
# Log Cleanup Script
# Clears old logs to prevent disk space issues
# Run via cron: 0 3 * * * /home/dev/app/api-manager/scripts/cleanup-logs.sh

LOG_DIR="/home/dev/.pm2/logs"
CRON_LOG="/var/log/cricket-scraper.log"
MAX_AGE_DAYS=3  # Keep last 3 days (72 hours)
MAX_FILE_SIZE_MB=50  # Truncate files larger than 50MB

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧹 Log Cleanup - $(date)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Function to get file size in MB
get_size_mb() {
    local file="$1"
    if [ -f "$file" ]; then
        echo $(($(stat -c%s "$file") / 1024 / 1024))
    else
        echo 0
    fi
}

# 1. Rotate PM2 logs older than 3 days
echo "📦 Checking PM2 logs..."
BEFORE_SIZE=$(du -sh "$LOG_DIR" 2>/dev/null | cut -f1)

# Compress logs older than 1 day (if not already compressed)
find "$LOG_DIR" -name "*.log" -mtime +1 -size +100k -exec gzip -f {} \; 2>/dev/null

# Delete compressed logs older than 3 days
find "$LOG_DIR" -name "*.gz" -mtime +$MAX_AGE_DAYS -delete 2>/dev/null

# Truncate large PM2 log files (keep last 10000 lines)
for logfile in "$LOG_DIR"/*.log; do
    if [ -f "$logfile" ]; then
        SIZE_MB=$(get_size_mb "$logfile")
        if [ "$SIZE_MB" -gt "$MAX_FILE_SIZE_MB" ]; then
            echo "   ✂️ Truncating $logfile (${SIZE_MB}MB > ${MAX_FILE_SIZE_MB}MB)"
            # Keep last 10000 lines, create temp file, then move
            tail -n 10000 "$logfile" > "${logfile}.tmp" && mv "${logfile}.tmp" "$logfile"
        fi
    fi
done

AFTER_SIZE=$(du -sh "$LOG_DIR" 2>/dev/null | cut -f1)
echo "   PM2 logs: $BEFORE_SIZE → $AFTER_SIZE"

# 2. Rotate PM2 logs using pm2-logrotate (if available)
if command -v pm2 &> /dev/null; then
    echo "🔄 Flushing PM2 logs..."
    pm2 flush --silent 2>/dev/null && echo "   PM2 logs flushed" || echo "   PM2 flush skipped"
fi

# 3. Check cron log size and rotate if too large
if [ -f "$CRON_LOG" ]; then
    CRON_SIZE_MB=$(get_size_mb "$CRON_LOG")
    echo "📋 Cron log: ${CRON_SIZE_MB}MB"
    
    if [ "$CRON_SIZE_MB" -gt "$MAX_FILE_SIZE_MB" ]; then
        echo "   ✂️ Truncating cron log (keeping last 5000 lines)"
        tail -n 5000 "$CRON_LOG" > "${CRON_LOG}.tmp" && mv "${CRON_LOG}.tmp" "$CRON_LOG"
    fi
fi

# 4. Clean up node/chrome crash dumps and temp files
echo "🗑️ Cleaning temp files..."
find /tmp -name "puppeteer*" -mtime +1 -delete 2>/dev/null || true
find /tmp -name ".org.chromium*" -mtime +1 -delete 2>/dev/null || true
find /tmp -name "core.*" -delete 2>/dev/null || true

# 5. Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Cleanup complete - $(date)"
DISK_FREE=$(df -h / | awk 'NR==2 {print $4}')
echo "💾 Disk free: $DISK_FREE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
