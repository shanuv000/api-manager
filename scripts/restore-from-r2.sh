#!/bin/bash
set -e

# ============================================
# Restore Supabase Database from R2 Backup
# ============================================
# Usage: ./restore-from-r2.sh [backup_filename]
# If no filename provided, lists available backups

R2_ENDPOINT="${R2_ENDPOINT}"
R2_BUCKET="${R2_BUCKET:-supabase-backups}"
NEW_DATABASE_URL="${NEW_DATABASE_URL:-$DATABASE_URL}"

if [ -z "$R2_ENDPOINT" ]; then
  echo "❌ ERROR: R2_ENDPOINT environment variable is not set"
  exit 1
fi

# List available backups if no argument
if [ -z "$1" ]; then
  echo "📋 Available backups in s3://${R2_BUCKET}/daily/"
  echo "================================================"
  aws s3 ls "s3://${R2_BUCKET}/daily/" \
    --endpoint-url "${R2_ENDPOINT}" \
    --profile r2
  echo ""
  echo "Usage: ./restore-from-r2.sh <backup_filename>"
  echo "Example: ./restore-from-r2.sh backup_2025-12-18_02-00-00.dump"
  exit 0
fi

BACKUP_FILE="$1"
RESTORE_PATH="/tmp/${BACKUP_FILE}"

echo "============================================"
echo "🔄 Restore from Cloudflare R2"
echo "============================================"
echo "📁 Backup: ${BACKUP_FILE}"
echo ""

# Step 1: Download backup
echo "⬇️  Step 1/2: Downloading backup..."
aws s3 cp "s3://${R2_BUCKET}/daily/${BACKUP_FILE}" "${RESTORE_PATH}" \
  --endpoint-url "${R2_ENDPOINT}" \
  --profile r2

FILESIZE=$(du -h "${RESTORE_PATH}" | cut -f1)
echo "   ✅ Downloaded: ${FILESIZE}"

# Step 2: Restore to database
if [ -z "$NEW_DATABASE_URL" ]; then
  echo ""
  echo "⚠️  DATABASE_URL not set. Backup downloaded to: ${RESTORE_PATH}"
  echo ""
  echo "To restore manually, run:"
  echo "  pg_restore --dbname=\"YOUR_DATABASE_URL\" --verbose --clean --if-exists ${RESTORE_PATH}"
  exit 0
fi

echo ""
echo "🔧 Step 2/2: Restoring to database..."
echo "   ⚠️  This will REPLACE existing data!"
read -p "   Continue? (y/N) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
  pg_restore \
    --dbname="${NEW_DATABASE_URL}" \
    --verbose \
    --clean \
    --if-exists \
    "${RESTORE_PATH}"
  
  echo "   ✅ Restore complete!"
  
  # Cleanup
  rm -f "${RESTORE_PATH}"
  echo "   ✅ Temp file cleaned"
else
  echo "   ❌ Restore cancelled"
  echo "   📁 Backup saved at: ${RESTORE_PATH}"
fi

echo ""
echo "============================================"
echo "🎉 DONE!"
echo "============================================"
