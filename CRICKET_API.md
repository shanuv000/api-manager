# Cricket API Documentation

## Overview

Real-time cricket match information scraped from Cricbuzz.com. Includes live scores, recent matches, upcoming matches, scorecard details, and news.

## Base URL

```
http://localhost:5003/api/cricket
```

---

## Endpoints

### 1. Live Scores

Get information about matches currently in progress with detailed scorecards.

**Endpoint:** `GET /api/cricket/live-scores`

**Features:**

- ✅ In-memory caching (30s TTL)
- ✅ Retry logic (3 attempts with exponential backoff)
- ✅ Health monitoring with Discord alerts
- ✅ Concurrent scorecard fetching (max 3 parallel)

**Response:**

```json
{
  "success": true,
  "count": 5,
  "data": [...],
  "fromCache": false,
  "responseTime": 1523
}
```

---

### 2. Recent Scores

Get information about recently completed matches.

**Endpoint:** `GET /api/cricket/recent-scores`

**Features:**

- ✅ In-memory caching (2min TTL)
- ✅ Retry logic (3 attempts with exponential backoff)
- ✅ Health monitoring with Discord alerts

**Response:** Same structure as live-scores (without scorecard details)

---

### 3. Upcoming Matches

Get information about scheduled upcoming matches.

**Endpoint:** `GET /api/cricket/upcoming-matches`

**Features:**

- ✅ In-memory caching (5min TTL)
- ✅ Retry logic (3 attempts with exponential backoff)
- ✅ Health monitoring with Discord alerts

**Response:** Same structure as live-scores (scores empty for unstarted matches)

---

### 4. News

Get cricket news articles from multiple sources.

**Endpoint:** `GET /api/cricket/news`

**Query Parameters:**

- `limit` (optional): Number of articles to return (default: 20, max: 100)
- `source` (optional): Filter by source ("Cricbuzz" or "ESPN Cricinfo")

**Response:**

```json
{
  "success": true,
  "count": 20,
  "data": [
    {
      "id": "cuid123",
      "slug": "article-slug",
      "title": "Article Title",
      "description": "Brief description",
      "content": "Full article content",
      "imageUrl": "https://...",
      "sourceName": "Cricbuzz",
      "sourceUrl": "https://...",
      "publishedTime": "2025-12-20T10:00:00.000Z",
      "tags": ["IPL", "India"],
      "createdAt": "2025-12-20T10:00:00.000Z"
    }
  ]
}
```

---

### 5. Single News Article

Get a specific news article by slug.

**Endpoint:** `GET /api/cricket/news/:slug`

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "cuid123",
    "slug": "article-slug",
    "title": "Full Article Title",
    "description": "Brief description",
    "content": "Full article content with paragraphs",
    "imageUrl": "https://...",
    "thumbnailUrl": "https://...",
    "sourceName": "Cricbuzz",
    "sourceUrl": "https://...",
    "publishedTime": "2025-12-20T10:00:00.000Z",
    "metaTitle": "SEO Title",
    "metaDesc": "SEO Description",
    "tags": ["IPL", "India"],
    "relatedArticles": [...]
  }
}
```

---

### 6. Photos

Get cricket photo galleries.

**Endpoint:** `GET /api/cricket/photos`

**Response:**

```json
{
  "success": true,
  "data": [...]
}
```

---

### 7. Stats

Get cricket statistics.

**Endpoint:** `GET /api/cricket/stats`

**Features:**

- ✅ In-memory caching (10min TTL)
- ✅ Retry logic
- ✅ Health monitoring

---

### 8. Scraper Health

Get health status of all scrapers.

**Endpoint:** `GET /api/cricket/health`

**Response:**

```json
{
  "overall": "healthy",
  "scrapers": {
    "liveScores": {
      "status": "healthy",
      "consecutiveFailures": 0,
      "successRate": "99.5%",
      "avgResponseTime": "1200ms",
      "lastSuccess": "2025-12-20T10:00:00.000Z"
    },
    "recentMatches": {...},
    "upcomingMatches": {...}
  }
}
```

---

## Response Structure

### Success Response

| Field          | Type         | Description                    |
| -------------- | ------------ | ------------------------------ |
| `success`      | boolean      | Request status                 |
| `count`        | number       | Number of items returned       |
| `data`         | array/object | Response data                  |
| `fromCache`    | boolean      | Whether response is from cache |
| `responseTime` | number       | Response time in milliseconds  |

### Match Object

| Field             | Type   | Description                                             |
| ----------------- | ------ | ------------------------------------------------------- |
| `title`           | string | Full match title (e.g., "India vs Australia, 3rd Test") |
| `matchLink`       | string | URL to match page                                       |
| `matchDetails`    | string | Match description                                       |
| `status`          | string | Match status                                            |
| `location`        | string | Venue information                                       |
| `playingTeamBat`  | string | Batting team name                                       |
| `playingTeamBall` | string | Bowling team name                                       |
| `teams`           | array  | Full team names                                         |
| `teamAbbr`        | array  | Team abbreviations                                      |
| `liveScorebat`    | string | Batting team score                                      |
| `liveScoreball`   | string | Bowling team score                                      |
| `scores`          | array  | All scores                                              |
| `liveCommentary`  | string | Match result/status text                                |
| `links`           | object | Related links (scorecard, commentary, news)             |
| `scorecard`       | object | Detailed scorecard (live-scores only)                   |

#### Enhanced Fields (NEW)

| Field         | Type   | Description                                    |
| ------------- | ------ | ---------------------------------------------- |
| `matchFormat` | string | Match format (e.g., "3rd Test", "T20I", "ODI") |
| `matchNumber` | string | Match number in series                         |
| `venue`       | string | Stadium/venue name                             |
| `matchState`  | string | `live`, `completed`, `upcoming`, or `break`    |
| `day`         | number | Day number (Test matches only)                 |
| `session`     | number | Session number (Test matches only)             |
| `target`      | number | Target score (chasing team)                    |
| `lead`        | number | Lead by runs (if applicable)                   |
| `trail`       | number | Trail by runs (if applicable)                  |
| `winner`      | string | Winner team name (recent-scores only)          |

### Scorecard Object

```json
{
  "scorecard": [
    {
      "inningsId": 1,
      "inningsHeader": "IND 349-8 (50 Ov)",
      "teamName": "IND",
      "batting": [
        {
          "batter": "Rohit Sharma",
          "dismissal": "c Smith b Starc",
          "runs": "85",
          "balls": "98",
          "fours": "10",
          "sixes": "2",
          "sr": "86.73",
          "isBatting": false
        }
      ],
      "bowling": [
        {
          "bowler": "Mitchell Starc",
          "overs": "10",
          "maidens": "1",
          "runs": "65",
          "wickets": "3",
          "eco": "6.50",
          "isBowling": false
        }
      ]
    }
  ]
}
```

### Error Response

```json
{
  "success": false,
  "error": "Error fetching the webpage",
  "message": "Detailed error message",
  "responseTime": 15000
}
```

---

## Technical Architecture

### Technology Stack

- **Node.js** + Express.js
- **Cheerio** for HTML parsing
- **Puppeteer** for JavaScript-rendered content (news scraper)
- **Prisma** + PostgreSQL (Supabase) for news storage
- **node-cache** for in-memory caching
- **p-limit** for concurrency control

### Caching Configuration

| Scraper           | TTL   | Purpose                   |
| ----------------- | ----- | ------------------------- |
| `liveScores`      | 30s   | Scores change frequently  |
| `recentMatches`   | 2min  | Results update less often |
| `upcomingMatches` | 5min  | Schedule rarely changes   |
| `scorecard`       | 1min  | During live matches       |
| `stats`           | 10min | Static data               |

### Retry Configuration

- **Max Retries:** 3
- **Base Delay:** 2000ms
- **Backoff Multiplier:** 1.5x
- **Retryable Errors:** Timeout, Network, Rate Limit
- **Non-Retryable:** Parse errors, 403 Forbidden

### Health Monitoring

- Tracks success/failure counts per scraper
- Sends Discord alerts after 3 consecutive failures
- Alert cooldown: 5 minutes
- Provides `/health` endpoint for monitoring

---

## News Scraper (Cron Job)

News articles are scraped every 6 hours via cron:

```bash
# Cron schedule (0:30, 6:30, 12:30, 18:30 IST)
30 0,6,12,18 * * * /path/to/scripts/vps-scrape.sh
```

### Sources

1. **Cricbuzz** - Uses Puppeteer with infinite scroll
2. **ESPN Cricinfo** - Uses Puppeteer

### Features

- **Multi-scroll support:** Captures 30+ articles (vs 10 before)
- **Duplicate detection:** Skips already-stored articles
- **Auto-tagging:** Generates tags via Perplexity API
- **Discord notifications:** Reports scraper status

---

## Maintenance Notes

### CSS Selectors (if Cricbuzz changes)

| Element    | Selector                                  |
| ---------- | ----------------------------------------- |
| Match card | `a.w-full.bg-cbWhite.flex.flex-col`       |
| Team name  | `span.hidden.wb\:block.whitespace-nowrap` |
| Score      | `span.font-medium.wb\:font-semibold`      |
| Location   | `span.text-xs.text-cbTxtSec`              |
| Status     | `span[class*="text-cbComplete"]`          |

### Troubleshooting

1. **Empty responses:** Check if Cricbuzz HTML structure changed
2. **Rate limiting:** Reduce concurrent requests, add delays
3. **Timeouts:** Increase timeout settings
4. **Parsing errors:** Update CSS selectors

---

## Environment Variables

| Variable              | Description                  |
| --------------------- | ---------------------------- |
| `PORT`                | Server port (default: 5003)  |
| `DATABASE_URL`        | PostgreSQL connection string |
| `DISCORD_WEBHOOK_URL` | Discord webhook for alerts   |
| `PERPLEXITY_API_KEY`  | For auto-tagging (optional)  |

---

## Last Updated

December 20, 2025 - Added caching, retry logic, health monitoring, and concurrent request limiting
