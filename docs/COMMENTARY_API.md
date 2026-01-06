# Commentary API Integration Guide

> **Version:** 1.0  
> **Last Updated:** January 6, 2026  
> **Endpoint Status:** ✅ Production Ready

---

## Quick Start

```javascript
// Fetch commentary for a match
const response = await fetch('/api/cricket/commentary/108811?limit=20');
const { success, data } = await response.json();

// Access commentary entries
data.entries.forEach(entry => {
  console.log(`[${entry.ball}] ${entry.textPlain}`);
});
```

---

## API Endpoint

### Base URL
```
Production: https://api-manager.vercel.app/api/cricket
```

### GET /commentary/:matchId

Fetch ball-by-ball commentary for a cricket match.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `matchId` | Path | ✅ Yes | - | Numeric match ID from live-scores API |
| `limit` | Query | No | 20 | Maximum entries to return (1-100) |
| `highlights` | Query | No | false | If "true", only return fours, sixes, wickets |

### Example Requests

```bash
# Get latest 20 commentary entries
GET /api/cricket/commentary/108811

# Get latest 10 entries
GET /api/cricket/commentary/108811?limit=10

# Get only highlights (4s, 6s, wickets)
GET /api/cricket/commentary/108811?highlights=true
```

---

## Response Format

### Success Response (200)

```json
{
  "success": true,
  "matchId": "108811",
  "data": {
    "matchId": "108811",
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
      { "overNumber": 124, "summary": "2 0 0 0 0 2  (4 runs)", "teamScore": "518-7" },
      { "overNumber": 123, "summary": "0 0 0 3 0 0  (3 runs)", "teamScore": "514-7" }
    ],
    "entries": [
      {
        "type": "ball",
        "ball": 123.6,
        "text": "Will Jacks to Webster, **2 runs**...",
        "textPlain": "Will Jacks to Webster, 2 runs...",
        "eventType": "over-end",
        "team": "AUS",
        "inningsId": 2,
        "timestamp": 1736181600000,
        "events": ["over-break"]
      }
    ],
    "entryCount": 20,
    "totalAvailable": 50,
    "timestamp": 1736181912921
  },
  "fromCache": true,
  "cacheSource": "redis",
  "cacheAgeSeconds": 15,
  "responseTime": 45
}
```

### Error Responses

**400 Bad Request** - Invalid matchId
```json
{
  "success": false,
  "error": "Invalid matchId",
  "message": "matchId must be a numeric string",
  "responseTime": 2
}
```

**404 Not Found** - No commentary available
```json
{
  "success": false,
  "error": "Commentary not found",
  "message": "No commentary available for matchId: 999999",
  "responseTime": 450
}
```

---

## Data Types

### CommentaryEntry

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"ball"` \| `"update"` | Ball commentary or match update |
| `ball` | `number \| null` | Ball number (e.g., 123.6 = Over 123, Ball 6) |
| `text` | `string` | Commentary with markdown formatting |
| `textPlain` | `string` | Plain text (no formatting) |
| `eventType` | `string` | Event classification (see below) |
| `team` | `string` | Batting team abbreviation |
| `inningsId` | `number \| null` | Innings number (1, 2, 3, 4) |
| `timestamp` | `number` | Unix timestamp (ms) |
| `events` | `string[]` | Raw event tags |

### Event Types

| eventType | Description | Display Suggestion |
|-----------|-------------|-------------------|
| `ball` | Normal delivery | Default style |
| `four` | Boundary (4 runs) | Green highlight 🟢 |
| `six` | Maximum (6 runs) | Blue highlight 🔵 |
| `wicket` | Dismissal | Red highlight 🔴 |
| `over-end` | End of over | Gray/separator |
| `update` | Match update (rain, break, etc.) | Info style ℹ️ |

---

## Frontend Implementation

### TypeScript Types

```typescript
interface CommentaryEntry {
  type: 'ball' | 'update';
  ball: number | null;
  text: string;
  textPlain: string;
  eventType: 'ball' | 'four' | 'six' | 'wicket' | 'over-end' | 'update';
  team: string;
  inningsId: number | null;
  timestamp: number;
  events: string[];
}

interface MatchScore {
  team: string;
  score: number;
  wickets: number;
  overs: number;
}

interface CommentaryData {
  matchId: string;
  matchInfo: {
    matchId: string;
    state: string;
    status: string;
    scores?: MatchScore[];
  };
  currentInnings: number | null;
  activeBatsmen: { playerId: string; playerName: string }[];
  overSummaries: { overNumber: number; summary: string; teamScore: string }[];
  entries: CommentaryEntry[];
  entryCount: number;
  totalAvailable: number;
  timestamp: number;
}

interface CommentaryResponse {
  success: boolean;
  matchId: string;
  data: CommentaryData;
  fromCache: boolean;
  cacheSource: string;
  cacheAgeSeconds?: number;
  responseTime: number;
}
```

### React Hook

```typescript
import { useState, useEffect, useCallback } from 'react';

interface UseCommentaryOptions {
  matchId: string;
  limit?: number;
  pollInterval?: number; // ms, 0 to disable
  enabled?: boolean;
}

export function useCommentary({
  matchId,
  limit = 20,
  pollInterval = 30000,
  enabled = true,
}: UseCommentaryOptions) {
  const [data, setData] = useState<CommentaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCommentary = useCallback(async () => {
    if (!matchId || !enabled) return;

    try {
      const response = await fetch(
        `/api/cricket/commentary/${matchId}?limit=${limit}`
      );
      const json = await response.json();

      if (json.success) {
        setData(json.data);
        setError(null);
      } else {
        setError(json.error || 'Failed to fetch');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [matchId, limit, enabled]);

  // Initial fetch
  useEffect(() => {
    fetchCommentary();
  }, [fetchCommentary]);

  // Polling
  useEffect(() => {
    if (!pollInterval || !enabled) return;
    const interval = setInterval(fetchCommentary, pollInterval);
    return () => clearInterval(interval);
  }, [pollInterval, fetchCommentary, enabled]);

  return { data, loading, error, refetch: fetchCommentary };
}
```

### Usage Example

```tsx
function LiveCommentary({ matchId, isLive }: { matchId: string; isLive: boolean }) {
  const { data, loading, error } = useCommentary({
    matchId,
    limit: 20,
    pollInterval: isLive ? 30000 : 0, // Only poll for live matches
  });

  if (loading) return <Skeleton />;
  if (error) return <Error message={error} />;
  if (!data) return null;

  return (
    <div className="commentary">
      {/* Match Status */}
      <div className="status">
        <span className="badge">{data.matchInfo.state}</span>
        <span>{data.matchInfo.status}</span>
      </div>

      {/* Commentary Feed */}
      {data.entries.map((entry, i) => (
        <CommentaryItem key={`${entry.ball}-${i}`} entry={entry} />
      ))}
    </div>
  );
}
```

---

## Polling Strategy

| Match State | Poll Interval | Reason |
|-------------|---------------|--------|
| `In Progress` | 30 seconds | Active play |
| `Delay` | 2 minutes | Rain/break updates |
| `Preview` | 5 minutes | Pre-match info |
| `Complete` | No polling | Match finished |

```typescript
const getPollInterval = (state: string): number => {
  switch (state) {
    case 'In Progress': return 30000;
    case 'Delay': return 120000;
    case 'Preview': return 300000;
    default: return 0;
  }
};
```

---

## Styling Recommendations

### Event-Based Colors

```css
.entry { padding: 12px; border-left: 3px solid #e5e7eb; }
.entry-four { background: #dcfce7; border-color: #16a34a; }
.entry-six { background: #dbeafe; border-color: #2563eb; }
.entry-wicket { background: #fee2e2; border-color: #dc2626; }
.entry-over-end { background: #f3f4f6; font-weight: 600; }
.entry-update { background: #fef3c7; border-color: #d97706; }
```

### Event Icons

```typescript
const getEventIcon = (eventType: string): string => {
  switch (eventType) {
    case 'wicket': return '🔴';
    case 'six': return '6️⃣';
    case 'four': return '4️⃣';
    case 'over-end': return '📊';
    case 'update': return '📢';
    default: return '⚪';
  }
};
```

### Ball Number Formatting

```typescript
const formatBall = (ball: number | null): string => {
  if (!ball) return '';
  const over = Math.floor(ball);
  const ballInOver = Math.round((ball % 1) * 10);
  return `${over}.${ballInOver}`;
};

// Example: 123.6 → "123.6" (Over 123, Ball 6)
```

---

## Caching Behavior

| Source | Cache Duration | Description |
|--------|---------------|-------------|
| `redis` | ~60s | Background worker caches for live matches |
| `live-fetch` | Real-time | Direct fetch when no cache |

The background worker (`live-score-worker`) automatically fetches commentary every 60 seconds for **live matches only** and caches it in Redis.

---

## Integration Checklist

- [ ] Fetch commentary using matchId from `/live-scores` response
- [ ] Handle loading and error states
- [ ] Implement polling for live matches only
- [ ] Style entries based on eventType
- [ ] Format ball numbers (over.ball)
- [ ] Display active batsmen
- [ ] Show over summaries between overs
- [ ] Handle `update` type entries (rain delays, breaks)

---

## Support

For issues or questions, contact the backend team or check the API documentation at `/api/cricket`.
