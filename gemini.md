# API-Manager Project Context

> **For AI Agents:** Read this file at the start of every conversation to understand the project.
> **Last Updated:** Feb 07, 2026 | **Status:** 🟢 ACTIVE

---

## 🎯 Project Purpose

**Cricket News & Live Scores API** with automated content scraping, AI enhancement, and Twitter posting.

**Frontend URL:** https://play.urtechy.com  
**API Base (Production):** https://drop.urtechy.com/api/cricket  
**API Base (Local):** http://localhost:5003/api/cricket

---

## 🏗️ Architecture Quick Reference

```
api-manager/
├── server.js                 # Express entry (Port 5003)
├── ecosystem.config.js       # PM2 configuration
├── routes/Cricket/index.js   # All API endpoints (3292 lines)
├── scrapers/                 # News scrapers + workers
│   ├── live-score-worker.js  # PM2: Scrapes every 60s → Redis
│   ├── tweet-worker.js       # PM2 Cron: Posts to Twitter 4x/day
│   ├── content-enhancer-claude.js  # AI enhancement (Gemini 3 Flash)
│   ├── run-scraper.js        # Cricbuzz
│   ├── run-espncricinfo-scraper.js
│   ├── run-icc-scraper.js
│   ├── run-bbc-scraper.js
│   └── run-iplt20-scraper.js
├── scripts/
│   ├── vps-scrape.sh         # CRON: Master orchestrator
│   ├── prune-news.js         # Delete >90 day articles
│   └── clear_news_cache.js
├── services/
│   └── twitter-service.js    # Twitter API integration
├── utils/
│   ├── redis-client.js       # Upstash Redis (live scores cache)
│   └── apiErrors.js          # Error handling
└── prisma/schema.prisma      # Database models
```

---

## ⚙️ Services & Automation

### PM2 Services (Always Running)
| Service | Script | Purpose |
|---------|--------|---------|
| `api-manager` | server.js | Express API server |
| `live-score-worker` | scrapers/live-score-worker.js | Scrapes Cricbuzz → Redis every 60s |
| `tweet-worker` | scrapers/tweet-worker.js | Auto-posts tweets (cron: 4x daily) |

### Cron Jobs
| Schedule (UTC) | IST | Command |
|----------------|-----|---------|
| `30 0,6,9,12,15,18,21 * * *` | 6:00, 11:30, 15:00, 18:00, 21:00, 00:00, 3:00 | `vps-scrape.sh` (all scrapers + AI enhancer) |

---

## 📡 API Endpoints

### Live Scores
- `GET /live-scores` - Currently live matches (from Redis)
- `GET /recent-scores` - Recently completed matches
- `GET /upcoming-matches` - Scheduled matches

### News
- `GET /news?limit=10&source=all` - News articles (database)
- `GET /news/:slug` - Single article

### Stats (RapidAPI)
- `GET /stats/rankings?category=batsmen&formatType=test`
- `GET /stats/standings?matchType=1`
- `GET /stats/records?statsType=mostRuns`

### Photos
- `GET /photos/list` - Photo galleries
- `GET /photos/gallery/:id` - Gallery details
- `GET /photos/image/i1/c{imageId}/i.jpg` - Image proxy

---

## 🗄️ Database Schema (Supabase PostgreSQL)

```prisma
model NewsArticle {
  id            String   @id
  slug          String   @unique  // SEO URL identifier
  title         String
  description   String?
  content       String?
  imageUrl      String?
  sourceUrl     String   @unique
  sourceId      String   @unique  // External source ID
  sourceName    String   // "Cricbuzz", "ESPN", "BBC", etc.
  tags          String[]
  sport         String   // "cricket"
  category      String?
  enhancedContent EnhancedContent?  // AI-generated content
}

model EnhancedContent {
  id              String   @id
  articleId       String   @unique
  title           String   // SEO title (60 chars)
  content         String   // Full markdown (300-500 words)
  metaDescription String   // SEO meta (155 chars)
  keyTakeaways    String[] // 3-5 bullet points
  tweetedAt       DateTime?  // When posted to Twitter (null = not tweeted)
  tweetId         String?    // Twitter post ID
}
```

---

## 🔧 Common Operations

### Service Management
```bash
pm2 list                          # View all services
pm2 restart api-manager           # Restart API
pm2 logs tweet-worker --lines 50  # View logs
```

### Manual Scraping
```bash
./scripts/vps-scrape.sh           # Full pipeline
node scrapers/run-scraper.js      # Cricbuzz only
node scrapers/content-enhancer-claude.js  # AI enhance
```

### Twitter
```bash
npm run tweet:dry                 # Test (no posting)
npm run tweet:single              # Post one tweet
```

### Database
```bash
node scripts/prune-news.js        # Remove old articles
node scripts/clear_news_cache.js  # Clear cache
```

### Logs
```bash
tail -f /var/log/cricket-scraper.log  # Cron output
pm2 logs                              # PM2 services
```

---

## 🔑 External Dependencies

| Service | Purpose | Config Key |
|---------|---------|------------|
| **Supabase PostgreSQL** | Primary database | `DATABASE_URL` |
| **Upstash Redis** | Live scores cache | `UPSTASH_REDIS_*` |
| **Gemini 3 Flash** | AI content enhancement | `ai.urtechy.com` proxy |
| **Twitter API v2** | Auto-posting | `TWITTER_*` |
| **RapidAPI Cricbuzz** | Stats/rankings | `RAPIDAPI_CRICBUZZ_KEY*` (5 rotating) |
| **Discord Webhooks** | Notifications | `DISCORD_WEBHOOK_URL` |

---

## ⚠️ Important Notes

1. **Two Projects Exist:**
   - `api-manager` (this) → PostgreSQL (Supabase)
   - `news-trading-scrape` (legacy) → SQLite (local)

2. **Rate Limits:**
   - Twitter: 8 tweets/day max (FREE tier)
   - RapidAPI: 5 keys rotating for rankings

3. **Content Flow:**
   ```
   Scrapers → NewsArticle → Gemini Flash Enhancer → EnhancedContent → Tweet Worker → Twitter
   ```

4. **Live Scores Flow:**
   ```
   live-score-worker (60s) → Upstash Redis → /live-scores endpoint
   ```

---

## 🐛 Troubleshooting

| Issue | Check |
|-------|-------|
| Live scores stale | `pm2 logs live-score-worker` |
| Tweets not posting | `TWEET_ENABLED=true` in .env.local |
| Scraper failing | Check `/var/log/cricket-scraper.log` |
| API 500 errors | `pm2 logs api-manager` |
| No enhanced content | Run `node scrapers/content-enhancer-claude.js` |
