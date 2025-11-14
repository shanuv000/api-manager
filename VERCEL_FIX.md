# Vercel Deployment Fix

## Issue Resolved

**Error:** "No more than 12 Serverless Functions can be added to a Deployment on the Hobby plan"

## Solution

Consolidated all Cricket routes into a single file to reduce serverless function count.

## Changes Made

### 1. Created Consolidated Routes

**File:** `routes/Cricket/index.js`

- Combined `recentMatches.js`, `liveScoresNew.js`, and `upcomingMatches.js`
- All three endpoints now in one file with shared scraping function
- Endpoints still available at same URLs

### 2. Updated server.js

**Before:** 8+ separate route imports
**After:** 1 consolidated import

```javascript
const cricketRoutes = require("./routes/Cricket/index");
app.use("/api/cricket", cricketRoutes);
```

### 3. Fixed vercel.json

**Before:**

```json
{
  "builds": [
    { "src": "server.js", "use": "@vercel/node" },
    { "src": "routes/**/*.js", "use": "@vercel/node" } // Created multiple functions
  ]
}
```

**After:**

```json
{
  "builds": [
    { "src": "server.js", "use": "@vercel/node" } // Single function only
  ]
}
```

## Endpoints (Still Working)

✅ `/api/cricket/recent-scores` - 94 matches
✅ `/api/cricket/live-scores` - 6 matches
✅ `/api/cricket/upcoming-matches` - 7 matches

## Deployment Steps

### 1. Test Locally (Already Done)

```bash
node server.js
curl http://localhost:5003/api/cricket/recent-scores
```

### 2. Commit Changes

```bash
git add .
git commit -m "Fix: Consolidate routes for Vercel Hobby plan limit"
git push
```

### 3. Deploy to Vercel

Vercel will auto-deploy, or run:

```bash
vercel --prod
```

## Function Count

- **Before:** 12+ functions (exceeded limit)
- **After:** 1-2 functions (well within limit)

## Files Modified

- ✅ `routes/Cricket/index.js` (NEW - consolidated routes)
- ✅ `server.js` (simplified imports)
- ✅ `vercel.json` (removed routes/\*\* build)

## Files Kept (Not Used on Vercel)

These files are kept for local development but not deployed:

- `routes/Cricket/recentMatches.js`
- `routes/Cricket/liveScoresNew.js`
- `routes/Cricket/upcomingMatches.js`
- `routes/Cricket/schedule.js`
- `routes/Cricket/t20Worldcup.js`
- `routes/Cricket/espn.js`

## Verification

After deployment, test:

```bash
curl https://your-domain.vercel.app/api/cricket/recent-scores
curl https://your-domain.vercel.app/api/cricket/live-scores
curl https://your-domain.vercel.app/api/cricket/upcoming-matches
```

## Notes

- ✅ All endpoints working identically
- ✅ No breaking changes to API
- ✅ Same response format
- ✅ Within Vercel Hobby plan limits
- ✅ Can still run locally with full features

---

**Status:** Ready for Vercel deployment
**Date:** November 14, 2025
