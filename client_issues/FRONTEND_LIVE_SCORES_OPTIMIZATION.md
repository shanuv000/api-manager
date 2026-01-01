# Frontend Integration: Live Scores API Optimization

## Context

Our backend API for live cricket scores has been optimized to reduce payload sizes. The `/live-scores` endpoint now returns **LITE data by default** (without embedded scorecards), and scorecards must be fetched on-demand via a new endpoint.

This change reduces the default payload from ~100-200 KB to ~15-20 KB, significantly improving mobile performance and reducing data usage.

---

## API Changes Summary

### Before (Old Behavior)

```
GET /api/cricket/live-scores
```

- Returned full match data WITH embedded scorecards
- Each match object contained a `scorecard` array with batting/bowling details
- Payload size: ~100-200 KB for 10 matches

### After (New Behavior)

#### 1. Default Endpoint (LITE - Recommended)

```
GET /api/cricket/live-scores
```

- Returns match data WITHOUT embedded scorecards
- Each match now includes:
  - `matchId` - Unique identifier for the match
  - `hasScorecard` - Boolean indicating if scorecard is available
  - `scorecardUrl` - URL path to fetch scorecard on-demand
- Payload size: ~15-20 KB for 10 matches

**Example Response:**

```json
{
  "success": true,
  "count": 4,
  "total": 4,
  "data": [
    {
      "matchId": "123237",
      "title": "India vs Australia, 3rd Test",
      "matchLink": "https://www.cricbuzz.com/...",
      "teams": ["India", "Australia"],
      "teamAbbr": ["IND", "AUS"],
      "scores": ["349/8", "205"],
      "liveScorebat": "349/8",
      "liveScoreball": "205",
      "liveCommentary": "Day 4: Stumps - India need 228 runs",
      "matchStatus": "live",
      "time": "LIVE",
      "links": {
        "Live Score": "https://...",
        "Scorecard": "https://...",
        "Full Commentary": "https://..."
      },
      "hasScorecard": true,
      "scorecardUrl": "/api/cricket/scorecard/123237"
      // NOTE: No "scorecard" field - must fetch separately
    }
  ],
  "cacheSource": "redis-lite",
  "hint": "Use ?full=true for embedded scorecards, or fetch /scorecard/:matchId individually"
}
```

#### 2. Full Endpoint (Backward Compatible)

```
GET /api/cricket/live-scores?full=true
```

- Returns full data WITH embedded scorecards (old behavior)
- Use only if you need all scorecards upfront
- Payload size: ~100-200 KB

#### 3. Individual Scorecard Endpoint (NEW)

```
GET /api/cricket/scorecard/:matchId
```

- Fetch scorecard for a single match on-demand
- Payload size: ~5-10 KB per scorecard

**Example Response:**

```json
{
  "success": true,
  "matchId": "123237",
  "data": {
    "matchId": "123237",
    "title": "India vs Australia, 3rd Test",
    "teams": ["India", "Australia"],
    "innings": [
      {
        "inningsId": 1,
        "inningsHeader": "AUS 349-8 (50 Ov)",
        "teamName": "AUS",
        "batting": [
          {
            "batter": "Smith",
            "dismissal": "c Kohli b Bumrah",
            "runs": "95",
            "balls": "120",
            "fours": "8",
            "sixes": "2",
            "sr": "79.16",
            "isBatting": false
          }
        ],
        "bowling": [
          {
            "bowler": "Bumrah",
            "overs": "10",
            "maidens": "2",
            "runs": "35",
            "wickets": "3",
            "nb": "0",
            "wd": "1",
            "eco": "3.50",
            "isBowling": true
          }
        ]
      }
    ],
    "timestamp": 1704067218000
  },
  "fromCache": true,
  "cacheSource": "redis",
  "cacheAgeSeconds": 25,
  "responseTime": 20
}
```

---

## Required Frontend Changes

### 1. Match List Component (Home/Live Scores Page)

**Current Implementation (to update):**

```javascript
// OLD: Fetching and using embedded scorecards
const { data: matches } = await fetch("/api/cricket/live-scores").then((r) =>
  r.json()
);

// OLD: Accessing scorecard directly
const firstInnings = matches[0].scorecard?.[0];
```

**New Implementation:**

```javascript
// NEW: Fetch lite data (no scorecards embedded)
const { data: matches } = await fetch("/api/cricket/live-scores").then((r) =>
  r.json()
);

// Matches no longer have .scorecard
// Instead they have:
// - match.matchId
// - match.hasScorecard (boolean)
// - match.scorecardUrl (string path)
```

### 2. Match Detail Component (Individual Match View)

When user clicks on a match to see full scorecard:

```javascript
// NEW: Fetch scorecard on-demand when user navigates to match detail
async function loadMatchScorecard(matchId) {
  const response = await fetch(`/api/cricket/scorecard/${matchId}`);
  const { data, success } = await response.json();

  if (!success) {
    // Handle error - scorecard not available
    return null;
  }

  return data.innings; // Array of innings with batting/bowling
}

// Usage in component
function MatchDetail({ matchId }) {
  const [scorecard, setScorecard] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMatchScorecard(matchId)
      .then(setScorecard)
      .finally(() => setLoading(false));
  }, [matchId]);

  if (loading) return <LoadingSpinner />;
  if (!scorecard) return <ScorecardUnavailable />;

  return <ScorecardView innings={scorecard} />;
}
```

### 3. React Query / SWR Implementation (Recommended)

```javascript
// hooks/useLiveScores.js
import useSWR from "swr";

const fetcher = (url) => fetch(url).then((r) => r.json());

// Match list hook - refreshes every 10 seconds
export function useLiveScores() {
  return useSWR("/api/cricket/live-scores", fetcher, {
    refreshInterval: 10000, // 10 seconds for live updates
  });
}

// Individual scorecard hook - refreshes every 30 seconds
export function useMatchScorecard(matchId) {
  return useSWR(matchId ? `/api/cricket/scorecard/${matchId}` : null, fetcher, {
    refreshInterval: 30000, // 30 seconds (scorecard changes less frequently)
  });
}
```

```jsx
// components/MatchList.jsx
function MatchList() {
  const { data, error, isLoading } = useLiveScores();

  if (isLoading) return <LoadingSkeleton />;
  if (error) return <ErrorMessage />;

  return (
    <div className="match-list">
      {data.data.map((match) => (
        <MatchCard
          key={match.matchId}
          match={match}
          onClick={() => navigate(`/match/${match.matchId}`)}
        />
      ))}
    </div>
  );
}

// components/MatchCard.jsx - No changes needed
// Just don't access match.scorecard anymore
function MatchCard({ match, onClick }) {
  return (
    <div onClick={onClick}>
      <h3>{match.title}</h3>
      <p>{match.teams.join(" vs ")}</p>
      <p>{match.liveCommentary}</p>
      {match.hasScorecard && <Badge>Scorecard Available</Badge>}
    </div>
  );
}

// components/MatchDetail.jsx
function MatchDetail({ matchId }) {
  const { data: scorecard, error, isLoading } = useMatchScorecard(matchId);

  if (isLoading) return <ScorecardSkeleton />;
  if (error || !scorecard?.success) return <ScorecardUnavailable />;

  return <ScorecardView innings={scorecard.data.innings} />;
}
```

---

## Migration Checklist

- [ ] **Remove all direct accesses to `match.scorecard`** in list views
- [ ] **Add scorecard fetching** when navigating to match detail
- [ ] **Update TypeScript types** (if applicable):

  ```typescript
  interface Match {
    matchId: string;
    hasScorecard: boolean;
    scorecardUrl: string;
    // Remove: scorecard?: Innings[];
  }

  interface ScorecardResponse {
    success: boolean;
    matchId: string;
    data: {
      matchId: string;
      title: string;
      teams: string[];
      innings: Innings[];
      timestamp: number;
    };
  }
  ```

- [ ] **Handle loading states** for on-demand scorecard fetching
- [ ] **Handle 404 errors** when scorecard is not available
- [ ] **Test both paths**:
  - User views match list (should be fast now)
  - User clicks match → scorecard loads on-demand
- [ ] **Optional**: If you absolutely need old behavior, use `?full=true`

---

## Error Handling

### Scorecard Not Found (404)

```json
{
  "success": false,
  "error": "Scorecard not found",
  "message": "No scorecard available for matchId: 999999",
  "responseTime": 10
}
```

### Invalid Match ID (400)

```json
{
  "success": false,
  "error": "Invalid matchId",
  "message": "matchId must be a numeric string",
  "responseTime": 0
}
```

---

## Performance Benefits

| Scenario                   | Before     | After          |
| -------------------------- | ---------- | -------------- |
| List view load             | 100-200 KB | **15-20 KB**   |
| Match detail load          | 100-200 KB | **5-10 KB**    |
| Refresh every 10s (1 hour) | ~36-72 MB  | **~5-10 MB**   |
| Time to first paint        | ~500-800ms | **~100-200ms** |

---

## Questions?

The API is backward compatible - if you need the old behavior temporarily, use `?full=true`. But the recommended approach is to:

1. Use default `/live-scores` for list views
2. Fetch `/scorecard/:matchId` on-demand when user views a specific match

This provides the best user experience with faster loading and reduced data usage.
