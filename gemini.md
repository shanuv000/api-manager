# API-Manager — Project Reference

> **For AI Agents:** Read this file at the start of every conversation to understand the project.
> **Last Updated:** Feb 21, 2026 | **Status:** 🟢 ACTIVE

---

## 🎯 Project Purpose

**Cricket News & Live Scores API** with automated content scraping, AI enhancement, and Twitter posting. Backend service for the SportsPulse frontend.

**Frontend URL:** `https://play.urtechy.com`
**API Base (Internal):** `http://127.0.0.1:5003/api/cricket` (used by frontend, same VPS)
**API Base (Public):** `https://drop.urtechy.com/api/cricket` (external access only)

---

## 🏗️ Architecture Overview

```
api-manager/
├── server.js                 # Express entry (Port 5003) + graceful shutdown
├── ecosystem.config.js       # PM2 configuration (4 services)
├── component/
│   ├── middleware.js          # CORS, Helmet, Rate Limiter (60/min)
│   ├── prismaClient.js       # PG pool (max:5, 5s timeout) + Prisma client
│   └── redisClient.js        # ioredis — general cache (debug-gated logs)
├── routes/Cricket/
│   ├── index.js              # All API endpoints (~3342 lines)
│   ├── ipl.js                # IPL data (JSONP API: schedule, points, teams)
│   ├── liveScoresNew.js      # Live scores using Redis worker
│   ├── commentaryRouter.js   # Match commentary
│   ├── scorecard.js          # Scorecard parsing
│   └── stats.js              # Stats/rankings (RapidAPI)
├── scrapers/                 # News scrapers + workers
│   ├── live-score-worker.js  # PM2 Always On: Scrapes Cricbuzz → Redis (60s)
│   ├── tweet-worker.js       # PM2 Cron: Posts to Twitter 4x/day
│   ├── content-enhancer-claude.js  # AI enhancement (Gemini 3 Flash)
│   ├── prompts/              # System prompts for enhancer/formatter
│   ├── run-scraper.js        # Cricbuzz news
│   ├── run-espncricinfo-scraper.js
│   ├── run-icc-scraper.js
│   └── run-bbc-scraper.js
├── scripts/
│   ├── vps-scrape.sh         # CRON: Master news orchestrator
│   ├── prune-news.js         # Delete >90 day articles
│   ├── clear_cache.js        # Clear Redis cache keys
│   └── clear_news_cache.js   # Clear news-specific cache
├── services/
│   ├── series.js             # Cricbuzz series scraper (debug-gated warnings)
│   └── twitter-service.js    # Twitter API v2 integration
├── utils/
│   ├── redis-client.js       # ioredis — live scores cache (debug-gated logs)
│   ├── concurrency-limiter.js # Async concurrency control (replaces p-limit)
│   ├── scraper-cache.js      # In-memory NodeCache (scraper responses)
│   ├── scraper-health.js     # Scraper health monitoring
│   └── apiErrors.js          # Error handling utilities
└── prisma/schema.prisma      # Database models
```

---

## ⚙️ PM2 Services

| Service | Script | Purpose | Schedule | Memory Limit |
|---------|--------|---------|----------|-------------|
| `api-manager` | `server.js` | Express API server | Always On | 300M (heap: 320MB) |
| `live-score-worker` | `scrapers/live-score-worker.js` | Scrapes Cricbuzz → Redis (every 60s) | Always On | 250M (heap: 200MB) |
| `tweet-worker` | `scrapers/tweet-worker.js` | Auto-posts tweets 4x/day | `0 3,7,13,16 * * *` UTC | — |
| `news-scraper` | `scripts/vps-scrape.sh` | Full news scrape pipeline | `35 0,2,4,6,8,10,12,14,16,18 * * *` | — |

### IST Schedule Reference (UTC+5:30)
- **Tweet Worker:** 8:30 AM, 12:30 PM, 6:30 PM, 9:30 PM IST
- **News Scraper:** Every 2 hours from 6:05 AM to 12:05 AM IST (offset by 5m for safety)

---

## 📡 API Endpoints

### Live Scores (from Redis, updated every 60s by worker)
| Endpoint | Description | Cache TTL |
|----------|-------------|-----------|
| `GET /live-scores` | Currently live matches | 90s (Redis) |
| `GET /live-scores/lite` | Lightweight live scores | 90s (Redis) |
| `GET /recent-scores` | Recently completed matches | 1 hour |
| `GET /upcoming-matches` | Scheduled matches | 3 hours |

### Scorecards & Commentary (from Redis, per-match)
| Endpoint | Description | Cache TTL |
|----------|-------------|-----------|
| `GET /scorecard/:matchId` | Full match scorecard | 60s (Redis) |
| `GET /commentary/:matchId` | Ball-by-ball commentary | 60s (Redis) |

### News (from PostgreSQL + Redis cache)
| Endpoint | Description | Cache TTL |
|----------|-------------|-----------|
| `GET /news?limit=10&source=all` | News articles list | 30 min |
| `GET /news/:slug` | Single article by slug | 1 hour |

### Stats (via RapidAPI Cricbuzz)
| Endpoint | Description | Cache TTL |
|----------|-------------|-----------|
| `GET /stats/rankings?category=batsmen&formatType=test` | Player rankings | 24 hours |
| `GET /stats/standings?matchType=1` | ICC standings | 24 hours |
| `GET /stats/record-filters` | Available filter options | 24 hours |
| `GET /stats/records?statsType=mostRuns` | Cricket records | 24 hours |

### Photos
| Endpoint | Description | Cache TTL |
|----------|-------------|-----------|
| `GET /photos/list` | Photo galleries | 1 hour |
| `GET /photos/gallery/:id` | Gallery details | 1 hour |
| `GET /photos/image/i1/c{imageId}/i.jpg` | Image proxy | — |

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

## 🔴 Redis Architecture (Local — ioredis)

**Host:** `127.0.0.1:6379` (Redis 7.0, installed via `apt`)
**Memory Limit:** `128MB` with `allkeys-lru` eviction (set via `CONFIG SET`, persisted)

### Two Redis Clients

| Client | File | Purpose | Used By |
|--------|------|---------|---------|
| `redis-client.js` | `utils/redis-client.js` | Live scores, worker status, scorecards, commentary | `live-score-worker`, `liveScoresNew.js`, `commentaryRouter.js`, `index.js` |
| `redisClient.js` | `component/redisClient.js` | General cache (news, articles, cricket data) | `routes/Cricket/index.js`, `routes/Cricket/stats.js` |

> **Note:** Both clients gate HIT/MISS/SET/DELETE logs behind `NODE_ENV !== 'production'`. Cache invalidation uses `SCAN` iterator (not `KEYS`).

### Key Patterns
```
live_scores_cache     → Full live match data (TTL: 90s)
live_scores_lite      → Lightweight scores (TTL: 90s)
scorecard:{matchId}   → Individual match scorecard (TTL: 60s)
commentary:{matchId}  → Match commentary (TTL: 60s)
worker_status         → Worker heartbeat/metadata
cricket:recent-scores → Scraped recent matches (TTL: 3600s)
cricket:upcoming-matches → Scraped upcoming matches (TTL: 10800s)
cricket:news:*        → News listing cache (TTL: 1800s)
article:{slug}        → Individual article cache (TTL: 3600s)
cricket:photos:*      → Image proxy cache (TTL: 24h, was 30d)
```

### In-Memory Cache (NodeCache)
- `scraper-cache.js` — per-scraper type caches with `useClones: false` for performance
- Used for short-lived scraper responses before Redis persistence

---

## 🔧 Common Operations

### Service Management
```bash
pm2 list                          # View all services
pm2 restart api-manager           # Restart API (graceful shutdown closes Redis + PG)
pm2 restart all                   # Restart everything
pm2 logs tweet-worker --lines 50  # View logs
pm2 logs live-score-worker        # Check live score worker
```

### Manual Scraping
```bash
./scripts/vps-scrape.sh           # Full pipeline (scrape + enhance)
node scrapers/run-scraper.js      # Cricbuzz only
node scrapers/content-enhancer-claude.js  # AI enhance unprocessed articles
```

### Twitter
```bash
npm run tweet:dry                 # Test (no posting)
npm run tweet:single              # Post one tweet
npm run tweet:run                 # Full tweet run
```

### Database & Cache
```bash
node scripts/prune-news.js        # Remove >90 day articles
node scripts/clear_cache.js       # Clear cricket cache keys
redis-cli INFO memory             # Check Redis memory usage (limit: 128M)
redis-cli GET live_scores_lite    # Check live scores
redis-cli FLUSHALL                # Nuclear option — clear everything
```

### Logs
```bash
tail -f /var/log/cricket-scraper.log  # Cron output
pm2 logs                              # All PM2 services
pm2 logs --lines 100                  # Last 100 lines
# Error log should be clean (warnings gated behind NODE_ENV)
cat ~/.pm2/logs/api-manager-error-0.log
```

---

## 🔑 External Dependencies

| Service | Purpose | Config Key |
|---------|---------|------------|
| **Supabase PostgreSQL** | Primary database (pool max: 5) | `DATABASE_URL` |
| **Local Redis** | Caching (128MB limit, LRU eviction) | `127.0.0.1:6379` (no auth) |
| **Gemini 3 Flash** | AI content enhancement | `ANTIGRAVITY_API_KEY` → `ai.urtechy.com` proxy |
| **Twitter API v2** | Auto-posting | `TWITTER_*` |
| **RapidAPI Cricbuzz** | Stats/rankings | `RAPIDAPI_CRICBUZZ_KEY*` (5 rotating keys) |
| **Discord Webhooks** | Error notifications | `DISCORD_WEBHOOK_URL` |

> **Note:** `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are **deprecated** — Redis is now local via ioredis. These env vars can be removed from `.env` and `.env.local`.

---

## 🌐 Infrastructure

| Component | Details |
|-----------|---------|
| **VPS** | DigitalOcean 4GB (Ubuntu 24.04 Noble) |
| **Process Manager** | PM2 (4 services, memory-limited) |
| **Reverse Proxy** | Nginx (gzip, security headers, SSL) |
| **CDN / DNS** | Cloudflare ("Full" SSL mode) |
| **Redis** | Local Redis 7.0 (`apt install redis-server`) |
| **Node.js** | v20.x (via NodeSource) |

### Key Infrastructure Notes
- **Express compression is OFF** — Nginx handles gzip globally. Double compression wastes CPU.
- **Rate limiter:** 60 req/min per real IP. Uses `trust proxy` for correct IP via Nginx.
- **PM2 memory limits:** api-manager=300M, live-score-worker=250M. Prevents swap on 4GB VPS.
- **All internal calls use `127.0.0.1:5003`** — never the public domain (avoids hairpin NAT).
- **Graceful shutdown:** SIGTERM closes both Redis clients, Prisma, and PG pool before exit.
- **PG pool:** max 5 connections, 5s connect timeout, 30s idle timeout.
- **Redis memory:** 128MB hard limit with `allkeys-lru` eviction.
- **Concurrency limiter:** Scorecard enrichment capped at 5 concurrent external requests.
- **Log noise:** Cache HIT/MISS and series warnings gated behind `NODE_ENV !== 'production'`.

---

## ⚠️ Important Notes

1. **Two Projects on Same VPS:**
   - `api-manager` (this project, PM2 managed) → PostgreSQL (Supabase)
   - `news-trading-scrape` (separate project, system cron) → SQLite (local)
   - **Isolation:** Schedules offset (xx:35 vs xx:00/30) to prevent CPU/RAM contention.

2. **Rate Limits:**
   - Twitter: 8 tweets/day max (FREE tier)
   - RapidAPI: 5 keys rotating for rankings

3. **Content Flow:**
   ```
   Scrapers → NewsArticle (DB) → Gemini Flash Enhancer → EnhancedContent → Tweet Worker → Twitter
   ```

4. **Live Scores Flow:**
   ```
   live-score-worker (60s) → Local Redis → /live-scores endpoint → Frontend
   ```

---

## 🐛 Troubleshooting

| Issue | Check |
|-------|-------|
| Live scores stale | `pm2 logs live-score-worker` — verify iterations completing |
| Redis not connecting | `redis-cli ping` — should return `PONG` |
| Tweets not posting | Check `TWEET_ENABLED=true` in `.env.local` |
| Scraper failing | Check `/var/log/cricket-scraper.log` |
| API 500 errors | `pm2 logs api-manager` |
| No enhanced content | Run `node scrapers/content-enhancer-claude.js` manually |
| High memory usage | `pm2 monit` — check against 300M/250M limits |
| `integer expression expected` in vps-scrape.sh | Use `grep -c` instead of `cmd \| grep \| wc -l \|\| echo "0"` under `set -o pipefail`. Fixed Feb 14, 2026. |

---

## 🛡️ Production Hardening (Feb 21, 2026)

9 fixes applied across 7 files + Redis server config. All verified with 18-endpoint test suite.

| Priority | Fix | File(s) |
|----------|-----|--------|
| P0 | Redis `maxmemory 128mb` + `allkeys-lru` | Redis server config |
| P0 | PG pool `max:5`, connect timeout 5s | `component/prismaClient.js` |
| P1 | API key from env var (was hardcoded) | `scrapers/content-enhancer-claude.js`, `.env` |
| P1 | Concurrency limiter for scorecards (max 5) | `routes/Cricket/index.js`, `utils/concurrency-limiter.js` |
| P1 | `KEYS` → `SCAN` in cache invalidation | `component/redisClient.js` |
| P2 | Image cache TTL 30d → 24h | `routes/Cricket/index.js` |
| P3 | Graceful shutdown (Redis + PG) | `server.js` |
| P3 | Cache logs gated behind DEBUG flag | `component/redisClient.js`, `utils/redis-client.js` |
| P3 | pointsTableData warnings gated behind DEBUG | `services/series.js` |
