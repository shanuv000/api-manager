# Cricket News API - Technical Investigation Report

**Generated:** December 22, 2025  
**Project:** Urtechy Sports  
**Investigator:** AI Code Assistant

---

## Executive Summary

This report documents the investigation of the `/news` API implementation in the Sports platform, comparing the documented architecture against the actual codebase implementation.

### Key Findings

| Area                           | Status      | Notes                                     |
| ------------------------------ | ----------- | ----------------------------------------- |
| Database (PostgreSQL/Supabase) | ✅ Aligned  | Prisma ORM with `news_articles` table     |
| Redis Caching                  | ✅ Aligned  | Upstash Redis integration                 |
| RESTful Endpoints              | ✅ Aligned  | Multiple API routes implemented           |
| External API Integration       | ⚠️ Indirect | Uses `api-sync.vercel.app` as data source |
| Cron Job Support               | ✅ Aligned  | `/api/cron/refresh-news` exists           |

---

## Architecture Overview

### Data Flow

```
Client Request
     │
     ▼
┌─────────────────────────┐
│  Next.js API Routes     │
│  /api/news             │
│  /api/cricket/news     │
│  /api/news/search      │
└─────────────────────────┘
     │
     ├──────────────────────────────────┐
     ▼                                  ▼
┌──────────────┐              ┌────────────────────────┐
│ Redis Cache  │   MISS →     │ api-sync.vercel.app    │
│ (Upstash)    │              │ /api/cricket/news      │
└──────────────┘              └────────────────────────┘
     │                               │
     │← ───── Cache Response ────────┘
     │
     ▼
┌─────────────────────────┐
│ news_articles (Prisma)  │  ← Used for Search only
│ PostgreSQL/Supabase     │
└─────────────────────────┘
```

---

## API Endpoints

### 1. GET `/api/news`

**File:** `src/app/api/news/route.ts`

**Purpose:** General news fetch endpoint

**Query Parameters:**

- `size` - Number of articles (default: 10, max: 20)
- `sport` - Filter by sport (only cricket supported)

**Response Format:**

```json
{
  "articles": [...],
  "totalCount": 10,
  "source": "cricbuzz",
  "cached": true
}
```

**Caching:** Force-dynamic (no caching at route level)

---

### 2. GET `/api/cricket/news`

**File:** `src/app/api/cricket/news/route.ts`

**Purpose:** Cricket-specific news with detail support

**Query Parameters:**

- `id` - Get specific article by ID
- `limit` - Number of articles (default: 10, max: 20)

**Response Format:**

```json
{
  "success": true,
  "data": [...],
  "count": 10
}
```

**Caching:**

- HTTP Cache-Control: `s-maxage=900, stale-while-revalidate=1800`
- Redis TTL: 15 minutes

---

### 3. GET `/api/news/search`

**File:** `src/app/api/news/search/route.ts`

**Purpose:** Advanced search with filters and relevance scoring

**Query Parameters:**

- `q` - Search query (min 2 chars)
- `category` - Filter by category (match-reports, player-news, transfers, analysis, interviews)
- `dateRange` - Filter by date (today, week, month)
- `sport` - Filter by sport
- `limit` - Number of results (default: 10, max: 50)

**Features:**

- Multi-field search (title, description, tags)
- Relevance scoring algorithm
- Queries PostgreSQL directly via Prisma

---

### 4. GET `/api/cron/refresh-news`

**File:** `src/app/api/cron/refresh-news/route.ts`

**Purpose:** Scheduled cache refresh (every 3 hours)

**Authentication:** Requires `CRON_SECRET` query parameter

**Actions:**

- Clears Redis cache keys
- Logs article counts from database

---

## Database Schema

**Table:** `news_articles`

| Field             | Type     | Notes                           |
| ----------------- | -------- | ------------------------------- |
| `id`              | String   | Primary key                     |
| `slug`            | String   | Unique, indexed                 |
| `sport`           | String   | Indexed with category           |
| `category`        | String?  | Optional category               |
| `title`           | String   | Article headline                |
| `description`     | String?  | SEO summary                     |
| `content`         | String?  | Full article text               |
| `imageUrl`        | String?  | Primary image                   |
| `thumbnailUrl`    | String?  | Thumbnail image                 |
| `publishedTime`   | String?  | ⚠️ Should be DateTime           |
| `sourceUrl`       | String   | Unique source link              |
| `sourceId`        | String   | Unique, for duplicate detection |
| `sourceName`      | String   | "Cricbuzz" or "ESPN Cricinfo"   |
| `metaTitle`       | String?  | SEO title                       |
| `metaDesc`        | String?  | SEO description                 |
| `tags`            | String[] | Auto-generated tags             |
| `relatedArticles` | Json?    | Related article references      |
| `scrapedAt`       | DateTime | Scrape timestamp                |
| `createdAt`       | DateTime | Creation timestamp              |
| `updatedAt`       | DateTime | Last update                     |

---

## Cache Configuration

### Redis (Upstash)

| Cache Key              | TTL    | Purpose                  |
| ---------------------- | ------ | ------------------------ |
| `cricket:news:list:v2` | 15 min | News list cache          |
| `cricket:news:{id}:v2` | 1 hour | Individual article cache |

### Next.js ISR

| Page           | Revalidation | Location            |
| -------------- | ------------ | ------------------- |
| `/news`        | 30 min       | `revalidate = 1800` |
| `/news/[slug]` | 30 min       | ISR                 |

### HTTP Cache-Control

```
Cache-Control: public, s-maxage=900, stale-while-revalidate=1800
```

---

## Issues Identified

### 🔴 High Priority

#### 1. Inconsistent API Response Formats

**Problem:** Two different response structures across endpoints.

| Endpoint            | Format                                     |
| ------------------- | ------------------------------------------ |
| `/api/news`         | `{ articles, totalCount, source, cached }` |
| `/api/cricket/news` | `{ success, data, count }`                 |

**Impact:** Client applications must handle two different formats.

**Recommendation:** Standardize to a single format:

```json
{
  "success": true,
  "data": [...],
  "count": 10,
  "meta": { "source": "cricbuzz", "cached": true }
}
```

---

#### 2. publishedTime Stored as String

**Problem:** The `publishedTime` field is `String?` instead of `DateTime`.

**File:** `prisma/schema.prisma` (line 18)

**Impact:**

- Cannot use date-based queries efficiently
- Date filtering in search requires string parsing

**Recommendation:** Migrate to `DateTime` type:

```prisma
publishedTime   DateTime?
```

---

### 🟡 Medium Priority

#### 3. Missing Health Endpoint

**Problem:** No `/api/cricket/health` endpoint exists for monitoring.

**Recommendation:** Add health check endpoint:

```typescript
// src/app/api/cricket/health/route.ts
export async function GET() {
  return NextResponse.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    services: {
      database: await checkDb(),
      redis: isRedisAvailable(),
      externalApi: await checkExternalApi(),
    },
  });
}
```

---

#### 4. ID-based vs Slug-based Article Lookup

**Problem:** Article details fetched via `?id=` query param instead of `/news/[slug]` route.

**Current:** `GET /api/cricket/news?id=123`

**SEO-Friendly:** `GET /api/cricket/news/article-slug-here`

---

### 🟢 Low Priority

#### 5. Cron Job Only Clears Cache

**Problem:** `/api/cron/refresh-news` only invalidates Redis cache; actual scraping happens externally.

**Note:** This is acceptable if `api-sync.vercel.app` handles scraping independently.

---

## Service Dependencies

| Service             | Purpose           | Cost              |
| ------------------- | ----------------- | ----------------- |
| Upstash Redis       | Caching layer     | Free tier         |
| Supabase PostgreSQL | Article storage   | Free tier (500MB) |
| api-sync.vercel.app | External news API | $0 (self-hosted)  |
| Vercel              | Hosting & Cron    | Free tier         |

---

## File References

| File                                                                                                | Purpose               |
| --------------------------------------------------------------------------------------------------- | --------------------- |
| [route.ts](file:///Users/shanumac/Documents/dev2/nextJs/sports/src/app/api/news/route.ts)           | General news endpoint |
| [route.ts](file:///Users/shanumac/Documents/dev2/nextJs/sports/src/app/api/cricket/news/route.ts)   | Cricket news endpoint |
| [route.ts](file:///Users/shanumac/Documents/dev2/nextJs/sports/src/app/api/news/search/route.ts)    | Search endpoint       |
| [cricket-news.ts](file:///Users/shanumac/Documents/dev2/nextJs/sports/src/services/cricket-news.ts) | News service layer    |
| [redis.ts](file:///Users/shanumac/Documents/dev2/nextJs/sports/src/lib/redis.ts)                    | Redis utilities       |
| [schema.prisma](file:///Users/shanumac/Documents/dev2/nextJs/sports/prisma/schema.prisma)           | Database schema       |
| [cricket.ts](file:///Users/shanumac/Documents/dev2/nextJs/sports/src/types/cricket.ts)              | Type definitions      |

---

## Recommendations Summary

| Priority  | Issue                      | Action                                |
| --------- | -------------------------- | ------------------------------------- |
| 🔴 High   | Inconsistent API responses | Standardize response format           |
| 🔴 High   | publishedTime as String    | Migrate to DateTime type              |
| 🟡 Medium | No health endpoint         | Add monitoring endpoint               |
| 🟡 Medium | ID vs Slug routing         | Consider slug-based routes            |
| 🟢 Low    | Cron only clears cache     | Document external scraping dependency |

---

## Appendix: Type Definitions

### CricketNewsArticle

```typescript
interface CricketNewsArticle {
  id: string;
  headline: string;
  intro: string;
  content?: string;
  source: string;
  publishedAt: string;
  imageUrl?: string;
  category?: string;
  slug: string;
  context?: string;
}
```

### NewsArticle

```typescript
interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  content?: string;
  source: string;
  sourceUrl: string;
  imageUrl?: string;
  sport: string;
  tags: string[];
  relevance: number;
  publishedAt: string;
  slug: string;
}
```

---

_Report generated by automated codebase analysis._
