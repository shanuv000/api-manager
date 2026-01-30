# Score System Architecture

## 1. System Overview

### The Score Ecosystem
The Score System is a dedicated, high-performance pipeline designed solely for the ingestion, processing, and delivery of real-time cricket data. Unlike the content management system (CMS) which handles articles, blogs, and static media, the Score System deals with ephemeral, high-velocity data that changes every ball.

### Why a Dedicated Pipeline?
- **Velocity:** Cricket scores update every few seconds. General-purpose CMS structures are too heavy for this frequency.
- **Independence:** Issues with article publishing or image resizing must never impact the ability to display live scores.
- **Scalability:** During high-profile matches, traffic spikes significantly. A decoupled score system allows for independent scaling and caching strategies.

---

## 2. Data Source Ownership

### Origin
Scores originate from external providers via:
- **Scrapers:** For extracting data from public scorecards (fallback/legacy).
- **Official APIs:** Direct JSON feeds from data partners (primary).

### Backend Ownership
The **Backend Service** (API Manager) is the single source of truth. It is responsible for:
1.  Fetching data from providers.
2.  Normalizing data into our standard schema.
3.  Validating integrity (e.g., preventing score regressions).
4.  Persisting historical data to the database.
5.  Serving read-optimized responses to the frontend.

### Frontend Restriction
**The Frontend NEVER communicates directly with external score providers.**
- **Security:** API keys and scraper logic are hidden server-side.
- **Consistency:** All users see the exact same score state, processed by the backend.
- **Resilience:** If a provider changes their format, only the backend parser needs an update, not the frontend client.

---

## 3. Score API Philosophy

1.  **Backend Authority:** The backend dictates what is displayed. The frontend does not calculate run rates or project scores; it simply renders values provided by the API.
2.  **Read-Only for Frontend:** All score-related endpoints exposed to the public/frontend are strictly `GET`.
3.  **Renderer Pattern:** The frontend acts as a "dumb" renderer. It receives visual-ready data structures designated for specific UI components (widgets, cards, full scorecards).
4.  **Consistency:** Data is normalized. A team name like "IND" vs "India" is standardized at the ingest level so the frontend doesn't need mapping logic.

---

## 4. Core Score APIs (Conceptual)

These endpoints form the backbone of the score delivery system.

### `GET /api/scores/live`
- **Purpose:** Fetches a lightweight list of all currently active matches.
- **Usage:** Populates the "Live Matches" carousel or top bar widget.
- **Frequency:** Polled frequently (e.g., every 10-30s).

### `GET /api/scores/match/:matchId`
- **Purpose:** Retrieves the full, detailed state of a specific match.
- **Data:** Includes toss, squads, full batting/bowling cards, commentary snippets, and partnership stats.
- **Usage:** Populates the detailed "Match Center" page.

### `GET /api/scores/recent`
- **Purpose:** Returns a list of recently finished matches with final results.
- **Usage:** "Results" tab or "Recent Matches" widget.
- **Characteristics:** Highly cacheable as data is immutable once the match is complete.

---

## 5. Score Data Structure

### Standardized JSON Schemas

#### Live Score Widget (Lightweight)
```json
{
  "matchId": "123456",
  "status": "Live",
  "header": "3rd ODI • IND vs AUS",
  "teamA": {
    "name": "India",
    "shortName": "IND",
    "score": "240/3",
    "overs": "42.1"
  },
  "teamB": {
    "name": "Australia",
    "shortName": "AUS",
    "score": "Yet to Bat",
    "overs": ""
  },
  "resultText": "India needs 30 runs in 47 balls",
  "isLive": true
}
```

#### Full Match Scorecard (Comprehensive)
```json
{
  "matchId": "123456",
  "info": { ... }, // Venue, Date, Series
  "liveStatus": "In Progress",
  "innings": [
    {
      "team": "India",
      "total runs": "240",
      "wickets": "3",
      "overs": "42.1",
      "batters": [
         { "name": "V. Kohli", "runs": 85, "balls": 70, "status": "batting" },
         ...
      ],
      "bowlers": [ ... ]
    }
  ],
  "commentary": [ ... ]
}
```

---

## 6. Frontend Integration Flow

1.  **Initialization:**
    - User lands on the homepage.
    - Frontend immediately requests `/api/scores/live`.

2.  **Live Rendering:**
    - The response populates the "Live Score Tape" or "Featured Match" card.
    - A polling interval (e.g., `setInterval`) is established to refresh this data every 20 seconds.

3.  **User Interaction:**
    - User clicks on a specific match card: `[India vs Australia]`.
    - Route changes to `/match/123456`.

4.  **Detail View:**
    - Frontend requests `/api/scores/match/123456`.
    - Loading skeleton is shown.
    - On success, the full scorecard is rendered.
    - A separate, perhaps slower (30s), poll is set up for this specific match detail if it is live.

---

## 7. Performance Strategy

### Caching Layers
1.  **Memory Cache (Redis/Node-Cache):** The backend stores the constructed JSON response for `GET /api/scores/live` in memory for 5-10 seconds. This protects the database/external provider from being hammered by thousands of concurrent users.
2.  **Browser Cache:** `Cache-Control` headers (e.g., `max-age=10`) utilize the user's browser or CDN to serve repeated requests during high traffic.

### Refresh Intervals
- **Live Widgets:** 15-30 seconds.
- **Detailed Scorecard:** 30-60 seconds.
- **Completed Matches:** ∞ (Long term cache).

### Throttling
- The backend implements rate limiting by IP to prevent abuse.
- Scraper/Provider fetching is decoupled from Client serving. The backend might fetch from the provider every 10 seconds, regardless of whether 1 user or 10,000 users are requesting data.

---

## 8. Failure Handling

### Scenario: Score API Fails (500 Error)
- **Frontend Action:**
    - Do not crash the page.
    - Hide the Score Widget or display a "Scores currently unavailable" placeholder.
    - Retry silently with exponential backoff (e.g., retry in 5s, then 10s, then 30s).

### Scenario: Backend Feed Delayed
- **Frontend Action:**
    - Display the data currently available in the system.
    - Optionally show a "Last updated: 2 mins ago" timestamp so the user knows the data might be stale.

### Scenario: Partial Data
- **Frontend Action:**
    - Render available fields.
    - Use safe navigation (e.g., `match?.teamA?.score || '-'`) to avoid White Screen of Death due to `undefined` errors.

---

## 9. Security & Stability

### Public Read-Only
- Score APIs are public. No authentication is required for reading scores (unless premium tiers are introduced).
- This maximizes speed and cacheability.

### Provider Abstraction
- By proxying all requests through our backend, we protect our API keys for premium data providers.
- We can switch providers (e.g., from Scraper A to API B) without deploying new frontend code.

### Stability First
- If the score service is under heavy load, it serves stale data (from cache) rather than erroring out. Old scores are better than no scores.

---

## 10. Design Principles

1.  **Decoupling:** The Score System operation is completely independent of the Blog/Article system. A database migration on the blog table should never affect the score API.
2.  **Real-Time Focus:** The architecture prioritizes low latency.
3.  **Graceful Degradation:** The frontend application is robust. If the score header fails to load, the user can still read articles and navigate the site.
4.  **Authoritative Backend:** The frontend implementation is thin. It trusts the backend's data blindly, simplifying client-side logic and reducing bugs.

---

## 11. Final Summary

This architecture ensures a **modular, scalable, and robust** cricket score system. By centralizing data ingestion and normalization in the backend, and treating the frontend as a resilient rendering layer, we achieve:
- **High Performance:** Through aggressive caching and efficient API design.
- **Maintainability:** Provider changes happen transparently to the client.
- **Reliability:** The independent nature of the pipeline ensures that content serving and score updates do not interfere with each other.

This document serves as the blueprint for all future development on the cricket scoring feature.
