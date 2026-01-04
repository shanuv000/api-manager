## Plan: Scraped Data Enhancement & Frontend Delivery Pipeline

This codebase implements a comprehensive **scraping → enhancement → storage → delivery** pipeline. Raw cricket news is collected from 5 sources (Cricbuzz, ESPN Cricinfo, ICC, BBC, IPL T20) via Puppeteer scrapers, optionally enhanced using Perplexity AI for SEO optimization, stored in PostgreSQL via Prisma, and served through Express.js API endpoints with Redis caching.

### Current Data Flow

1. **Scraping** (`scrapers/run-scraper.js`) - Cron runs 7x/day via `scripts/vps-scrape.sh`, collecting title, content, images, tags from each source
2. **Storage** (`prisma/schema.prisma`) - Raw data saved to `NewsArticle` table with duplicate prevention via unique constraints
3. **Enhancement** (`scrapers/content-enhancer-perplexity.js`) - Perplexity Sonar AI rewrites content with SEO titles, markdown formatting, key takeaways → saved to `EnhancedContent` table
4. **API Delivery** (`routes/Cricket/`) - Express endpoints serve merged data with `displayTitle`, `displayContent` fields prioritizing enhanced versions
5. **Caching** (`component/redisClient.js`) - Redis caches responses (30s-1hr TTL by endpoint type)

### Steps to Improve

1. **Unify content format** - Add markdown normalization layer in API so ESPN/Cricbuzz plain text matches ICC/BBC markdown output
2. **Implement enhancement queue** - Create job queue (e.g., BullMQ) in `scripts/` to ensure all new articles get enhanced, not just batch runs
3. **Add cache invalidation** - Trigger Redis cache clear in scraper save routines when new content arrives, instead of relying only on TTL
4. **Build retry mechanism** - Persist failed article URLs to database for automatic retry on next scraper run
5. **Expose health metrics** - Add `/api/health/scrapers` endpoint showing last run times, success rates, enhancement coverage percentage

### Further Considerations

1. **Enhancement timing**: Run enhancement immediately after scraping (inline) vs. separate cron? _Recommend: async queue to avoid blocking scrapers_
2. **Frontend rendering library**: Currently documented as `react-markdown` — confirm this handles all embedded content (tweets/Instagram) or add preprocessing? _Recommend: preprocessing layer to extract embeds before markdown parsing_
3. **Cost vs. coverage tradeoff**: Perplexity costs ~$2/month at current volume — worth enhancing ALL articles or only high-priority (IPL, international)? _Recommend: priority queue with source ranking_
