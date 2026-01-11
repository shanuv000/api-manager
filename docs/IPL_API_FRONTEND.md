# IPL API Endpoints - Frontend Integration Guide

**Base URL:** `https://drop.urtechy.com/api/cricket`

## New Endpoints

### 1. Get Available Seasons
```
GET /ipl/seasons
```
Returns list of IPL seasons (2011-2025) with competition IDs.

---

### 2. Points Table / Standings
```
GET /ipl/points-table
GET /ipl/points-table?season=2024
```

**Response:**
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

---

### 3. Match Schedule
```
GET /ipl/schedule
GET /ipl/schedule?status=completed
GET /ipl/schedule?status=upcoming
GET /ipl/schedule?status=live
```

**Response:**
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

---

### 4. Single Match Details
```
GET /ipl/match/:matchId
GET /ipl/match/1872
```

---

### 5. Live Matches Only
```
GET /ipl/live
```
Returns only currently live IPL matches.

---

### 6. All Teams
```
GET /ipl/teams
```

**Response:**
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

---

### 7. Team Squad / Roster
```
GET /ipl/teams/:teamSlug
GET /ipl/teams/mumbai-indians
```

**Valid Team Slugs:**
`chennai-super-kings`, `delhi-capitals`, `gujarat-titans`, `kolkata-knight-riders`, `lucknow-super-giants`, `mumbai-indians`, `punjab-kings`, `rajasthan-royals`, `royal-challengers-bengaluru`, `sunrisers-hyderabad`

**Response:**
```json
{
  "success": true,
  "team": { "slug": "mumbai-indians", "code": "MI", "name": "Mumbai Indians" },
  "squadSize": 25,
  "squad": {
    "batters": [{ "name": "Rohit Sharma", "role": "Batter", "id": "107", "image": "..." }],
    "allRounders": [{ "name": "Hardik Pandya", "role": "All-Rounder", "id": "2740" }],
    "bowlers": [{ "name": "Jasprit Bumrah", "role": "Bowler", "id": "1124" }]
  },
  "players": [ /* flat list of all players */ ]
}
```

---

### 8. Player Profile
```
GET /ipl/players/:playerSlug/:playerId
GET /ipl/players/rohit-sharma/107
GET /ipl/players/karun-nair/276
```

**Response:**
```json
{
  "success": true,
  "id": "276",
  "slug": "karun-nair",
  "name": "Karun Nair",
  "nationality": "Indian",
  "team": "Delhi Capitals",
  "role": "Batter",
  "headshot": "https://documents.iplt20.com/ipl/IPLHeadshot2025/131.png",
  "dateOfBirth": "06 December 1991",
  "iplDebut": "2013",
  "totalMatches": 84,
  "bio": "One of only two Indians to have scored a Test triple-century...",
  "profileUrl": "https://www.iplt20.com/players/karun-nair/276"
}
```

> **Note:** Get `playerSlug` and `playerId` from the team squad endpoint (`/ipl/teams/:teamSlug`).

---

## Cache TTLs
- Current season: 5 minutes
- Historical seasons: 1 hour
- Live endpoint: 1 minute

## Notes
- All responses include `cached: true/false`
- Historical points tables may not be available (IPLT20 only exposes current season)
- Team logos are direct URLs to IPLT20 CDN
