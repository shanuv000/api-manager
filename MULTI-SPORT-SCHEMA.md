# Multi-Sport News Database Schema Design

## Current State
- Single `NewsArticle` model for cricket only
- No sport categorization

## Requirements
1. Support multiple sports (cricket, football, tennis, basketball, etc.)
2. Maintain consistent schema across sports
3. Allow sport-specific data when needed
4. Efficient querying by sport
5. Future-proof for expansion

## Recommended Data Model

### Option 1: Single Table with Sport Type ✅ **RECOMMENDED**

**Advantages:**
- Simple, maintainable
- Easy cross-sport queries
- Consistent API across all sports
- No code duplication
- Easy to add new sports (just a new enum value)

**Structure:**
```prisma
model NewsArticle {
  // Identity
  id              String   @id @default(cuid())
  slug            String   @unique
  
  // Categorization ✨ NEW
  sport           String   // "cricket", "football", "tennis", etc.
  category        String?  // "news", "match-report", "analysis", "interview", etc.
  
  // Content
  title           String
  description     String?  @db.Text
  content         String?  @db.Text
  
  // Media
  imageUrl        String?
  
  // Metadata
  publishedTime   String?  // ✨ NOW CAPTURED
  author          String?  // Optional author name
  
  // Source tracking
  sourceUrl       String   @unique
  sourceId        String   @unique
  sourceName      String   // "Cricbuzz", "ESPN", "Goal.com", etc.
  
  // SEO
  metaTitle       String?
  metaDesc        String?
  
  // Tags & Relations
  tags            String[]
  relatedArticles Json?
  
  // Sport-specific data (flexible)
  sportData       Json?    // For sport-specific fields
  
  // Timestamps
  scrapedAt       DateTime @default(now())
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  // Indexes for performance
  @@index([sport, createdAt(sort: Desc)])
  @@index([sport, category])
  @@index([slug])
  @@index([sourceId])
  @@map("news_articles")
}
```

**API Query Examples:**
```javascript
// Get cricket news
prisma.newsArticle.findMany({ where: { sport: 'cricket' } })

// Get football match reports
prisma.newsArticle.findMany({ 
  where: { sport: 'football', category: 'match-report' } 
})

// Get all news (cross-sport)
prisma.newsArticle.findMany({ orderBy: { createdAt: 'desc' } })

// Get cricket from last 24 hours
prisma.newsArticle.findMany({
  where: {
    sport: 'cricket',
    createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
  }
})
```

### Alternative Options (Not Recommended)

#### Option 2: Separate Tables
```prisma
model CricketNews { ... }
model FootballNews { ... }
```
❌ Issues: Code duplication, harder cross-sport queries

#### Option 3: Table Per Sport with Base
```prisma
model NewsArticle { ... } // Base
model CricketMetadata { articleId, ... }
```
❌ Issues: Complex joins, harder to maintain

## Field Mapping for Cricket (Cricbuzz)

```
sport          = "cricket"
category       = "news" (default, can add "match-report", "analysis" later)
sourceUrl      = cricbuzzUrl
sourceId       = cricbuzzId
sourceName     = "Cricbuzz"
publishedTime  = "Sun, Dec 14, 2025 • 9:09 AM" ✅ NOW WORKING
```

## Future Sport Sources

### Football
- Source: ESPN, Goal.com, The Athletic
- Fields: `sport="football"`, `sourceName="ESPN"`, etc.

### Tennis
- Source: ATP, WTA official sites
- Fields: `sport="tennis"`, `sourceName="ATP Tour"`, etc.

### Basketball
- Source: NBA.com, ESPN
- Fields: `sport="basketball"`, `sourceName="NBA"`, etc.

## API Endpoint Structure

**Current:**
```
GET /api/cricket/news
GET /api/cricket/news/:slug
```

**Future (Multi-Sport):**
```
GET /api/cricket/news          -> filter by sport='cricket'
GET /api/football/news         -> filter by sport='football'
GET /api/news                  -> all sports
GET /api/news/:sport/:slug     -> specific article
```

**Or Unified:**
```
GET /api/news?sport=cricket
GET /api/news?sport=football
GET /api/news/:slug
```

## Implementation Steps

1. ✅ Update Prisma schema with new fields
2. ✅ Run migration to add columns
3. ✅ Clear existing data (old schema)
4. ✅ Update API to set `sport="cricket"`, `sourceName="Cricbuzz"`
5. ✅ Re-scrape with new schema + publish times
6. ✅ Update cron job to include new fields
7. ✅ Deploy to Vercel

## Future Enhancements

- **Sport-Specific Categories:**
  ```javascript
  cricket: ["news", "match-report", "player-interview", "analysis"]
  football: ["news", "match-report", "transfer", "tactics"]
  ```

- **Sport Data Examples:**
  ```json
  // Cricket
  { "matchType": "Test", "teams": ["IND", "AUS"] }
  
  // Football
  { "league": "Premier League", "teams": ["MAN", "LIV"] }
  ```

## Benefits of This Model

✅ **Scalable:** Add new sports without schema changes
✅ **Performant:** Indexed queries on sport + createdAt
✅ **Simple:** One API codebase for all sports
✅ **Flexible:** JSON field for sport-specific data
✅ **SEO-Friendly:** Maintain slug-based URLs for all sports
✅ **Consistent:** Same data structure across all sports
