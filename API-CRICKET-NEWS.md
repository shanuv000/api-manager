# Cricket News API Endpoint

## Endpoint Details

**URL:** `/api/cricket/news`

**Method:** `GET`

**Base URL:** `http://localhost:5003` (development) or your deployed URL

## Query Parameters

- `limit` (optional): Number of news articles to fetch
  - **Default:** 10
  - **Maximum:** 20
  - **Example:** `?limit=5`

## Example Requests

### Fetch 10 Latest News Articles (Default)
```bash
curl http://localhost:5003/api/cricket/news
```

### Fetch 5 Latest News Articles
```bash
curl http://localhost:5003/api/cricket/news?limit=5
```

### Fetch Maximum (20) News Articles
```bash
curl http://localhost:5003/api/cricket/news?limit=20
```

## Response Format

```json
{
  "success": true,
  "count": 10,
  "timestamp": "2025-12-14T05:00:32.393Z",
  "data": [
    {
      "id": "green-confirms-availability-to-bowl-in-ipl-2026",
      "title": "Green confirms availability to bowl in IPL 2026",
      "description": "The Australian clarified that his IPL auction tag...",
      "link": "https://www.cricbuzz.com/cricket-news/136885/...",
      "imageUrl": "https://static.cricbuzz.com/...",
      "publishedTime": "",
      "source": "Cricbuzz",
      "scrapedAt": "2025-12-14T05:00:32.393Z",
      "details": {
        "title": "Green confirms availability to bowl in IPL 2026",
        "publishedTime": "",
        "mainImage": null,
        "content": "Full article text...",
        "contentParagraphs": ["Para 1", "Para 2", ...],
        "tags": [],
        "relatedArticles": []
      }
    }
  ]
}
```

## Caching Strategy

- **Redis Cache TTL:** 6 hours (21600 seconds)
- **Edge Cache:** 3 minutes with 90s stale-while-revalidate
- **Cache Key:** `cricket:news:{limit}`

This means:
- First request will scrape Cricbuzz (takes ~30-50 seconds)
- Subsequent requests within 6 hours will be instant (from Redis cache)
- Different limits have separate caches

## Integration with Your Cricket Website

### Using Fetch API
```javascript
// In your frontend
async function fetchCricketNews(limit = 10) {
  const response = await fetch(`/api/cricket/news?limit=${limit}`);
  const data = await response.json();
  
  if (data.success) {
    return data.data; // Array of news articles
  } else {
    throw new Error(data.message);
  }
}

// Usage
fetchCricketNews(5).then(news => {
  news.forEach(article => {
    console.log(article.title);
    console.log(article.description);
    console.log(article.details.content); // Full article text
  });
});
```

### Using Axios
```javascript
import axios from 'axios';

const fetchNews = async () => {
  try {
    const { data } = await axios.get('/api/cricket/news', {
      params: { limit: 10 }
    });
    
    return data.data;
  } catch (error) {
    console.error('Error fetching news:', error);
  }
};
```

### React Component Example
```jsx
import { useState, useEffect } from 'react';

function CricketNews() {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/cricket/news?limit=5')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setNews(data.data);
        }
        setLoading(false);
      });
  }, []);

  if (loading) return <div>Loading news...</div>;

  return (
    <div className="cricket-news">
      <h2>Latest Cricket News</h2>
      {news.map(article => (
        <div key={article.id} className="news-card">
          <img src={article.imageUrl} alt={article.title} />
          <h3>{article.title}</h3>
          <p>{article.description}</p>
          <a href={article.link} target="_blank">Read More</a>
        </div>
      ))}
    </div>
  );
}
```

## Performance Notes

- **First Load:** 30-50 seconds (scraping Cricbuzz)
- **Cached Load:** < 100ms (from Redis)
- **Recommended:** Call this endpoint on-demand or with a background job
- **Best Practice:** Pre-warm cache with a cron job

## Error Handling

The endpoint returns standardized error responses:

```json
{
  "success": false,
  "error": "Error fetching cricket news",
  "message": "Specific error details"
}
```

## Available Endpoints

Your cricket API now has:
- ✅ `/api/cricket/live-scores` - Live match scores
- ✅ `/api/cricket/recent-scores` - Recent matches
- ✅ `/api/cricket/upcoming-matches` - Upcoming fixtures
- ✅ `/api/cricket/news` - Latest cricket news (NEW!)
