# Backend API Recommendations for Internal Linking

> **Priority:** Medium  
> **Status:** Recommendation  
> **Created:** 2025-12-25

---

## Current API State

The external API (`api-sync.vercel.app/api/cricket/news`) provides:

| Field               | Description           | Used For                           |
| ------------------- | --------------------- | ---------------------------------- |
| `tags[]`            | Article tags          | MoreOnTopic matching               |
| `relatedArticles[]` | Source-provided links | External navigation (often broken) |
| `sourceName`        | Content source        | Source filtering                   |
| `category`          | Article category      | Category filtering                 |
| `sport`             | Sport type            | Sport filtering                    |

### Limitation

The `relatedArticles` field often contains **external URLs** to the source website, not internal links to other articles in your system.

---

## Recommended API Enhancements

### 1. Related Articles Endpoint (High Priority)

**Endpoint:**

```
GET /api/cricket/news/:slug/related?limit=5
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "slug": "india-wins-test-series",
      "title": "India Clinches Test Series",
      "thumbnailUrl": "...",
      "publishedTime": "2025-12-24T10:00:00Z",
      "matchScore": 0.85
    }
  ]
}
```

**Backend Logic:**

1. Find articles with **overlapping tags** (weighted by tag frequency)
2. Boost score for same **category/sport**
3. Prioritize **recent articles** (last 7 days)
4. Exclude the current article
5. Return top 5 by `matchScore`

---

### 2. Tag-Based Articles Endpoint (Medium Priority)

**Endpoint:**

```
GET /api/cricket/news/by-tag/:tag?limit=10
```

Faster than full-text search for tag-specific queries.

---

### 3. Precomputed Related Field (Low Effort, High Impact)

Store related slugs directly in the article document:

```json
{
  "slug": "article-abc",
  "internalRelated": ["article-def", "article-ghi", "article-jkl"]
}
```

**Update Strategy:**

- Recalculate nightly via cron job
- Use tag overlap + time proximity scoring

---

### 4. Entity Linking Database (Advanced)

Create a lookup table for cricket entities:

| Entity      | Type       | Search Slug |
| ----------- | ---------- | ----------- |
| Virat Kohli | player     | virat-kohli |
| IPL 2025    | tournament | ipl-2025    |
| India       | team       | india       |
| The Ashes   | series     | the-ashes   |

**Endpoint:**

```
GET /api/cricket/entities?q=kohli
```

**Use Case:** Auto-link player/team names in article content to related articles.

---

## Quick Wins (Frontend-Only)

If backend changes aren't immediately feasible:

### Improve `/api/news/search` Route

1. **Add tag-based filtering:**

   ```
   GET /api/news/search?tags=IPL,Cricket&limit=10
   ```

2. **Sort by relevance score** instead of just date

3. **Cache popular tag queries** for faster response (Redis/in-memory)

---

## Implementation Priority

| Enhancement               | Effort | Impact     | Priority |
| ------------------------- | ------ | ---------- | -------- |
| Related Articles Endpoint | Medium | ⭐⭐⭐⭐⭐ | P1       |
| Precomputed Related Field | Low    | ⭐⭐⭐⭐   | P1       |
| Tag-Based Endpoint        | Low    | ⭐⭐⭐     | P2       |
| Entity Linking Database   | High   | ⭐⭐⭐     | P3       |

---

## Expected Benefits

- **Reduced bounce rate:** Users stay on site exploring related content
- **Improved SEO:** More internal links = better crawlability
- **Faster page loads:** Precomputed data avoids runtime API calls
- **Better UX:** Contextual recommendations feel personalized
