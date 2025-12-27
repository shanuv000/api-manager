# Live Scores API Performance Upgrade Report

**Report Date:** December 27, 2025  
**API Version:** v1.1  
**Status:** ✅ Deployed

---

## Executive Summary

The `/api/cricket/live-scores` endpoint has been upgraded from **on-demand scraping** to a **background worker + Redis cache** architecture. This reduces response times from 10-30 seconds to ~100ms.

---

## Performance Improvement

| Metric             | Before          | After               |
| ------------------ | --------------- | ------------------- |
| **Response Time**  | 10-30 seconds   | ~100-200ms          |
| **Data Freshness** | On-demand       | 60 second intervals |
| **Error Handling** | Inline failures | Discord alerts      |

---

## API Changes

### ✅ No Breaking Changes

Existing frontend code will continue to work without modifications.

### 🆕 New Response Fields (Optional)

```typescript
interface LiveScoresResponse {
  success: boolean;
  count: number;
  data: Match[];

  // NEW FIELDS (v1.1)
  fromCache: boolean; // true if from cache
  cacheSource: "redis" | "memory" | "fallback";
  cacheAgeSeconds?: number; // Age of cached data
  responseTime: number; // Response time in ms
}
```

### 🆕 New Monitoring Endpoint

```
GET /api/cricket/live-scores/worker-status
```

**Response:**

```json
{
  "success": true,
  "worker": {
    "iteration": 42,
    "matchCount": 4,
    "scorecardCount": 4,
    "lastScrapeMs": 580,
    "timestamp": 1735284364000
  },
  "cache": {
    "available": true,
    "matchCount": 4,
    "ageSeconds": 25
  }
}
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    BEFORE (v1.0)                            │
│  User Request → Scrape Cricbuzz (10-30s) → Response         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    AFTER (v1.1)                             │
│  Background Worker → Redis (every 60s)                      │
│  User Request → Read Redis (100ms) → Response               │
└─────────────────────────────────────────────────────────────┘
```

---

## All Match Endpoints Comparison

| Endpoint                        | Caching          | Architecture      | TTL          | Notes                   |
| ------------------------------- | ---------------- | ----------------- | ------------ | ----------------------- |
| `/api/cricket/live-scores`      | **Redis** (v1.1) | Background Worker | 90s          | ⚡ Upgraded             |
| `/api/cricket/upcoming-matches` | In-Memory        | On-demand scrape  | 300s (5 min) | No scorecards, fast     |
| `/api/cricket/recent-scores`    | In-Memory        | On-demand scrape  | 120s (2 min) | Includes `winner` field |

### Why Only Live Scores Uses Redis?

1. **Live scores change frequently** (every ball) → needs 60s refresh
2. **Live scores include scorecards** → expensive to fetch (multiple requests)
3. **Upcoming/Recent rarely change** → on-demand with in-memory cache is sufficient
4. **Saves Redis commands** → stays within free tier limits

### Match State by Endpoint

| Endpoint                        | `matchState` Value                               |
| ------------------------------- | ------------------------------------------------ |
| `/api/cricket/live-scores`      | `"live"`, `"break"`, `"completed"`, `"upcoming"` |
| `/api/cricket/upcoming-matches` | Always `"upcoming"`                              |
| `/api/cricket/recent-scores`    | Always `"completed"` (includes `winner` field)   |

## Files Changed

| File                              | Change                            |
| --------------------------------- | --------------------------------- |
| `utils/redis-client.js`           | **NEW** - Upstash Redis wrapper   |
| `scrapers/live-score-worker.js`   | **NEW** - Background worker (PM2) |
| `routes/Cricket/liveScoresNew.js` | **MODIFIED** - Redis-first reads  |

---

## Monitoring & Alerts

| Event                   | Notification                                     |
| ----------------------- | ------------------------------------------------ |
| 3+ consecutive failures | 🚨 Discord error alert                           |
| Recovery after failures | ✅ Discord recovery alert                        |
| PM2 logs                | `/home/ubuntu/.pm2/logs/live-score-worker-*.log` |

---

## Frontend Recommendations

### Optional: Display Cache Status

```jsx
function LiveScores({ data }) {
  return (
    <div>
      {data.cacheAgeSeconds > 30 && (
        <span className="text-yellow-500">
          ⚠️ Data is {data.cacheAgeSeconds}s old
        </span>
      )}
      {/* Render scores */}
    </div>
  );
}
```

### Optional: Use Polling

```jsx
// Poll every 30 seconds for fresh data
useEffect(() => {
  const interval = setInterval(() => {
    fetchLiveScores();
  }, 30000);
  return () => clearInterval(interval);
}, []);
```

---

## Upstash Redis Usage (Free Tier)

| Usage               | Daily Commands            |
| ------------------- | ------------------------- |
| Worker writes       | ~1,440 (every 60s)        |
| API reads           | Variable (1 per request)  |
| **Projected total** | ~2,000/day (20% of limit) |

---

## Verification

```bash
# Check worker status
pm2 status live-score-worker

# View logs
pm2 logs live-score-worker --lines 50

# Test API response time
curl -w "\nTime: %{time_total}s\n" http://localhost:3000/api/cricket/live-scores
```
