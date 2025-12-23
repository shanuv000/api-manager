# Stats API Bug Report - For Frontend Team

**Date:** December 22, 2025  
**From:** Backend Team (api-manager)  
**To:** Frontend Team (Urtechy Sports)  
**Status:** External dependency issue - awaiting quota reset

---

## Root Cause

**RapidAPI Monthly Quota Exhausted**

The Cricbuzz RapidAPI free tier (BASIC plan) has a limit of **200 requests/month**. This quota has been exceeded.

```
Error: "You have exceeded the MONTHLY quota for Requests on your current plan, BASIC"
```

---

## Current Status

| Endpoint                | Status     | Why                                |
| ----------------------- | ---------- | ---------------------------------- |
| `/stats/rankings`       | ❌ Failing | Quota exceeded, no cache available |
| `/stats/standings`      | ❌ Failing | Quota exceeded, no cache available |
| `/stats/records`        | ❌ Failing | Quota exceeded, no cache available |
| `/stats/record-filters` | ✅ Working | **Cached** (7-day TTL still valid) |

---

## How Stats Caching Works

```
Request → Check Redis Cache
              ↓
    [Cache HIT] → Return cached data (instant)
    [Cache MISS] → Call RapidAPI → Store in Redis → Return
              ↓
    [API Error] → Try stale cache → If none, return error
```

### Cache TTL by Endpoint

| Endpoint                | Redis Cache TTL | HTTP Cache-Control |
| ----------------------- | --------------- | ------------------ |
| `/stats/rankings`       | 24 hours        | `s-maxage=86400`   |
| `/stats/standings`      | 24 hours        | `s-maxage=86400`   |
| `/stats/records`        | 48 hours        | `s-maxage=172800`  |
| `/stats/record-filters` | **7 days**      | `s-maxage=604800`  |

### Why record-filters Still Works

The `/stats/record-filters` endpoint has a **7-day cache TTL**. The last successful API call was within 7 days, so it serves cached data. Other endpoints have 24-48 hour TTL which has expired.

---

## Fallback Behavior

The API has stale-cache fallback logic:

```javascript
// On API error, try returning stale cache
if (error) {
  const staleCache = await getCache(cacheKey);
  if (staleCache) {
    return { ...staleCache, stale: true, error_note: "..." };
  }
}
```

**Current Problem:** Cache expired AND quota exceeded = no data to return.

---

## Fix Options

| Option       | Description                       | Timeline   |
| ------------ | --------------------------------- | ---------- |
| **Wait**     | Quota resets January 1, 2025      | ~9 days    |
| **Upgrade**  | RapidAPI Pro ($10/mo for 10K req) | Immediate  |
| **Fallback** | Add static placeholder data       | 30 min dev |

---

## Recommended Frontend Handling

```typescript
// In your React component
const { data, error, isLoading } = useRankings(category, format);

if (error) {
  // Show user-friendly message instead of blank screen
  return (
    <Alert type="warning">
      Rankings temporarily unavailable. Data updates daily.
    </Alert>
  );
}
```

---

## API Response When Quota Exceeded

```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An unexpected error occurred",
    "timestamp": "2025-12-22T06:51:51.607Z"
  }
}
```

**Note:** Error message is generic for security. Actual cause is quota exhaustion.

---

## Contact

For quota upgrade decisions, contact the api-manager team.
