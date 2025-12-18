#!/bin/bash
set -e

# ============================================
# Supabase to Cloudflare R2 Backup Script
# ============================================
# Usage: ./backup-to-r2.sh
# Requires: DATABASE_URL, R2_ENDPOINT, R2_BUCKET env vars
# AWS CLI must be configured with 'r2' profile

# Configuration
DATABASE_URL="${DATABASE_URL}"
R2_ENDPOINT="${R2_ENDPOINT}"
R2_BUCKET="${R2_BUCKET:-supabase-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

# Validation
if [ -z "$DATABASE_URL" ]; then
  echo "❌ ERROR: DATABASE_URL environment variable is not set"
  exit 1
fi

if [ -z "$R2_ENDPOINT" ]; then
  echo "❌ ERROR: R2_ENDPOINT environment variable is not set"
  exit 1
fi

# Generate filename with timestamp
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
BACKUP_FILE="backup_${TIMESTAMP}.dump"
BACKUP_PATH="/tmp/${BACKUP_FILE}"

echo "============================================"
echo "🔄 Supabase Backup to Cloudflare R2"
echo "============================================"
echo "📅 Timestamp: ${TIMESTAMP}"
echo "🪣 Bucket: ${R2_BUCKET}"
echo ""

# Step 1: Create backup using pg_dump
echo "📦 Step 1/4: Dumping database..."
pg_dump "${DATABASE_URL}" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="${BACKUP_PATH}"

FILESIZE=$(du -h "${BACKUP_PATH}" | cut -f1)
echo "   ✅ Backup created: ${FILESIZE}"

# Step 2: Upload to R2
echo ""
echo "☁️  Step 2/4: Uploading to Cloudflare R2..."
aws s3 cp "${BACKUP_PATH}" \
  "s3://${R2_BUCKET}/daily/${BACKUP_FILE}" \
  --endpoint-url "${R2_ENDPOINT}" \
  --profile r2

echo "   ✅ Uploaded: s3://${R2_BUCKET}/daily/${BACKUP_FILE}"

# Step 3: Cleanup old backups
echo ""
echo "🧹 Step 3/4: Cleaning old backups (>${RETENTION_DAYS} days)..."
CUTOFF_DATE=$(date -d "-${RETENTION_DAYS} days" +%Y-%m-%d)
DELETED_COUNT=0

aws s3 ls "s3://${R2_BUCKET}/daily/" \
  --endpoint-url "${R2_ENDPOINT}" \
  --profile r2 2>/dev/null | while read -r line; do
  
  FILE_DATE=$(echo "$line" | awk '{print $1}')
  FILE_NAME=$(echo "$line" | awk '{print $4}')
  
  if [[ -n "${FILE_NAME}" && "${FILE_DATE}" < "${CUTOFF_DATE}" ]]; then
    echo "   🗑️  Deleting: ${FILE_NAME}"
    aws s3 rm "s3://${R2_BUCKET}/daily/${FILE_NAME}" \
      --endpoint-url "${R2_ENDPOINT}" \
      --profile r2
    ((DELETED_COUNT++)) || true
  fi
done

echo "   ✅ Cleanup complete"

# Step 4: Cleanup local temp file
echo ""
echo "🧹 Step 4/4: Cleaning local temp file..."
rm -f "${BACKUP_PATH}"
echo "   ✅ Temp file removed"

# Summary
echo ""
echo "============================================"
echo "🎉 BACKUP COMPLETE!"
echo "============================================"
echo "📁 File: ${BACKUP_FILE}"
echo "📊 Size: ${FILESIZE}"
echo "📍 Location: s3://${R2_BUCKET}/daily/${BACKUP_FILE}"
echo "🕐 Retention: ${RETENTION_DAYS} days"
echo "============================================"
