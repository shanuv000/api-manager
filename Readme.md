# Cricket API - Live Scores & Match Data

node scrapers/content-enhancer-perplexity.js

A robust and secure Express.js API server designed to provide real-time cricket data from Cricbuzz:

- **Live Cricket Scores:** Up-to-the-minute updates for cricket enthusiasts
- **Recent Matches:** Detailed information about recently completed matches
- **Upcoming Matches:** Schedules and details for upcoming cricket fixtures
- **Scorecard Details:** Comprehensive batting and bowling statistics

## Features

- **Security:** Employs Helmet middleware to enhance security by setting appropriate HTTP headers
- **Rate Limiting:** Protects against abuse by limiting requests per IP address (30 requests/minute)
- **CORS Handling:** Allows controlled access from specific origins
- **Error Handling:** Robustly handles errors with centralized middleware
- **Edge Caching:** Optimized for Vercel deployment with CDN caching
- **Structured Routing:** Organized routes for better maintainability

## Getting Started

### Prerequisites

- Node.js (v14 or higher recommended)
- npm or yarn package manager

### Installation

1. **Clone the Repository:**

   ```bash
   git clone https://github.com/your-username/cricket-api.git
   cd cricket-api
   ```

2. **Install Dependencies:**
   ```bash
   npm install
   ```

### Running the Server

```bash
npm start
```

or for development with auto-reload:

```bash
npm run dev
```

The server will be running at `http://localhost:5003` by default.

## API Endpoints

The server provides several endpoints for accessing cricket data:

- **Cricket:**
  - `/api/cricket/recent-scores` - Get recently completed matches with full details
  - `/api/cricket/live-scores` - Get currently live matches with real-time updates
  - `/api/cricket/upcoming-matches` - Get scheduled upcoming matches

**Example Usage (Live Scores)**

```bash
GET /api/cricket/live-scores
```

This will return a JSON response containing live cricket scores with detailed match information.

## Response Format

All endpoints return:

```json
{
  "success": true,
  "count": 6,
  "data": [
    {
      "title": "India vs Australia, 1st Test",
      "teams": ["India", "Australia"],
      "teamAbbr": ["IND", "AUS"],
      "scores": ["350/8", "280-10"],
      "location": "Perth Stadium, Perth",
      "liveCommentary": "India won by 70 runs",
      "links": {
        "Live Score": "https://...",
        "Scorecard": "https://...",
        "Full Commentary": "https://..."
      },
      "scorecard": [...]
    }
  ]
}
```

## Middleware

The server uses the following middleware:

- **cors:** Enables Cross-Origin Resource Sharing (CORS) for specific origins
- **express.json():** Parses incoming JSON requests
- **helmet():** Sets security-related HTTP headers
- **express-rate-limit:** Limits requests from a single IP address

## Error Handling

The API uses structured error responses with specific error codes:

| Error Code            | Status | Description                    |
| --------------------- | ------ | ------------------------------ |
| `VALIDATION_ERROR`    | 400    | Invalid input parameters       |
| `NOT_FOUND`           | 404    | Resource not found             |
| `RATE_LIMITED`        | 429    | Source rate limit exceeded     |
| `SCRAPING_FAILED`     | 502    | Failed to scrape data          |
| `SERVICE_UNAVAILABLE` | 503    | Source temporarily unavailable |
| `TIMEOUT`             | 504    | Request timed out              |

**Error Response Format:**

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Parameter \"limit\" must be a valid integer",
    "details": { "field": "limit" },
    "timestamp": "2025-12-15T00:30:00.000Z"
  }
}
```

### Testing Error Handling

Run the error handling test suite:

```bash
API_URL=https://api-sync.vercel.app node tests/test-error-handling.js
```

## Deployment

This project is optimized for deployment on Vercel with serverless functions.

## Project Structure

- `server.js`: Main server file responsible for setup and routing
- `routes/Cricket/`: Contains all cricket-related routes and scrapers
  - `index.js`: Main cricket routes (recent, live, upcoming)
  - `scorecard.js`: Scorecard scraping functionality
- `component/`: Middleware and utility components
  - `middleware.js`: Security, CORS, and rate limiting setup

## Documentation

See `CRICKET_API.md` for detailed API documentation.

## License

This project is licensed under the ISC License.
