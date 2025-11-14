# Cricket API - Cricbuzz Scraper

## Overview

This API provides real-time cricket match information scraped from Cricbuzz.com. It supports recent matches, live scores, and upcoming matches.

## Base URL

```
http://localhost:5003/api/cricket
```

## Endpoints

### 1. Recent Scores

Get information about recently completed matches.

**Endpoint:** `GET /api/cricket/recent-scores`

**Response:**

```json
{
  "success": true,
  "count": 94,
  "data": [
    {
      "title": "Ireland vs Bangladesh, 1st Test",
      "matchLink": "https://www.cricbuzz.com/live-cricket-scores/...",
      "matchDetails": "Ireland vs Bangladesh, 1st Test",
      "status": "N/A",
      "location": "1st Test • Sylhet, Sylhet International Cricket Stadium",
      "playingTeamBat": "Ireland",
      "playingTeamBall": "Bangladesh",
      "teams": ["Ireland", "Bangladesh"],
      "teamAbbr": ["IRE", "BAN"],
      "liveScorebat": "286 & 254",
      "liveScoreball": "587-8 d",
      "scores": ["286 & 254", "587-8 d"],
      "liveCommentary": "Bangladesh won by an innings and 446 runs",
      "links": {
        "Live Score": "https://www.cricbuzz.com/...",
        "Scorecard": "https://www.cricbuzz.com/...",
        "Full Commentary": "https://www.cricbuzz.com/...",
        "News": "https://www.cricbuzz.com/..."
      },
      "time": "N/A"
    }
  ]
}
```

### 2. Live Scores

Get information about matches currently in progress.

**Endpoint:** `GET /api/cricket/live-scores`

**Response:** Same structure as recent-scores

### 3. Upcoming Matches

Get information about scheduled upcoming matches.

**Endpoint:** `GET /api/cricket/upcoming-matches`

**Response:** Same structure as recent-scores (scores may be empty for matches not yet started)

## Response Structure

### Success Response

- `success` (boolean): Indicates if the request was successful
- `count` (number): Number of matches returned
- `data` (array): Array of match objects

### Match Object

- `title` (string): Full match title
- `matchLink` (string): URL to the match page
- `matchDetails` (string): Match description
- `status` (string): Match status
- `location` (string): Match location and venue
- `playingTeamBat` (string): Batting team name
- `playingTeamBall` (string): Bowling team name
- `teams` (array): Array of team names
- `teamAbbr` (array): Array of team abbreviations
- `liveScorebat` (string): Batting team score
- `liveScoreball` (string): Bowling team score
- `scores` (array): Array of scores
- `liveCommentary` (string): Match status/result commentary
- `links` (object): Related links (scorecard, commentary, news)
- `time` (string): Match time (if available)

### Error Response

```json
{
  "success": false,
  "error": "Error fetching the webpage",
  "message": "Detailed error message"
}
```

## Technical Details

### Technology Stack

- **Node.js** with Express.js
- **Axios** for HTTP requests
- **Cheerio** for HTML parsing
- Modern Tailwind CSS selectors for Cricbuzz's redesigned website

### Rate Limiting

The API respects Cricbuzz's servers with:

- 10-second timeout per request
- User-Agent header to identify requests
- Proper error handling

### Caching Recommendations

For production use, consider implementing:

- Redis caching (5-10 minute TTL for live scores)
- CDN caching for static match data
- Request throttling to prevent abuse

## Development

### Prerequisites

```bash
npm install
```

### Start Server

```bash
npm start
# or for development with auto-reload
npm run dev
```

### Environment Variables

- `PORT` - Server port (default: 5003)

## Maintenance Notes

### Cricbuzz Website Changes

If the API stops returning data, Cricbuzz may have updated their HTML structure. Check:

1. CSS selectors: `a.w-full.bg-cbWhite.flex.flex-col`
2. Team name selectors: `span.hidden.wb\:block.whitespace-nowrap`
3. Score selectors: `span.font-medium.wb\:font-semibold`
4. Location selectors: `span.text-xs.text-cbTxtSec`

### Last Updated

November 14, 2025 - Updated for Cricbuzz's Tailwind CSS redesign

## License

ISC
