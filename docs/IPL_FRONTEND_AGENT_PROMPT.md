# IPL API Update - Frontend Integration Prompt

You are integrating new IPL (Indian Premier League) endpoints into the cricket app frontend. The backend API has been updated with the following endpoints.

## Base URL
```
https://drop.urtechy.com/api/cricket
```

---

## New IPL Endpoints

### 1. Points Table / Standings
```
GET /ipl/points-table
GET /ipl/points-table?season=2024
```

**Example Response:**
```json
{
  "success": true,
  "season": 2025,
  "standings": [
    {
      "position": 1,
      "teamCode": "PBKS",
      "teamName": "Punjab Kings",
      "teamLogo": "https://scores.iplt20.com/ipl/teamlogos/PBKS.png",
      "matches": 14,
      "won": 9,
      "lost": 4,
      "noResult": 1,
      "points": 19,
      "netRunRate": 0.372,
      "recentForm": ["W", "W", "W", "L", "W"],
      "isQualified": true
    }
  ]
}
```

### 2. Match Schedule
```
GET /ipl/schedule
GET /ipl/schedule?status=completed
GET /ipl/schedule?status=upcoming
GET /ipl/schedule?status=live
```

**Example Response:**
```json
{
  "success": true,
  "season": 2025,
  "summary": { "total": 74, "completed": 74, "live": 0, "upcoming": 0 },
  "matches": [
    {
      "matchId": 1872,
      "matchName": "RCB vs PBKS",
      "matchDate": "2025-06-03",
      "matchTime": "19:30",
      "venue": "M Chinnaswamy Stadium",
      "status": "completed",
      "team1": { "code": "RCB", "name": "Royal Challengers Bengaluru", "logo": "..." },
      "team2": { "code": "PBKS", "name": "Punjab Kings", "logo": "..." },
      "team1Score": "177/3",
      "team2Score": "174/8",
      "result": "RCB won by 7 wickets",
      "playerOfMatch": "Krunal Pandya"
    }
  ]
}
```

### 3. Single Match
```
GET /ipl/match/:matchId
GET /ipl/match/1872
```

### 4. Live Matches
```
GET /ipl/live
```

### 5. All Teams
```
GET /ipl/teams
```

**Example Response:**
```json
{
  "success": true,
  "count": 10,
  "teams": [
    {
      "slug": "mumbai-indians",
      "id": "17",
      "code": "MI",
      "name": "Mumbai Indians",
      "logo": "https://scores.iplt20.com/ipl/teamlogos/MI.png",
      "url": "https://www.iplt20.com/teams/mumbai-indians"
    }
  ]
}
```

### 6. Team Squad / Players
```
GET /ipl/teams/:teamSlug
GET /ipl/teams/mumbai-indians
```

**Valid Team Slugs:**
- chennai-super-kings
- delhi-capitals
- gujarat-titans
- kolkata-knight-riders
- lucknow-super-giants
- mumbai-indians
- punjab-kings
- rajasthan-royals
- royal-challengers-bengaluru
- sunrisers-hyderabad

**Example Response:**
```json
{
  "success": true,
  "team": {
    "slug": "mumbai-indians",
    "code": "MI",
    "name": "Mumbai Indians",
    "logo": "https://scores.iplt20.com/ipl/teamlogos/MI.png"
  },
  "squadSize": 25,
  "squad": {
    "batters": [
      { "name": "Rohit Sharma", "role": "Batter", "id": "107", "image": "https://documents.iplt20.com/ipl/IPLHeadshot2025/6.png" }
    ],
    "allRounders": [
      { "name": "Hardik Pandya", "role": "All-Rounder", "id": "2740", "image": "..." }
    ],
    "bowlers": [
      { "name": "Jasprit Bumrah", "role": "Bowler", "id": "1124", "image": "..." }
    ]
  },
  "players": [ /* flat array of all 25 players */ ]
}
```

### 7. Available Seasons
```
GET /ipl/seasons
```

---

## UI Components to Build

1. **Points Table** - Display standings with team logos, NRR, form indicators
2. **Match Schedule** - Filterable list (live/upcoming/completed)
3. **Team Selector** - Grid of 10 team cards with logos
4. **Team Squad Page** - Players grouped by role (Batters, All-rounders, Bowlers)
5. **Player Card** - Headshot, name, role, link to profile

## Notes
- Team logos are direct CDN URLs, can be used in `<img>` tags
- Player headshots are lazy-loaded URLs from IPLT20 CDN
- All responses include `cached: true/false` to indicate cache status
- Cache TTL: 5 minutes for live data, 1 hour for static data (teams/players)
