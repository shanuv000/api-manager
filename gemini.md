# API-Manager — Project Reference

> **For AI Agents:** Read this file at the start of every conversation to understand the project.
> **🚨 MANDATORY — When investigating ANY service issue, health problem, or scraper failure:**
> 1. **PM2 logs first:** `pm2 logs news-scraper --lines 100` and `pm2 logs content-enhancer --lines 50`
> 2. **Uptime-Kuma monitor status:** `docker exec uptime-kuma sqlite3 /app/data/kuma.db "SELECT m.name, h.status, h.msg, h.time FROM heartbeat h JOIN monitor m ON h.monitor_id=m.id WHERE h.id IN (SELECT MAX(id) FROM heartbeat GROUP BY monitor_id) ORDER BY h.status ASC, m.name;" | head -30`
> 3. **Recent DOWN events:** `docker exec uptime-kuma sqlite3 /app/data/kuma.db "SELECT m.name, h.msg, h.time FROM heartbeat h JOIN monitor m ON h.monitor_id=m.id WHERE h.status=0 ORDER BY h.time DESC LIMIT 10;"`
> **Last Updated:** Mar 6, 2026 (Scraper Reliability — flock overlap protection, reduced timeouts, Discord cooldown) | **Status:** 🟢 ACTIVE

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
├── ecosystem.config.js       # PM2 configuration (6 services: api-manager, live-score-worker, recent-score-worker, tweet-worker, news-scraper, content-enhancer)
├── component/
│   ├── middleware.js          # CORS, Helmet, Rate Limiter (60/min)
│   ├── prismaClient.js       # PG pool (max:5, 5s timeout) + Prisma client
│   └── redisClient.js        # ioredis — general cache (debug-gated logs)
├── routes/Cricket/
│   ├── index.js              # All API endpoints (~3500 lines)
│   ├── ipl.js                # IPL data (JSONP API: schedule, points, teams)
│   ├── liveScoresNew.js      # Live scores using Redis worker
│   ├── commentaryRouter.js   # Match commentary
│   ├── scorecard.js          # Scorecard parsing
│   ├── stats.js              # Stats/rankings (RapidAPI)
│   └── player.js             # Player profiles (batting + bowling + info, aggregated)
├── scrapers/                 # News scrapers + workers
│   ├── live-score-worker.js  # PM2 Always On: Scrapes Cricbuzz → Redis (60s), populates match index
│   ├── recent-score-worker.js # PM2 Always On: Refreshes recent/upcoming caches (15min), populates match index
│   ├── tweet-worker.js       # PM2 Cron: Posts to Twitter 4x/day
│   ├── content-enhancer-claude.js  # PM2 Cron (fork mode): AI enhancement (Gemini 3.1 Pro High) — loop-until-done, 55min max, process.exit(0) on completion
│   ├── content-enhancer.js   # ChatGPT batch enhancement (alternate)
│   ├── prompts/              # System prompts for enhancer/formatter
│   ├── cricbuzz-news-scraper.js    # Cricbuzz scraper (Puppeteer + stealth)
│   ├── espncricinfo-puppeteer-scraper.js  # ESPN Cricinfo scraper
│   ├── icc-news-scraper.js         # ICC Cricket scraper
│   ├── bbc-cricket-scraper.js      # BBC Sport scraper
│   ├── iplt20-news-scraper.js      # IPL T20 scraper (disabled in pipeline)
│   ├── cricbuzz-photos-scraper.js  # Cricbuzz photo galleries
│   ├── run-cricbuzz-scraper.js      # Cricbuzz runner (2-phase)
│   ├── run-espncricinfo-scraper.js # ESPN runner (2-phase)
│   ├── run-icc-scraper.js          # ICC runner (2-phase)
│   ├── run-bbc-scraper.js          # BBC runner (2-phase)
│   ├── run-scraper.js              # Old Cricbuzz runner (deprecated)
│   └── run-iplt20-scraper.js       # IPL runner
├── scripts/
│   ├── vps-scrape.sh         # CRON: Master news orchestrator
│   ├── prune-news.js         # Delete >90 day articles
│   ├── clear_cache.js        # Clear Redis cache keys
│   └── clear_news_cache.js   # Clear news-specific cache
├── services/
│   ├── series.js             # Cricbuzz series scraper (debug-gated warnings)
│   └── twitter-service.js    # Twitter API v2 integration
├── utils/
│   ├── redis-client.js       # ioredis — live scores cache, match index (Lua scripts, O(1) lookup)
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
| `api-manager` | `server.js` | Express API server | Always On | 500M (heap: 512MB) |
| `live-score-worker` | `scrapers/live-score-worker.js` | Scrapes Cricbuzz → Redis (60s) + match index | Always On | 400M (heap: 320MB) |
| `recent-score-worker` | `scrapers/recent-score-worker.js` | Refreshes recent/upcoming → Redis + match index (15min) | Always On | 200M (heap: 192MB) |
| `tweet-worker` | `scrapers/tweet-worker.js` | Auto-posts tweets 4x/day | `0 3,7,13,16 * * *` UTC | — |
| `news-scraper` | `scripts/vps-scrape.sh` | Full news scrape pipeline | `35 0,2,4,6,8,10,12,14,16,18 * * *` | — |
| `content-enhancer` | `scrapers/content-enhancer-claude.js` | AI article enhancement (fork mode) | `45 0,4,8,12,16,20 * * *` | 300M (heap: 256MB) |

### IST Schedule Reference (UTC+5:30)
- **Tweet Worker:** 8:30 AM, 12:30 PM, 6:30 PM, 9:30 PM IST
- **News Scraper:** Every 2 hours from 6:05 AM to 12:05 AM IST (offset by 5m for safety)
- **Content Enhancer:** Every 4 hours at :45 (10min after scrapers): 6:15 AM, 10:15 AM, 2:15 PM, 6:15 PM, 10:15 PM, 2:15 AM IST

### News Scraper Pipeline (vps-scrape.sh)
Runs sequentially: **Cricbuzz → ESPN Cricinfo → ICC Cricket → BBC Sport** → Pruner

> **Note:** Content enhancer runs independently via PM2 cron (`content-enhancer`). It processes ALL pending articles in a loop-until-done pattern (newest first, 55min max runtime). Uses `exec_mode: 'fork'` (NOT cluster) to ensure clean exit via `process.exit(0)`. See `pm2 logs content-enhancer` for status.

> **Note:** IPL T20 scraper exists (`run-iplt20-scraper.js`) but is currently **commented out** in `vps-scrape.sh`. Enable during IPL season.

### Discord Notification System (vps-scrape.sh)

State-change-based notifications with deduplication:

```
Run completes → Classify status (healthy/critical)
  → Compute error hash (md5, order-independent via sort -u)
  → Load prev state from /tmp/news_scraper_state.json
  → Compare (status, hash) — suppress if identical
  → Build Discord embed → Send only if state changed
  → Write new state file
```

- **Healthy → Critical:** Sends "🚨 Issues" (red embed)
- **Critical → Healthy:** Sends "✅ Recovered" (green embed) — always sent, never suppressed
- **Same state + same hash:** Suppressed (no spam)
- **Critical → Critical (different error):** Subject to cooldown (see below)
- **Disk/Memory alerts:** Sent independently, do not affect scraper classification
- **Crash trap:** EXIT handler sends "CRASHED" notification with duration + exit code
- **Timeout thresholds:** Cricbuzz/ESPN/ICC = 120s, BBC = 180s (with `--kill-after=10s` hard SIGKILL)
- **Exit code handling:** Both 124 (SIGTERM timeout) and 137 (SIGKILL from `--kill-after`) are classified as timeouts
- **Overlap protection:** `flock -n` at script start prevents concurrent PM2 cron runs. Exit before trap registration → no crash notification on skip.
- **Alert cooldown (Mar 6):** Critical alerts use a `last_notified_at` field in the state file (NOT `timestamp`, which resets every run). Suppressed when `elapsed ≤ 7200s`. Result: at most 1 critical alert every 4 hours on a 2h cron.

### 2-Phase Scraper Optimization (Feb 28, 2026)

All 4 active runners use a 2-phase architecture to eliminate wasteful Puppeteer detail page loads:

```
Phase 1: fetchLatestNews()               → 1 page load (listing only)
Phase 2: DB pre-scan (by sourceId)        → Identify new/changed articles
Phase 3: fetchArticleDetails() ONLY for   → 0-N detail page loads (typically 0-2)
         articles that are new or changed
Phase 4: Validate + merge + save/update   → DB writes + Redis cache invalidation
```

**LISTING_BUFFER:** Each runner processes `limit + 2 = 12` articles (10 target + 2 buffer) to prevent missing articles if list ordering shifts between runs.

**Title comparison:** Cricbuzz/ICC/BBC use exact `existing.title !== article.title`. ESPN uses `startsWith()` because ESPN listing titles have junk concatenated (description+timestamps+author).

**Performance:** ~40 detail page loads per cron cycle → ~2 (only genuinely new/changed articles). Steady-state runs complete in ~10 seconds vs ~3-4 minutes previously.

---

## 📡 API Endpoints

### Live Scores (from Redis, updated every 60s by worker)
| Endpoint | Description | Cache TTL |
|----------|-------------|-----------|
| `GET /live-scores` | Currently live matches | 90s (Redis) |
| `GET /live-scores/lite` | Lightweight live scores | 90s (Redis) |
| `GET /recent-scores` | Recently completed matches | 1 hour |
| `GET /upcoming-matches` | Scheduled matches | 3 hours |

### Match Lookup (O(1) Redis Index — Feb 26, 2026)
| Endpoint | Description | Cache TTL |
|----------|-------------|-----------|
| `GET /match/:matchId` | **O(1) match lookup** via Redis index, fallback to list scan | Source-inherited (live: 90s, recent: 1800s, upcoming: 3600s) |

> Returns `{ success, data, source }` where `source` is `index-live`, `index-recent`, `index-upcoming`, or `list-fallback-*` (self-healing). Payload ~2KB. TTFB: 1.8-2.7ms.

### Player Profiles (Aggregated, Feb 28, 2026)
| Endpoint | Description | Cache TTL |
|----------|-------------|-----------|
| `GET /player/:id` | Aggregated player profile (info + batting + bowling stats) | 48h (per-section) |

> Returns `{ success, data }` with `data.info`, `data.batting`, `data.bowling`, `data._meta` (cache status per section). Uses RapidAPI Cricbuzz. Each section cached independently.

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

### Series (Enriched, Feb 28, 2026)
| Endpoint | Description | Cache TTL |
|----------|-------------|-----------|
| `GET /series` | All series grouped by month (category filter) | 1 hour |
| `GET /series/current` | Currently running series | 30 min |
| `GET /series/:seriesId` | **Enriched** series detail with match index pipeline | Dynamic (live: 90s, upcoming: 600s, completed: 1800s) |
| `GET /series/:seriesId/points-table` | Points table for a series | 10 min |

> `/series/:seriesId` uses `getMatchIndexBatch()` pipeline to enrich `matchIds` from series page with scores/teams/venue from the match index. Graceful degradation: unindexed matches return as bare `{matchId, title}` objects.

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
**Memory Limit:** `256MB` with `allkeys-lru` eviction (set via `CONFIG SET`, persisted via `redis.conf`)

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
match:{matchId}       → O(1) match index entry (TTL: inherited from source)
scorecard:{matchId}   → Individual match scorecard (TTL: 60s)
commentary:{matchId}  → Match commentary (TTL: 60s)
worker_status         → Worker heartbeat/metadata
cricket:recent-scores → Scraped recent matches (TTL: 3600s)
cricket:upcoming-matches → Scraped upcoming matches (TTL: 10800s)
cricket:news:*        → News listing cache (TTL: 1800s)
article:{slug}        → Individual article cache (TTL: 3600s)
cricket:photos:*      → Image proxy cache (TTL: 24h, was 30d)
```

### Match Index Architecture (Feb 26, 2026)

O(1) Redis-indexed lookup for individual matches. Replaces the old pattern of fetching all 3 lists (live+recent+upcoming ≈137KB) and scanning.

**Key pattern:** `match:<matchId>` → lightweight match object (~2KB) with `_meta: { source, priority, indexedAt }`

**Priority protection (Lua script, atomic):** `live(3) > recent(2) > upcoming(1)`. Lower-priority sources cannot overwrite higher-priority data. Writes use `EVALSHA` for atomicity.

**TTL inheritance:** `match:*` keys inherit TTL from their source (live: 90s, recent: 1800s, upcoming: 3600s) via native Redis `EX`. No stored-TTL anti-pattern.

**Write strategy:** Lua-in-Pipeline (`setMatchIndexBatch`) — each match write is an individual Lua `EVALSHA` call batched inside a pipeline. ~1.34ms for 40 matches.

**Read strategy (Feb 28):** `getMatchIndexBatch(matchIds)` — pipeline-based `MGET` via ioredis `pipeline().get()` calls. Returns `Map<matchId, indexEntry|null>`. ~2ms for 20 keys. Used by `/series/:seriesId` for enrichment.

**Populated by:**
1. `live-score-worker` — every 60s cycle (source: `live`, TTL: 90s)
2. `recent-score-worker` — every 15min (source: `recent`/`upcoming`, TTL: 1800s/3600s)
3. `GET /recent-scores` and `GET /upcoming-matches` — on cache-miss scrapes

**Fallback (self-healing):** If `match:<id>` is missing, the `/match/:matchId` endpoint scans `live_scores_lite`, `cricket:recent-scores`, `cricket:upcoming-matches` lists. If found, it auto-re-indexes the match for future O(1) access.

**Verified performance:** 1.8-2.7ms TTFB, 1946 bytes payload, ~40 active keys.

### Series Enrichment Flow (Feb 28, 2026)
```
/series/:seriesId → composite cache check → MISS?
  → getSeriesDetails(seriesId) → extract matchIds from series page
  → getMatchIndexBatch(matchIds) → O(1) pipeline lookup
  → Merge enriched (teams, scores, venue) + bare (title only)
  → Dynamic TTL: live series → 90s, upcoming → 600s, completed → 1800s
  → setCache() composite
```

**Slug extraction fix:** `services/series.js` now uses canonical URL → match-link frequency analysis → title fallback (was title-only, broke on apostrophes/special chars).

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
# ⚠️ vps-scrape.sh is a BASH script — run with bash or ./, NOT with node!
bash scripts/vps-scrape.sh               # Full pipeline (scrape only, no enhancer)
./scripts/vps-scrape.sh                  # Same thing (uses shebang #!/bin/bash)

# Individual scrapers are Node.js scripts — run with node:
node scrapers/run-cricbuzz-scraper.js     # Cricbuzz only (2-phase)
node scrapers/run-espncricinfo-scraper.js # ESPN only (2-phase)
node scrapers/run-icc-scraper.js          # ICC only (2-phase)
node scrapers/run-bbc-scraper.js          # BBC only (2-phase)
node scrapers/content-enhancer-claude.js  # Enhancer (processes all pending, newest first)
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
redis-cli INFO memory             # Check Redis memory usage (limit: 256M)
redis-cli GET live_scores_lite    # Check live scores
redis-cli FLUSHALL                # Nuclear option — clear everything
```

### Logs
```bash
pm2 logs                              # All PM2 services
pm2 logs --lines 100                  # Last 100 lines
pm2 logs news-scraper --lines 50      # Scraper run logs
pm2 logs content-enhancer --lines 30  # Enhancer logs (fork mode, exits after run)
# Error log should be clean (warnings gated behind NODE_ENV)
cat ~/.pm2/logs/api-manager-error-0.log
# Note: /var/log/cricket-scraper.log is NOT used — PM2 manages all logs internally
```

---

## 🔑 External Dependencies

| Service | Purpose | Config Key |
|---------|---------|------------|
| **Supabase PostgreSQL** | Primary database (pool max: 5) | `DATABASE_URL` |
| **Local Redis** | Caching (256MB limit, LRU eviction) | `127.0.0.1:6379` (no auth) |
| **Gemini 3.1 Pro High** | AI content enhancement | `ANTIGRAVITY_API_KEY` → `ai.urtechy.com` proxy |
| **Twitter API v2** | Auto-posting | `TWITTER_*` |
| **RapidAPI Cricbuzz** | Stats/rankings | `RAPIDAPI_CRICBUZZ_KEY*` (5 rotating keys) |
| **Discord Webhooks** | Error notifications | `DISCORD_WEBHOOK_URL` |

> **Note:** `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are **deprecated** — Redis is now local via ioredis. These env vars can be removed from `.env` and `.env.local`.

---

## 🌐 Infrastructure

| Component | Details |
|-----------|---------|
| **VPS** | Oracle Cloud ARM64 24GB RAM, 4 OCPU (Ubuntu 24.04 Noble) |
| **Architecture** | `aarch64` (ARM64) — system Chromium required for Puppeteer |
| **Process Manager** | PM2 (7 services: api-manager, live-score-worker, recent-score-worker, news-scraper, tweet-worker, content-enhancer, sportspulse) |
| **Reverse Proxy** | Nginx (gzip, security headers, SSL via Cloudflare Origin CA) |
| **CDN / DNS** | Cloudflare ("Full (Strict)" SSL mode) |
| **Redis** | Local Redis 7.0 (`apt install redis-server`), 256MB maxmemory |
| **Node.js** | v20.20.0 (via NodeSource) |
| **VPN** | WireGuard on port 51820/udp |
| **CI/CD** | GitHub Actions — no auto-deploy (manual `git pull` on VPS after merge) |
| **Security** | All services bound to `127.0.0.1` — no public port exposure. SSH key-only auth. |

### Key Infrastructure Notes
- **Express compression is OFF** — Nginx handles gzip globally. Double compression wastes CPU.
- **Rate limiter:** 60 req/min per real IP. Uses `trust proxy` for correct IP via Nginx.
- **PM2 memory limits:** api-manager=500M, live-score-worker=400M. (24GB RAM available, limits kept for stability).
- **Server binding:** `server.js` explicitly binds to `127.0.0.1:5003` — not `0.0.0.0`. Only accessible via Nginx reverse proxy.
- **All internal calls use `127.0.0.1:5003`** — never the public domain (avoids hairpin NAT).
- **Graceful shutdown:** SIGTERM closes both Redis clients, Prisma, and PG pool before exit.
- **PG pool:** max 5 connections, 5s connect timeout, 30s idle timeout.
- **Redis memory:** 256MB hard limit with `allkeys-lru` eviction.
- **Concurrency limiter:** Scorecard enrichment capped at 5 concurrent external requests.
- **Log noise:** Cache HIT/MISS and series warnings gated behind `NODE_ENV !== 'production'`.
- **GitHub Actions:** `health-check.yml` and `warm-cache.yml` cron schedules are **disabled** (target `api-sync.vercel.app` is dead). Workflows can still be triggered manually via `workflow_dispatch`.

### Uptime-Kuma Monitoring (Docker — port 3999)

**28 active monitors** (19 HTTP, 5 TCP, 1 Ping, 2 Push, 1 DB Health). Notifications: Discord webhook (default) + Gmail backup (`smattyvaibhav@gmail.com` → `urtechy000@gmail.com`).

| Key Monitor | Type | Interval |
|-------------|------|----------|
| content-enhancer — Heartbeat | Push (`6b6488ca218fbd79`) | 14400s (4h) |
| news-scraper — Heartbeat | Push (`d181f8aada07d841`) | 7200s (2h) |
| api-manager — Database | HTTP (`/api/health/db`) | 60s |
| SSL — ai.urtechy.com | HTTP | 300s (was 86400s) |

**Push monitors:** If the cron job doesn't send a heartbeat within the interval, Uptime-Kuma fires an alert. Heartbeat calls are in `content-enhancer-claude.js` (finally block) and `vps-scrape.sh` (end of script).

**Health endpoints:** `/api/health` (summary), `/system`, `/redis`, `/workers`, `/match-index`, `/disk`, `/db` (PostgreSQL probe + pool stats + enhancement backlog).

---

## ⚠️ Important Notes

1. **Multiple Projects on Same VPS:**
   - `api-manager` (this project, PM2 managed, `127.0.0.1:5003`) → PostgreSQL (Supabase)
   - `sportspulse` (frontend, Next.js standalone, `127.0.0.1:3000`) → PostgreSQL (Supabase)
   - `vk-blog` (urTechy blog, Next.js standalone, `127.0.0.1:3001`) → Hygraph CMS
   - `chatgpt-bridge` (ChatGPT browser bridge, PM2 managed) → Puppeteer/Playwright
   - **All services bound to `127.0.0.1`** — only accessible via Nginx. No public port exposure.
   - **Isolation:** 24GB RAM, 4 OCPUs — ample for all services to run concurrently.

2. **Rate Limits:**
   - Twitter: 8 tweets/day max (FREE tier)
   - RapidAPI: 5 keys rotating for rankings

3. **Content Flow (2-Phase):**
   ```
   fetchLatestNews() → DB pre-scan → fetchArticleDetails() (new/changed only) → NewsArticle (DB)
   → Gemini 3.1 Pro High Enhancer → EnhancedContent → Tweet Worker → Twitter
   ```

4. **Live Scores Flow:**
   ```
   live-score-worker (60s) → Local Redis → /live-scores endpoint → Frontend
   ```

5. **Match Detail Flow (O(1)):**
   ```
   Frontend /match/:id → api-manager /match/:matchId → Redis GET match:<id> (index) → Response (~2ms)
                                                     ↘ fallback: scan lists → auto-re-index → Response
   ```

---

## 🐛 Troubleshooting

| Issue | Check |
|-------|-------|
| Live scores stale | `pm2 logs live-score-worker` — verify iterations completing |
| Redis not connecting | `redis-cli ping` — should return `PONG` |
| Tweets not posting | Check `TWEET_ENABLED=true` in `.env.local` |
| Scraper failing (Chromium) | All scrapers auto-detect ARM64 Chromium: `CHROME_PATH` env → `/usr/bin/chromium-browser` → `/usr/bin/chromium` → Puppeteer bundled (fallback). Verify with `which chromium-browser`. |
| Scraper failing (general) | `pm2 logs news-scraper --lines 100` or check Discord webhook alerts |
| `SyntaxError` running `vps-scrape.sh` | You ran `node vps-scrape.sh` — it's a **bash** script! Use `bash scripts/vps-scrape.sh` or `./scripts/vps-scrape.sh`. Only `scrapers/*.js` files are run with `node`. |
| API 500 errors | `pm2 logs api-manager` |
| Content-enhancer stuck `online` | Must use `exec_mode: 'fork'` in ecosystem.config.js (NOT cluster). Cluster mode keeps an IPC channel alive that prevents `process.exit()` from working. Fixed Mar 1, 2026. |
| Content-enhancer not running | Check `pm2 list` — should show `stopped` between cron runs. If missing entirely: `pm2 start ecosystem.config.js --only content-enhancer && pm2 save` |
| No enhanced content | Run `node scrapers/content-enhancer-claude.js` manually |
| High memory usage | `pm2 monit` — check against 500M/400M limits |
| `prisma migrate` fails on VPS | `DIRECT_URL` is unreachable from VPS (Supabase direct connection DNS fails). Run migrations from local machine or CI instead. Runtime queries via `DATABASE_URL` (pooler) work fine. |
| `integer expression expected` in vps-scrape.sh | Use `grep -c` instead of `cmd \| grep \| wc -l \|\| echo "0"` under `set -o pipefail`. Fixed Feb 14, 2026. |

---

## 🛡️ Scraper Hardening (Feb 22-26, 2026)

All 5 news scrapers (ESPN, ICC, Cricbuzz, BBC, IPL T20) hardened against bot detection, timeouts, and Chromium crashes in cron. Verified 100% success rate.

**ARM64 Chromium Detection (Feb 26, 2026):** All scrapers use a priority-based Chromium path detection: `CHROME_PATH` env → `/usr/bin/chromium-browser` → `/usr/bin/chromium` → Puppeteer bundled Chrome (last resort). This ensures compatibility on ARM64 VPS where Puppeteer's bundled Chrome is x86_64-only.

**WARP Proxy (ESPN):** Cloudflare WARP SOCKS5 proxy (`socks5://127.0.0.1:40000`) used by ESPN scraper to bypass Akamai datacenter IP blocks. Status checked before ESPN runs; auto-reconnects via `warp-cli connect`. As of Mar 6, 2026: WARP is active and ESPN scraper works (~10s).

| Component | Hardening Applied |
|-----------|-------------------|
| **Evasion** | `puppeteer-extra` + `stealth` plugin, `Object.defineProperty(navigator, 'webdriver')` override |
| **Identity** | Updated User-Agent to Chrome 131, added `--disable-blink-features=AutomationControlled` |
| **Stability**| `protocolTimeout: 60000` (prevents CDP hangs), system Chromium (`/usr/bin/chromium-browser`) prioritized over bundled Chrome (bundled is x86_64, incompatible with ARM64 VPS). `CHROME_PATH` env var checked first. |
| **Speed** | Switched `networkidle2` → `domcontentloaded`, added request interception for ads/trackers |
| **Recovery** | Added `.on('disconnected')` handler, extended retry catch patterns (Connection closed, detached, Target closed) |

---

## 🛡️ Production Hardening (Feb 21 + Feb 26, 2026)

### Phase 1 — Feb 21: 9 fixes applied across 7 files + Redis server config.

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

### Phase 2 — Feb 26: Oracle ARM64 migration hardening

| Fix | Detail |
|-----|--------|
| Redis `maxmemory 256mb` | Upgraded from 128MB (24GB RAM available) |
| `server.js` → `127.0.0.1` | Was `0.0.0.0` — now only accessible via Nginx |
| SSH password auth disabled | Key-only authentication across all SSH configs |
| ARM64 Chromium detection | All 5 scrapers use priority path detection |
| CUPS service removed | Unnecessary print service removed from VPS |
| Oracle port 6080 iptables rule removed | Closed unnecessary open port |
| Disabled health-check + warm-cache workflows | Target `api-sync.vercel.app` is dead/402 |

---

## 📌 Known Issues & TODOs

| Priority | Item | Notes |
|----------|------|-------|
| 🚨 HIGH | `scrapers/run-scraper.js` is **deprecated** | Old single-phase Cricbuzz runner. Replaced by `run-cricbuzz-scraper.js`. Delete or rename to `.deprecated` to prevent accidental use. |
| 🟡 LOW | `degraded` state is dead code in `vps-scrape.sh` | `$WARNINGS` variable is never populated. The `degraded` branch never triggers. Disk/memory warnings are sent as independent alerts (correct behavior). Harmless but could be cleaned up. |
| ✅ FIXED | Scraper overlapping runs | PM2 cron could launch new run while previous still running. Fixed Mar 6: `flock -n` overlap protection. |
| ✅ FIXED | Zombie Chromium processes after timeout | `timeout` sent SIGTERM which Chromium ignored. Fixed Mar 6: `--kill-after=10s` sends SIGKILL. Exit code 137 now correctly classified as timeout. |
| ✅ FIXED | Discord cooldown was non-functional | `timestamp` was reset every run → cooldown never triggered. Fixed Mar 6: uses `last_notified_at` (only set when notification sent) + `-le` boundary fix. |
| ✅ FIXED | Content-enhancer missing from PM2 | Was not registered. Fixed Mar 1: `exec_mode: 'fork'`, `process.exit(0)`, `pm2 save`. |
| ✅ FIXED | Content-enhancer hung in `online` state | `instances: 1` defaulted to cluster mode. Changed to `exec_mode: 'fork'`. Fixed Mar 1. |
| ✅ FIXED | Discord `ENHANCE_COUNT` undefined | Referenced undefined variable. Removed from template. Fixed Mar 1. |
