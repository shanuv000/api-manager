# Cricbuzz News Scraper

A comprehensive Node.js scraper to fetch latest cricket news from Cricbuzz with in-depth article details.

## Features

- 🏏 Fetch latest cricket news headlines
- 📰 Extract full article content and details
- 🖼️ Capture article images
- 🏷️ Extract tags and categories
- 🔗 Get related articles
- 💾 Save data to JSON format
- 🎨 Beautiful console output formatting

## Installation

```bash
npm install
```

## Usage

### Run the Scraper

```bash
npm run scrape:cricbuzz
```

Or directly:

```bash
node scrapers/cricbuzz-news-scraper.js
```

### Output

The scraper will:
1. Fetch the latest cricket news from Cricbuzz
2. Extract detailed information for the top 10 articles
3. Display formatted news in the console
4. Save all data to `cricbuzz-latest-news.json`

### Data Structure

Each news article includes:

```json
{
  "id": "article-id",
  "title": "Article headline",
  "description": "Brief description or intro",
  "link": "Full article URL",
  "imageUrl": "Article image URL",
  "publishedTime": "Time since published",
  "source": "Cricbuzz",
  "scrapedAt": "ISO timestamp",
  "details": {
    "title": "Full title",
    "publishedTime": "Published time",
    "mainImage": "Main article image",
    "content": "Full article content",
    "contentParagraphs": ["Array of paragraphs"],
    "tags": ["Array of tags"],
    "relatedArticles": [
      {
        "title": "Related article title",
        "link": "Related article URL"
      }
    ]
  }
}
```

## Use as a Module

```javascript
const CricbuzzNewsScraper = require('./scrapers/cricbuzz-news-scraper');

const scraper = new CricbuzzNewsScraper();

// Fetch just the headlines
const headlines = await scraper.fetchLatestNews();

// Fetch with full article details (top 5)
const detailedNews = await scraper.fetchLatestNewsWithDetails(5);

// Fetch details for a specific article
const articleDetails = await scraper.fetchArticleDetails(articleUrl);
```

## API Methods

### `fetchLatestNews()`
Fetches all latest news headlines from the main page.

**Returns:** `Promise<Array>` - Array of news article objects

### `fetchArticleDetails(articleUrl)`
Fetches detailed information for a specific article.

**Parameters:**
- `articleUrl` (string) - The URL of the article

**Returns:** `Promise<Object>` - Detailed article object

### `fetchLatestNewsWithDetails(limit = 5)`
Fetches latest news with full details for each article.

**Parameters:**
- `limit` (number) - Number of articles to fetch details for (default: 5)

**Returns:** `Promise<Array>` - Array of detailed news articles

### `formatNews(newsArticles)`
Formats news articles for console display.

**Parameters:**
- `newsArticles` (Array) - Array of news article objects

**Returns:** `string` - Formatted news string

## Dependencies

- **axios**: HTTP client for making requests
- **cheerio**: HTML parsing and DOM manipulation

## Notes

- The scraper includes a 1-second delay between article detail requests to avoid rate limiting
- All scraped data includes timestamps for tracking
- User agent headers are included to mimic browser requests
- Error handling is implemented for both main page and individual article scraping

## Example Output

```
🏏 Fetching latest cricket news from Cricbuzz...
✅ Successfully fetched 30 news articles

📚 Fetching detailed information for top 10 articles...

1/10 - Green confirms availability to bowl in IPL 2026
2/10 - PCB eyes franchise-based T20 tournament for women
...

✅ Successfully fetched 10 detailed articles

╔═══════════════════════════════════════════════════════════════╗
║           🏏 LATEST CRICKET NEWS FROM CRICBUZZ 🏏            ║
╚═══════════════════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Green confirms availability to bowl in IPL 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 The Australian clarified that his IPL auction tag...
...

💾 News data saved to cricbuzz-latest-news.json
```

## License

ISC
