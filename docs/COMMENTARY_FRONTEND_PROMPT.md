# Commentary API Documentation

## Endpoint

```
GET /api/cricket/commentary/:matchId
```

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `matchId` | Path | Required | Match ID from `/live-scores` response |
| `limit` | Query | 20 | Max commentary entries (1-100) |
| `highlights` | Query | false | Only return 4s, 6s, wickets |

## Example Request

```
GET /api/cricket/commentary/108811?limit=20
```

---

## Response Structure

```json
{
  "success": true,
  "matchId": "108811",
  "data": {
    "matchInfo": {
      "matchId": "108811",
      "state": "In Progress",
      "status": "Day 3: Australia lead by 134 runs",
      "scores": [
        { "team": "ENG", "score": 384, "wickets": 10, "overs": 97.3 },
        { "team": "AUS", "score": 518, "wickets": 7, "overs": 124 }
      ]
    },
    "currentInnings": 2,
    "activeBatsmen": [
      { "playerId": "2250", "playerName": "Steven Smith" },
      { "playerId": "8646", "playerName": "Beau Webster" }
    ],
    "overSummaries": [
      { "overNumber": 124, "summary": "2 0 0 0 0 2 (4 runs)", "teamScore": "518-7" }
    ],
    "entries": [
      {
        "type": "ball",
        "ball": 123.6,
        "textPlain": "Will Jacks to Webster, 2 runs...",
        "eventType": "over-end",
        "team": "AUS",
        "inningsId": 2,
        "timestamp": 1736181600000
      }
    ],
    "entryCount": 20,
    "totalAvailable": 50
  },
  "fromCache": true,
  "cacheSource": "redis",
  "responseTime": 45
}
```

---

## Entry Event Types

| eventType | Description | Suggested Color |
|-----------|-------------|-----------------|
| `ball` | Normal delivery | Default |
| `four` | Boundary 4 runs | Green |
| `six` | Maximum 6 runs | Blue |
| `wicket` | Dismissal | Red |
| `over-end` | End of over | Gray |
| `update` | Rain/break update | Yellow |

---

## Ball Number Format

The `ball` field uses format: `OVER.BALL`

- `123.6` = Over 123, Ball 6
- `45.3` = Over 45, Ball 3
- `null` = Update/no ball number

---

## Polling Recommendations

| Match State | Poll Interval |
|-------------|---------------|
| `In Progress` | 30 seconds |
| `Delay` | 2 minutes |
| `Preview` | 5 minutes |
| `Complete` | No polling |

---

## Getting matchId

The `matchId` comes from the `/live-scores` API response:

```json
{
  "data": [
    {
      "matchId": "108811",
      "title": "England vs Australia, 5th Test",
      "matchStatus": "live"
    }
  ]
}
```

Use this `matchId` to fetch commentary.

---

## Error Responses

**400** - Invalid matchId
```json
{ "success": false, "error": "Invalid matchId" }
```

**404** - No commentary available
```json
{ "success": false, "error": "Commentary not found" }
```

---

## Caching

- Live matches: Cached in Redis, refreshed every 60 seconds by background worker
- Response includes `cacheAgeSeconds` to show data freshness
- `fromCache: true` means served from Redis cache
- `fromCache: false` means fetched directly from source
