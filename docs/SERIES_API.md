# Cricket Series API Documentation

> Base URL: `https://drop.urtechy.com/api/cricket`

This document describes the Series endpoints for fetching cricket tournament data including series listings, current tournaments, matches, and points tables.

---

## Endpoints Overview

| Endpoint | Method | Description | Cache TTL |
|----------|--------|-------------|-----------|
| `/series` | GET | List all series by category | 1 hour |
| `/series/current` | GET | Currently running series | 30 min |
| `/series/:seriesId` | GET | Matches for a specific series | 5 min |
| `/series/:seriesId/points-table` | GET | Points table for a series | 10 min |

---

## 1. GET /series

Fetches cricket series grouped by month.

### Query Parameters

| Parameter | Type | Required | Default | Options |
|-----------|------|----------|---------|---------|
| `category` | string | No | `all` | `all`, `international`, `domestic`, `league`, `women` |

### Request

```bash
GET https://drop.urtechy.com/api/cricket/series?category=international
```

### Response

```json
{
  "success": true,
  "count": 15,
  "months": 7,
  "category": "international",
  "data": [
    {
      "month": "January 2026",
      "series": [
        {
          "id": 10102,
          "name": "New Zealand tour of India, 2026",
          "slug": "new-zealand-tour-of-india-2026",
          "startDate": "2026-01-11T00:00:00.000Z",
          "endDate": "2026-01-31T00:00:00.000Z",
          "startTimestamp": 1768089600000,
          "endTimestamp": 1769817600000,
          "status": "live",
          "url": "https://www.cricbuzz.com/cricket-series/10102/...",
          "matchesUrl": "/api/cricket/series/10102",
          "pointsTableUrl": "/api/cricket/series/10102/points-table"
        }
      ]
    }
  ],
  "cached": false,
  "timestamp": "2026-01-14T21:00:00.000Z"
}
```

### Series Object Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | number | Unique series ID (use for points-table endpoint) |
| `name` | string | Full series name |
| `slug` | string | URL-friendly slug |
| `startDate` | string | ISO 8601 start date |
| `endDate` | string | ISO 8601 end date |
| `status` | string | `"upcoming"`, `"live"`, or `"completed"` |
| `pointsTableUrl` | string | Relative URL to points table endpoint |

---

## 2. GET /series/current

Fetches only currently running (live) series.

### Request

```bash
GET https://drop.urtechy.com/api/cricket/series/current
```

### Response

```json
{
  "success": true,
  "count": 18,
  "data": [
    {
      "id": 10394,
      "name": "SA20, 2025-26",
      "slug": "sa20-2025-26",
      "startDate": "2026-01-09T00:00:00.000Z",
      "endDate": "2026-02-08T00:00:00.000Z",
      "status": "live",
      "pointsTableUrl": "/api/cricket/series/10394/points-table"
    }
  ],
  "cached": true,
  "timestamp": "2026-01-14T21:00:00.000Z"
}
```

---

## 3. GET /series/:seriesId

Fetches matches for a specific series.

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `seriesId` | number | Yes | Series ID from `/series` or `/series/current` |

### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `light` | string | No | `false` | Set to `"true"` for minimal match data |

### Request

```bash
GET https://drop.urtechy.com/api/cricket/series/10394
GET https://drop.urtechy.com/api/cricket/series/10394?light=true
```

### Response

```json
{
  "success": true,
  "seriesId": 10394,
  "seriesName": "SA20, 2025-26",
  "matchCount": 34,
  "count": 5,
  "data": {
    "live": [],
    "upcoming": [
      {
        "matchId": "126570",
        "title": "Pretoria Capitals vs Paarl Royals, 25th Match",
        "status": "upcoming",
        "teams": ["Pretoria Capitals", "Paarl Royals"],
        "venue": "Centurion",
        "time": "Jan 15, 2:30 PM"
      }
    ],
    "completed": []
  },
  "matches": [
    {
      "matchId": "126570",
      "title": "PC vs PR, 25th Match",
      "matchLink": "https://www.cricbuzz.com/live-cricket-scores/126570/...",
      "scorecardUrl": "/api/cricket/scorecard/126570"
    }
  ],
  "pointsTableUrl": "/api/cricket/series/10394/points-table",
  "cached": false,
  "timestamp": "2026-01-15T04:00:00.000Z"
}
```

### Response Notes

- **`data.live/upcoming/completed`**: Matches from cached homepage data, filtered by series
- **`matches`**: Fallback list from series page (used when cached data doesn't have matches)
- The endpoint first checks cached live/recent/upcoming matches, then falls back to scraping the series page

---

## 4. GET /series/:seriesId/points-table

Fetches standings/points table for a tournament.

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `seriesId` | number | Yes | Series ID from `/series` endpoint |

### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `light` | string | No | `false` | Set to `"true"` for lightweight response (removes recentMatches) |

### Request

```bash
# Full response (~14KB)
GET https://drop.urtechy.com/api/cricket/series/10394/points-table

# Lightweight response (~1.5KB) - RECOMMENDED FOR FRONTEND
GET https://drop.urtechy.com/api/cricket/series/10394/points-table?light=true
```

### Response (light=true)

```json
{
  "success": true,
  "seriesId": 10394,
  "seriesName": "SA20, 2025-26",
  "matchType": "T20",
  "groups": [
    {
      "groupName": "Teams",
      "qualifyingTeams": 0,
      "teams": [
        {
          "teamId": 1256,
          "teamName": "SEC",
          "teamFullName": "Sunrisers Eastern Cape",
          "matchesPlayed": 8,
          "wins": 4,
          "losses": 2,
          "ties": 0,
          "noResult": 2,
          "draws": 0,
          "netRunRate": 2.398,
          "points": 24,
          "form": ["A", "W", "A", "L", "W"],
          "qualifyStatus": "Q"
        }
      ]
    }
  ],
  "cached": false,
  "timestamp": "2026-01-14T21:00:00.000Z"
}
```

### Team Object Fields

| Field | Type | Description |
|-------|------|-------------|
| `teamId` | number | Unique team ID |
| `teamName` | string | Short team name (3-4 chars) |
| `teamFullName` | string | Full team name |
| `matchesPlayed` | number | Total matches played |
| `wins` | number | Matches won |
| `losses` | number | Matches lost |
| `ties` | number | Matches tied |
| `noResult` | number | No result matches |
| `draws` | number | Matches drawn (Test only) |
| `netRunRate` | number | Net run rate (can be negative) |
| `points` | number | Total points |
| `form` | array | Last 5 results: `"W"`, `"L"`, `"A"` (abandoned), `"N"` (no result) |
| `qualifyStatus` | string | `"Q"` if qualified, empty otherwise |

### Full Response (light=false)

Includes `recentMatches` array for each team with match history:

```json
{
  "recentMatches": [
    {
      "matchId": 113715,
      "matchName": "49th Match",
      "opponent": "Namibia",
      "opponentShortName": "NAM",
      "opponentId": 161,
      "startTime": "2025-02-08T10:00:00.000Z",
      "result": "Won by 114 runs",
      "isWinner": true
    }
  ]
}
```

---

## Error Responses

All endpoints return consistent error format:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Series ID must be a valid number",
    "timestamp": "2026-01-14T21:00:00.000Z"
  }
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `VALIDATION_ERROR` | Invalid parameters |
| `NOT_FOUND` | Series not found |
| `SCRAPING_ERROR` | Failed to fetch from Cricbuzz |
| `TIMEOUT_ERROR` | Request timeout |

---

## Popular Series IDs

| Series | ID | Has Points Table |
|--------|-----|-----------------|
| SA20 2025-26 | 10394 | ✅ |
| BBL 2024-25 | 8535 | ✅ |
| U19 World Cup 2026 | 11209 | ✅ |
| CWC League Two | 7572 | ✅ |
| MLC 2025 | 9614 | ✅ |

---

## Frontend Usage Examples

### React/Next.js

```typescript
// Fetch current series
const fetchCurrentSeries = async () => {
  const res = await fetch('https://drop.urtechy.com/api/cricket/series/current');
  const data = await res.json();
  return data.success ? data.data : [];
};

// Fetch points table (lightweight)
const fetchPointsTable = async (seriesId: number) => {
  const res = await fetch(
    `https://drop.urtechy.com/api/cricket/series/${seriesId}/points-table?light=true`
  );
  const data = await res.json();
  return data.success ? data : null;
};
```

### Display Points Table

```tsx
{data.groups.map(group => (
  <div key={group.groupName}>
    <h3>{group.groupName}</h3>
    <table>
      <thead>
        <tr>
          <th>Team</th>
          <th>M</th>
          <th>W</th>
          <th>L</th>
          <th>Pts</th>
          <th>NRR</th>
        </tr>
      </thead>
      <tbody>
        {group.teams.map(team => (
          <tr key={team.teamId}>
            <td>{team.teamFullName}</td>
            <td>{team.matchesPlayed}</td>
            <td>{team.wins}</td>
            <td>{team.losses}</td>
            <td>{team.points}</td>
            <td>{team.netRunRate > 0 ? '+' : ''}{team.netRunRate.toFixed(3)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
))}
```

---

## Notes

1. **Always use `?light=true`** for points-table in frontend to reduce payload by 91%
2. **Check `cached` field** - if `true`, data may be up to TTL minutes old
3. **Points table availability** - Not all series have points tables (bilateral tours don't)
4. **Form array** - Most recent result is last in array
