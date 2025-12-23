# Bug Report: Stats Page API Fetching Failure

**Report Date:** December 22, 2025  
**Severity:** High  
**Status:** External API Issue  
**Affected Route:** `/stats`

---

## Summary

The `/stats` page fails to fetch data for ICC Rankings, WTC Standings, and Cricket Records. Root cause is **server-side errors (HTTP 500)** from the external API `api-sync.vercel.app`.

---

## Affected Components

| Component            | Hook Used            | API Endpoint            | Status     |
| -------------------- | -------------------- | ----------------------- | ---------- |
| `RankingsCard.tsx`   | `useRankings()`      | `/stats/rankings`       | ❌ Failing |
| `StandingsTable.tsx` | `useStandings()`     | `/stats/standings`      | ❌ Failing |
| `RecordsTable.tsx`   | `useRecords()`       | `/stats/records`        | ❌ Failing |
| `RecordsTable.tsx`   | `useRecordFilters()` | `/stats/record-filters` | ✅ Working |

---

## API Test Results

**Tested:** December 22, 2025 04:14 UTC

### Working Endpoints ✅

```bash
# Live Scores - HTTP 200
curl "https://api-sync.vercel.app/api/cricket/live-scores"

# News - HTTP 200
curl "https://api-sync.vercel.app/api/cricket/news"

# Record Filters - HTTP 200
curl "https://api-sync.vercel.app/api/cricket/stats/record-filters"
```

### Failing Endpoints ❌

```bash
# Rankings - HTTP 500
curl "https://api-sync.vercel.app/api/cricket/stats/rankings?category=batsmen&formatType=test"
# Returns: {"success":false,"error":{"code":"INTERNAL_ERROR","message":"An unexpected error occurred"}}

# Standings - HTTP 500
curl "https://api-sync.vercel.app/api/cricket/stats/standings?matchType=1"
# Returns: {"success":false,"error":{"code":"INTERNAL_ERROR","message":"An unexpected error occurred"}}

# Records - HTTP 500
curl "https://api-sync.vercel.app/api/cricket/stats/records?statsType=mostRuns&matchType=1"
# Returns: {"success":false,"error":{"code":"INTERNAL_ERROR","message":"An unexpected error occurred"}}
```

---

## Root Cause

```
User → /stats page → Stats Components → SWR Hooks → api-sync.vercel.app → HTTP 500 ❌
```

1. **Sportspulse codebase is correct** - Hooks and components are properly implemented
2. **External API is the blocker** - `api-sync.vercel.app` backend returning 500 errors
3. **Likely upstream failure** - API fails when fetching from Cricbuzz source

---

## Files Involved

| File           | Path                                       |
| -------------- | ------------------------------------------ |
| API Config     | `src/lib/stats-api.ts`                     |
| Client Hooks   | `src/hooks/useStatsAPI.ts`                 |
| Page Component | `src/app/(main)/stats/StatsPageClient.tsx` |
| Rankings       | `src/components/stats/RankingsCard.tsx`    |
| Standings      | `src/components/stats/StandingsTable.tsx`  |
| Records        | `src/components/stats/RecordsTable.tsx`    |

---

## Recommended Actions

### Immediate

- [ ] Check `api-sync.vercel.app` deployment logs
- [ ] Verify Cricbuzz source accessibility
- [ ] Check for rate limiting issues

### Short-term

- [ ] Add cached fallback data
- [ ] Improve error messages for users
- [ ] Add retry logic with exponential backoff

### Long-term

- [ ] Implement Redis caching for successful responses
- [ ] Add health check monitoring
- [ ] Set up Discord alerts for API failures

---

## Verification Commands

Run these to check if API is fixed:

```bash
curl -s "https://api-sync.vercel.app/api/cricket/stats/rankings?category=batsmen&formatType=test" | jq '.success'
curl -s "https://api-sync.vercel.app/api/cricket/stats/standings?matchType=1" | jq '.success'
curl -s "https://api-sync.vercel.app/api/cricket/stats/records?statsType=mostRuns" | jq '.success'
```

All should return `true` when fixed.
