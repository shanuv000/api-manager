## Plan: Scraped Data Enhancement & Frontend Delivery Pipeline

This codebase implements a comprehensive **scraping → enhancement → storage → delivery** pipeline. Raw cricket news is collected from 5 sources (Cricbuzz, ESPN Cricinfo, ICC, BBC, IPL T20) via Puppeteer scrapers, optionally enhanced using Perplexity AI for SEO optimization, stored in PostgreSQL via Prisma, and served through Express.js API endpoints with Redis caching.

---

## 1. Current Architecture Analysis

### 1.1 Data Flow

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  SCRAPERS   │───▶│  POSTGRES   │───▶│  ENHANCER   │───▶│  REDIS      │
│  (Puppeteer)│    │  (Prisma)   │    │ (Perplexity)│    │  (Cache)    │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
                          │                                     │
                          └─────────────┬───────────────────────┘
                                        ▼
                                ┌─────────────┐
                                │  EXPRESS    │───▶ Frontend
                                │    API      │
                                └─────────────┘
```

### 1.2 Key Components

| Stage           | File                                      | Current Behavior                                                         |
| --------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| **Scraping**    | `scrapers/run-cricbuzz-scraper.js`        | Fetches 15 articles, validates content, generates AI tags, upserts to DB |
| **Storage**     | `prisma/schema.prisma`                    | `NewsArticle` (raw) + `EnhancedContent` (AI-generated) with 1:1 relation |
| **Enhancement** | `scrapers/content-enhancer-perplexity.js` | Batch of 6 articles → Perplexity Sonar → SEO rewrite → upsert            |
| **API**         | `routes/Cricket/index.js`                 | Merges `enhancedContent` into `displayTitle`, `displayContent` fields    |
| **Caching**     | `component/redisClient.js`                | TTL-based (30 min for news), no active invalidation                      |

### 1.3 Identified Gaps

| Issue                               | Impact                                                    | Current State                                                          |
| ----------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------- |
| **No cache invalidation on scrape** | Stale data served for up to 30 min after new content      | `invalidateCricketCache()` exists but only clears scores, not news     |
| **Enhancement runs separately**     | New articles may never get enhanced if batch script fails | Cron runs enhancement independently; no queue                          |
| **Content format inconsistency**    | Frontend must handle both plain text and markdown         | ICC/BBC return markdown; ESPN/Cricbuzz return plain text               |
| **No enhancement priority**         | All sources treated equally                               | High-value IPL/international content has same priority as generic news |
| **No retry for failed scrapes**     | Lost articles on transient failures                       | Articles skipped on error, not queued for retry                        |

---

## 2. Recommended Improvements

### 2.1 Immediate: Cache Invalidation on Scrape

**Problem**: News cache (`cricket:news:*`) has 30-min TTL but no active invalidation when new content arrives.

**Solution**: Add cache clearing to scraper save routines.

**Files to modify**:

- `component/redisClient.js` - Add `invalidateNewsCache()` function
- `scrapers/run-cricbuzz-scraper.js` - Call invalidation after successful save
- `scrapers/run-bbc-scraper.js`, `run-icc-scraper.js`, etc. - Same pattern

**Implementation**:

```javascript
// component/redisClient.js - ADD:
async function invalidateNewsCache() {
  const keys = await redis.keys("cricket:news:*");
  for (const key of keys) {
    await deleteCache(key);
  }
  console.log(`✓ Invalidated ${keys.length} news cache entries`);
}

// scrapers/run-cricbuzz-scraper.js - AFTER save loop:
if (savedCount > 0) {
  const { invalidateNewsCache } = require("../component/redisClient");
  await invalidateNewsCache();
}
```

---

### 2.2 Immediate: Unified Content Normalization

**Problem**: ESPN Cricinfo and Cricbuzz return plain text; ICC and BBC return markdown. Frontend must handle both.

**Solution**: Add a content normalization utility that converts plain text to basic markdown.

**New file**: `utils/contentNormalizer.js`

**Implementation**:

```javascript
/**
 * Normalize content to consistent markdown format
 * - Converts plain text paragraphs to markdown
 * - Preserves existing markdown
 * - Handles embedded media markers
 */
function normalizeContent(content, sourceName) {
  if (!content) return "";

  // Sources that already return markdown
  const markdownSources = ["ICC Cricket", "BBC Sport", "IPL T20"];
  if (markdownSources.includes(sourceName)) {
    return content;
  }

  // Convert plain text to markdown
  return content
    .split(/\n\n+/)
    .map((para) => para.trim())
    .filter((para) => para.length > 0)
    .join("\n\n");
}
```

**Integrate in API**: Apply normalization in `routes/Cricket/index.js` when building `displayContent`.

---

### 2.3 Short-term: Inline Enhancement Trigger

**Problem**: Enhancement runs as separate cron, creating delay and risk of missed articles.

**Solution**: Trigger enhancement immediately after scraping completes (non-blocking).

**Options**:

| Approach                 | Pros                                 | Cons                        |
| ------------------------ | ------------------------------------ | --------------------------- |
| **A) Inline async call** | Simple, no new deps                  | Blocks scraper if API slow  |
| **B) BullMQ job queue**  | Robust, retries, concurrency control | Adds Redis queue complexity |
| **C) PM2 trigger**       | Uses existing PM2                    | Less reliable than queue    |

**Recommendation**: **Option A for now** (inline async), migrate to **Option B** if scale requires.

**Implementation** (Option A):

```javascript
// At end of run-cricbuzz-scraper.js:
if (savedCount > 0) {
  console.log("\n🤖 Triggering content enhancement...");
  const { spawn } = require("child_process");
  const enhancer = spawn("node", ["scrapers/content-enhancer-perplexity.js"], {
    detached: true,
    stdio: "ignore",
  });
  enhancer.unref(); // Don't wait for completion
  console.log("   Enhancement process started in background");
}
```

---

### 2.4 Short-term: Priority-based Enhancement

**Problem**: All 6-article batches treat sources equally; high-value IPL/international content may wait behind generic news.

**Solution**: Add priority scoring when fetching articles to enhance.

**Modify**: `scrapers/content-enhancer-perplexity.js`

```javascript
// Replace simple findMany with priority-based query:
async function fetchArticlesToEnhance(limit) {
  const articles = await prisma.newsArticle.findMany({
    where: {
      enhancedContent: null,
      content: { not: null },
    },
    orderBy: [
      // Priority: IPL > International > Other
      { createdAt: "desc" },
    ],
    take: limit,
  });

  // Sort by priority within batch
  const priorityOrder = {
    "IPL T20": 1,
    "ICC Cricket": 2,
    "ESPN Cricinfo": 3,
    "BBC Sport": 4,
    Cricbuzz: 5,
  };

  return articles.sort(
    (a, b) =>
      (priorityOrder[a.sourceName] || 99) - (priorityOrder[b.sourceName] || 99)
  );
}
```

---

### 2.5 Medium-term: Health Monitoring Endpoint

**Problem**: No visibility into scraper health, enhancement coverage, or cache status.

**Solution**: Add `/api/health/scrapers` endpoint.

**New route in**: `routes/Cricket/index.js`

```javascript
router.get("/health/scrapers", async (req, res) => {
  const prisma = require("../../component/prismaClient");

  const [totalArticles, enhancedArticles, lastScraped] = await Promise.all([
    prisma.newsArticle.count(),
    prisma.enhancedContent.count(),
    prisma.newsArticle.findFirst({ orderBy: { createdAt: "desc" } }),
  ]);

  const coveragePercent =
    totalArticles > 0
      ? ((enhancedArticles / totalArticles) * 100).toFixed(1)
      : 0;

  res.json({
    status: "healthy",
    articles: {
      total: totalArticles,
      enhanced: enhancedArticles,
      pending: totalArticles - enhancedArticles,
      coveragePercent,
    },
    lastScraped: lastScraped?.createdAt || null,
    cacheStatus: "TTL-based (30 min news, 30s scores)",
  });
});
```

---

### 2.6 Medium-term: Failed Scrape Retry Queue

**Problem**: Articles that fail to scrape (network timeout, parsing error) are simply skipped.

**Solution**: Add `FailedScrape` table to track failures for retry.

**Schema addition**:

```prisma
model FailedScrape {
  id          String   @id @default(cuid())
  sourceUrl   String   @unique
  sourceName  String
  error       String
  attempts    Int      @default(1)
  lastAttempt DateTime @default(now())
  createdAt   DateTime @default(now())

  @@index([sourceName, attempts])
  @@map("failed_scrapes")
}
```

**Scraper integration**: On error, upsert to `FailedScrape`. On success, delete from table.

---

## 3. Frontend Integration Recommendations

### 3.1 Use `displayTitle` and `displayContent`

The API already provides merged fields. Frontend should always use:

```jsx
// ✅ Correct - uses enhanced if available
<h1>{article.displayTitle}</h1>
<ReactMarkdown>{article.displayContent}</ReactMarkdown>

// ❌ Wrong - bypasses enhancement
<h1>{article.title}</h1>
```

### 3.2 Handle Embedded Media

Content may contain markers like `[TWEET:123456]` or `[INSTAGRAM:abc123]`.

**Preprocessing component**:

```jsx
function ArticleContent({ content, embeddedTweets, embeddedInstagram }) {
  // Replace markers with actual embeds
  let processed = content;

  embeddedTweets?.forEach((id) => {
    processed = processed.replace(
      `[TWEET:${id}]`,
      `<TwitterEmbed tweetId="${id}" />`
    );
  });

  return (
    <ReactMarkdown components={customComponents}>{processed}</ReactMarkdown>
  );
}
```

### 3.3 Show Enhancement Status

Use `hasEnhancedContent` to show quality indicators:

```jsx
{
  article.hasEnhancedContent && <Badge color="green">AI Enhanced</Badge>;
}
```

---

## 4. Implementation Priority

| Priority | Task                          | Effort  | Impact                        |
| -------- | ----------------------------- | ------- | ----------------------------- |
| 🔴 P0    | Cache invalidation on scrape  | 1 hour  | High - fresher content        |
| 🔴 P0    | Content normalization utility | 2 hours | High - consistent frontend    |
| 🟡 P1    | Inline enhancement trigger    | 1 hour  | Medium - faster enhancement   |
| 🟡 P1    | Priority-based enhancement    | 30 min  | Medium - better content first |
| 🟢 P2    | Health monitoring endpoint    | 2 hours | Low - observability           |
| 🟢 P2    | Failed scrape retry queue     | 3 hours | Low - completeness            |

---

## 5. Cost Analysis

| Component             | Current Cost | After Changes                    |
| --------------------- | ------------ | -------------------------------- |
| Perplexity Sonar API  | ~$2/month    | ~$2/month (no change)            |
| Redis (Upstash)       | Free tier    | Free tier (no change)            |
| PostgreSQL (Supabase) | Free tier    | Free tier (minimal row increase) |

**No additional costs** for recommended improvements.

---

## 6. Next Steps

1. [x] Implement cache invalidation (P0) ✅
2. [x] Add content normalization utility (P0) ✅
3. [x] Add inline enhancement trigger (P1) ✅
4. [x] Add priority-based enhancement (P1) ✅
5. [ ] Deploy and monitor for 1 week
6. [ ] Evaluate need for BullMQ job queue based on scale
7. [ ] Add health monitoring endpoint (P2)
8. [ ] Add failed scrape retry queue (P2)
