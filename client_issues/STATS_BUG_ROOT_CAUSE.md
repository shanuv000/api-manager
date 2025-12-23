# Stats API Bug - Root Cause Analysis

**Date:** December 22, 2025  
**Status:** ✅ ROOT CAUSE IDENTIFIED

---

## 🔴 Root Cause

**RapidAPI Monthly Quota Exceeded**

```json
{
  "message": "You have exceeded the MONTHLY quota for Requests on your current plan, BASIC.
              Upgrade your plan at https://rapidapi.com/cricketapilive/api/cricbuzz-cricket"
}
```

---

## Evidence

Direct RapidAPI calls with valid API key return quota exceeded error:

```bash
# All three failing endpoints return same error:
curl "https://cricbuzz-cricket.p.rapidapi.com/stats/v1/rankings/batsmen?formatType=test"
# → {"message":"You have exceeded the MONTHLY quota..."}

curl "https://cricbuzz-cricket.p.rapidapi.com/stats/v1/iccstanding/team/matchtype/1"
# → {"message":"You have exceeded the MONTHLY quota..."}

curl "https://cricbuzz-cricket.p.rapidapi.com/stats/v1/topstats"
# → {"message":"You have exceeded the MONTHLY quota..."}
```

---

## Why record-filters Works But Others Don't?

The `record-filters` endpoint works on api-sync.vercel.app because:

- It's returning **cached data** from Redis/Vercel cache
- The cache hasn't expired yet (cached for 7 days per code)

The rankings/standings fail because:

- Cache has expired
- Fresh RapidAPI call fails due to quota

---

## Fix Options

### Option 1: Wait for Quota Reset (Free)

- RapidAPI BASIC plan: 200 requests/month
- Quota resets on **January 1, 2025**
- ⏰ ~9 days remaining

### Option 2: Upgrade RapidAPI Plan (Paid)

| Plan  | Requests/Month | Cost    |
| ----- | -------------- | ------- |
| BASIC | 200            | $0      |
| PRO   | 10,000         | ~$10/mo |
| ULTRA | 50,000         | ~$50/mo |

### Option 3: Add Static Fallback Data (Recommended)

Add hardcoded fallback rankings data that displays when API fails:

```javascript
const FALLBACK_RANKINGS = {
  batsmen: { test: [...], odi: [...], t20: [...] },
  bowlers: { test: [...], odi: [...], t20: [...] }
};
```

---

## Recommended Actions

| Priority      | Action                                    | Effort |
| ------------- | ----------------------------------------- | ------ |
| 🔴 Immediate  | Add Redis cache TTL extension (7→30 days) | 5 min  |
| 🟡 Short-term | Add static fallback data                  | 30 min |
| 🟢 Long-term  | Consider upgrading RapidAPI plan          | -      |

---

## Not a Code Bug

The api-manager code is **working correctly**. It properly:

1. Catches RapidAPI errors
2. Attempts cache fallback
3. Returns error response when quota exceeded

The issue is **billing/quota**, not code.
