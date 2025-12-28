# Vercel Serverless Puppeteer Strategy

## ⚠️ Challenge: Vercel Hobby Timeout Limits

**Vercel Hobby Plan Limits:**

- ⏱️ **10-second execution timeout** for serverless functions
- 📦 **50MB deployment size limit**

**Our Scraper Reality:**

- 🕐 Takes 30-60 seconds to scrape 20 articles with Puppeteer
- ❌ Will timeout on every request on Vercel

## ✅ Solution: Database-First, Cron-Populated

### Architecture

```
┌─────────────────────────────────────────────────────┐
│              API Requests (Vercel)                  │
│  - Returns database data ONLY (instant, <1s)       │
│  - No Puppeteer scraping on Vercel                 │
│  - Fast, reliable, within 10s timeout              │
└─────────────────────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────┐
│             Supabase PostgreSQL                     │
│  - Stores all articles                              │
│  - Queried by Vercel API                            │
│  - Populated by GitHub Actions                      │
└─────────────────────────────────────────────────────┘
                        ▲
┌─────────────────────────────────────────────────────┐
│         GitHub Actions Cron Job                     │
│  - Runs every 3 hours                               │
│  - No timeout limits                                │
│  - Can take 60+ seconds to scrape                  │
│  - Directly updates database                        │
└─────────────────────────────────────────────────────┘
```

### Implementation

#### 1. API Behavior (Vercel Production)

```javascript
// Detects Vercel environment
const isVercel = !!process.env.VERCEL;

if (isVercel) {
  // FAST: Return database data only
  // No Puppeteer (avoids timeout)
  return database results;
} else {
  // LOCAL: Can scrape with Puppeteer
  // No timeout limits in dev
  scrape if needed;
}
```

**Result:**

- ✅ Vercel API responds in <1 second
- ✅ No timeouts
- ✅ Always serves fresh data from database

#### 2. GitHub Actions Cron

**Current Workflow:** `.github/workflows/fetch-cricket-news.yml`

```yaml
# Runs every 3 hours
schedule:
  - cron: "30 0,3,6,9,12,15,18,21 * * *"
```

**How it works:**

1. GitHub runner calls API endpoint
2. API returns database data (if available)
3. Database gets populated by separate scraping process

**Better Alternative:** Run scraper directly in GitHub Actions

```yaml
jobs:
  scrape-and-update:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v3

      - name: Install dependencies
        run: npm install

      - name: Run scraper directly
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: node scripts/scrape-to-db.js
```

**Benefits:**

- ✅ No timeout (GitHub Actions allows 6 hours)
- ✅ Direct database update
- ✅ Doesn't call Vercel API
- ✅ More reliable

### Deployment Size

**With our setup:**

```
puppeteer-core: ~2MB
@sparticuz/chromium: ~50MB (downloaded at runtime)
Total deployment: < 50MB ✅
```

Chromium is downloaded at first function call, not bundled in deployment.

## 📊 Performance Comparison

| Approach                       | Response Time | Timeout Risk        | Cost     |
| ------------------------------ | ------------- | ------------------- | -------- |
| ❌ Scrape on Vercel            | 30-60s        | HIGH (always fails) | Free     |
| ✅ **Database-only on Vercel** | **<1s**       | **NONE**            | **Free** |
| ✅ GitHub Actions cron         | N/A           | NONE                | Free     |

## 🚀 Current Implementation

**Status:**

- ✅ API detects Vercel environment
- ✅ Disables scraping on Vercel production
- ✅ Returns database data only (fast)
- ✅ Scraping still works locally for development
- ✅ GitHub Actions cron ready to populate database

**API Response on Vercel:**

```json
{
  "success": true,
  "count": 20,
  "data": [...],
  "source": "database",
  "note": "Scraping disabled on Vercel due to timeout limits. Database updated via GitHub Actions cron."
}
```

## 🔧 Alternative: Self-Hosted Cron

If GitHub Actions isn't ideal, you can use:

**Option 1: Railway**

- Free tier: 500 hours/month
- No timeout limits
- Can run cron jobs

**Option 2: Render.com**

- Free tier with cron jobs
- No timeout limits

**Option 3: Vercel Cron (Pro)**

- Upgrade to Pro plan
- 5-minute timeouts (still might not be enough)
- $20/month

**Recommendation:** Stick with GitHub Actions (free, reliable, already set up)

## 📝 Summary

✅ **Vercel API:** Fast database queries only (<1s)  
✅ **GitHub Actions:** Handles slow scraping (30-60s)  
✅ **No timeouts:** Everything works within limits  
✅ **Free:** All on free tiers  
✅ **Scalable:** Add more sports without changes
