const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const getScorecardDetails = require("./scorecard");
const { getCache, setCache } = require("../../component/redisClient");
const { parsePublishTime } = require("../../utils/timeParser");

const router = express.Router();


// URLs for scraping
const urls = {
  recentMatches:
    "https://www.cricbuzz.com/cricket-match/live-scores/recent-matches",
  liveScores: "https://www.cricbuzz.com/cricket-match/live-scores",
  upcomingMatches:
    "https://www.cricbuzz.com/cricket-match/live-scores/upcoming-matches",
};

// Common scraping function
const scrapeCricbuzzMatches = async (url) => {
  const response = await axios.get(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    timeout: 10000,
  });

  const html = response.data;
  const $ = cheerio.load(html);
  const matches = [];
  const processedLinks = new Set();

  const matchElements = $("a.w-full.bg-cbWhite.flex.flex-col");

  matchElements.each((index, element) => {
    const $matchCard = $(element);
    const href = $matchCard.attr("href");
    const title = $matchCard.attr("title");

    if (!title || !href || !title.includes("vs") || processedLinks.has(href)) {
      return;
    }

    processedLinks.add(href);

    const match = {};
    match.title = title.trim();
    match.matchLink = href ? `https://www.cricbuzz.com${href}` : null;

    const titleParts = title.split(" - ");
    if (titleParts.length >= 2) {
      match.matchDetails = titleParts[0].trim();
      match.status = titleParts[1].trim();
    } else {
      match.matchDetails = title.trim();
      match.status = "N/A";
    }

    const locationSpan = $matchCard.find("span.text-xs.text-cbTxtSec").first();
    match.location = locationSpan.length ? locationSpan.text().trim() : "N/A";

    const teams = [];
    const teamAbbr = [];
    const scores = [];

    $matchCard
      .find("div.flex.items-center.gap-4.justify-between")
      .each((i, row) => {
        const $row = $(row);

        const teamFull = $row
          .find("span.hidden.wb\\:block.whitespace-nowrap")
          .text()
          .trim();
        if (teamFull) teams.push(teamFull);

        const teamAbb = $row
          .find("span.block.wb\\:hidden.whitespace-nowrap")
          .text()
          .trim();
        if (teamAbb) teamAbbr.push(teamAbb);

        const score = $row
          .find("span.font-medium.wb\\:font-semibold")
          .text()
          .trim();
        if (score) scores.push(score);
      });

    if (teams.length >= 2) {
      match.playingTeamBat = teams[0];
      match.playingTeamBall = teams[1];
    } else if (teams.length === 1) {
      match.playingTeamBat = teams[0];
      match.playingTeamBall = "N/A";
    } else {
      match.playingTeamBat = "N/A";
      match.playingTeamBall = "N/A";
    }

    match.teams = teams.length > 0 ? teams : teamAbbr;
    match.teamAbbr = teamAbbr.length > 0 ? teamAbbr : teams;

    if (scores.length >= 2) {
      match.liveScorebat = scores[0];
      match.liveScoreball = scores[1];
    } else if (scores.length === 1) {
      match.liveScorebat = scores[0];
      match.liveScoreball = "N/A";
    } else {
      match.liveScorebat = "N/A";
      match.liveScoreball = "N/A";
    }
    match.scores = scores;

    const resultSpan = $matchCard
      .find(
        'span[class*="text-cbComplete"], span[class*="text-cbLive"], span[class*="text-cbPreview"]'
      )
      .first();
    match.liveCommentary = resultSpan.length
      ? resultSpan.text().trim()
      : match.status || "N/A";

    match.links = {};
    if (href) {
      const basePath = href.replace("/live-cricket-scores/", "");
      match.links["Live Score"] = `https://www.cricbuzz.com${href}`;
      match.links[
        "Scorecard"
      ] = `https://www.cricbuzz.com/live-cricket-scorecard/${basePath}`;
      match.links[
        "Full Commentary"
      ] = `https://www.cricbuzz.com/live-cricket-full-commentary/${basePath}`;
      match.links[
        "News"
      ] = `https://www.cricbuzz.com/cricket-match-news/${basePath}`;
    }

    match.time = "N/A";
    matches.push(match);
  });

  return matches;
};

// Helper function to enrich matches with scorecard details
const enrichMatchesWithScorecard = async (matches) => {
  return Promise.all(
    matches.map(async (match) => {
      if (match.links && match.links["Scorecard"]) {
        try {
          const details = await getScorecardDetails(match.links["Scorecard"]);
          if (details) {
            match.scorecard = details;
          }
        } catch (err) {
          console.error(
            `Failed to fetch details for ${match.title}: ${err.message}`
          );
        }
      }
      return match;
    })
  );
};

// Enhanced cache header helper with better strategies
// Different caching strategies for different endpoints
const setCacheHeaders = (res, options = {}) => {
  const {
    maxAge = 60,           // Edge cache time in seconds
    staleWhileRevalidate = 30,  // Stale content serving time
    mustRevalidate = false,     // Force revalidation
  } = options;

  const cacheControl = [
    'public',
    `s-maxage=${maxAge}`,
    `stale-while-revalidate=${staleWhileRevalidate}`,
  ];

  if (mustRevalidate) {
    cacheControl.push('must-revalidate');
  }

  res.setHeader('Cache-Control', cacheControl.join(', '));
  res.setHeader('Vary', 'Accept-Encoding'); // Important for compressed responses
  res.setHeader('X-Content-Type-Options', 'nosniff');
};

// Recent Scores endpoint
router.get("/recent-scores", async (req, res) => {
  try {
    setCacheHeaders(res, { maxAge: 60, staleWhileRevalidate: 30 });
    
    // Try to get from cache first
    const cacheKey = "cricket:recent-scores";
    const cachedData = await getCache(cacheKey);
    
    if (cachedData) {
      return res.json(cachedData); // Already an object from Upstash
    }
    
    // Cache miss - fetch from source
    const matches = await scrapeCricbuzzMatches(urls.recentMatches);
    const enrichedMatches = await enrichMatchesWithScorecard(matches);
    
    const response = {
      success: true,
      count: enrichedMatches.length,
      data: enrichedMatches,
    };
    
    // Cache for 1 hour (3600 seconds) - balance freshness and load
    await setCache(cacheKey, response, 3600);
    
    res.json(response);
  } catch (error) {
    console.error("Error fetching recent matches:", error.message);
    res.status(500).json({
      success: false,
      error: "Error fetching the webpage",
      message: error.message,
    });
  }
});

// Live Scores endpoint
router.get("/live-scores", async (req, res) => {
  try {
    setCacheHeaders(res, { maxAge: 30, staleWhileRevalidate: 15 });
    
    // Try to get from cache first
    const cacheKey = "cricket:live-scores";
    const cachedData = await getCache(cacheKey);
    
    if (cachedData) {
      return res.json(cachedData); // Already an object from Upstash
    }
    
    // Cache miss - fetch from source
    const matches = await scrapeCricbuzzMatches(urls.liveScores);
    const enrichedMatches = await enrichMatchesWithScorecard(matches);

    const response = {
      success: true,
      count: enrichedMatches.length,
      data: enrichedMatches,
    };
    
    // Cache for 1 minute (60 seconds) - live scores change frequently
    await setCache(cacheKey, response, 60);
    
    res.json(response);
  } catch (error) {
    console.error("Error fetching live scores:", error.message);
    res.status(500).json({
      success: false,
      error: "Error fetching the webpage",
      message: error.message,
    });
  }
});

// Upcoming Matches endpoint
router.get("/upcoming-matches", async (req, res) => {
  try {
    setCacheHeaders(res, { maxAge: 120, staleWhileRevalidate: 60 });
    
    // Try to get from cache first
    const cacheKey = "cricket:upcoming-matches";
    const cachedData = await getCache(cacheKey);
    
    if (cachedData) {
      return res.json(cachedData); // Already an object from Upstash
    }
    
    // Cache miss - fetch from source
    const matches = await scrapeCricbuzzMatches(urls.upcomingMatches);
    const enrichedMatches = await enrichMatchesWithScorecard(matches);

    const response = {
      success: true,
      count: enrichedMatches.length,
      data: enrichedMatches,
    };
    
    // Cache for 3 hours (10800 seconds) - upcoming matches are very stable
    await setCache(cacheKey, response, 10800);
    
    res.json(response);
  } catch (error) {
    console.error("Error fetching upcoming matches:", error.message);
    res.status(500).json({
      success: false,
      error: "Error fetching the webpage",
      message:error.message,
    });
  }
});

// Cricket News endpoint with database storage for SEO
router.get("/news", async (req, res) => {
  try {
    // Cache for 30 min (data refreshes every 6 hours via GitHub Actions)
    setCacheHeaders(res, { maxAge: 1800, staleWhileRevalidate: 1800 });
    
    // Get limit from query params (default: 10, max: 20)
    const limit = Math.min(parseInt(req.query.limit) || 10, 20);
    
    // STEP 1: Try Redis cache first (fastest)
    const cacheKey = `cricket:news:${limit}`;
    const cachedData = await getCache(cacheKey);
    
    if (cachedData) {
      console.log(`✅ Returning ${cachedData.count} articles from Redis cache`);
      return res.json({ ...cachedData, source: 'redis' });
    }
    
    // STEP 2: Try to get from database (last 24 hours)
    const prisma = require("../../component/prismaClient");
    
    const recentNews = await prisma.newsArticle.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      where: {
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
        }
      }
    });
    
    // If we have enough fresh articles in database, cache and return them
    if (recentNews.length >= limit) {
      console.log(`✅ Returning ${recentNews.length} articles from database`);
      const response = {
        success: true,
        count: recentNews.length,
        data: recentNews,
        source: 'database',
        timestamp: new Date().toISOString()
      };
      
      // Cache in Redis for 2 hours (7200 seconds) - data refreshes every 6 hours
      await setCache(cacheKey, response, 7200);
      
      return res.json(response);
    }
    
    // STEP 2: If not enough fresh data, scrape from Cricbuzz (only on local/non-Vercel)
    const isVercel = !!process.env.VERCEL;
    let scraper = null;
    
    try {
      if (recentNews.length < limit && !isVercel) {
        console.log('🔄 Scraping fresh news from Cricbuzz...');
        const CricbuzzNewsScraper = require("../../scrapers/cricbuzz-news-scraper");
        scraper = new CricbuzzNewsScraper();
        
        const newsArticles = await scraper.fetchLatestNewsWithDetails(limit);
        
        // STEP 3: Save to database (upsert to prevent duplicates)
        const savedArticles = [];
        for (const article of newsArticles) {
          try {
            // Use first paragraph of content as description (more accurate than listing page)
            const firstParagraph = article.details?.contentParagraphs?.[0] || article.description || '';
            const uniqueDescription = firstParagraph.substring(0, 300);
            
            const saved = await prisma.newsArticle.upsert({
              where: { sourceId: article.id },
              update: {
                title: article.title,
                description: uniqueDescription,
                content: article.details?.content || null,
                imageUrl: article.imageUrl,
                thumbnailUrl: article.thumbnailUrl || article.imageUrl,
                publishedTime: parsePublishTime(article.details?.publishedTime || article.publishedTime),
                tags: article.details?.tags || [],
                relatedArticles: article.details?.relatedArticles || null,
                updatedAt: new Date()
              },
              create: {
                sourceId: article.id,
                slug: article.id,
                sport: 'cricket',
                category: 'news',
                sourceName: 'Cricbuzz',
                title: article.title,
                description: uniqueDescription,
                content: article.details?.content || null,
                imageUrl: article.imageUrl,
                thumbnailUrl: article.thumbnailUrl || article.imageUrl,
                sourceUrl: article.link,
                publishedTime: article.details?.publishedTime || article.publishedTime,
                metaTitle: article.title,
                metaDesc: uniqueDescription.substring(0, 160),
                tags: article.details?.tags || [],
                relatedArticles: article.details?.relatedArticles || null,
                scrapedAt: new Date(article.scrapedAt)
              }
            });
            savedArticles.push(saved);
          } catch (error) {
            console.error(`Error saving article ${article.id}:`, error.message);
          }
        }
        
        console.log(`✅ Saved ${savedArticles.length} articles to database`);
        return res.json({
          success: true,
          count: savedArticles.length,
          data: savedArticles,
          source: 'scraped',
          timestamp: new Date().toISOString()
        });
      } else if (recentNews.length < limit && isVercel) {
        // On Vercel: Return what we have from database (scraping disabled due to 10s timeout)
        console.log(`⚠️ Vercel environment detected - scraping disabled. Returning ${recentNews.length} articles from database.`);
        
        return res.json({
          success: true,
          count: recentNews.length,
          data: recentNews,
          source: 'database',
          note: 'Scraping disabled on Vercel due to timeout limits. Database updated via GitHub Actions cron.',
          timestamp: new Date().toISOString()
        });
      }
    } finally {
      // Always close browser if it was initialized
      if (scraper) {
        await scraper.closeBrowser();
      }
    }
  } catch (error) {
    console.error("Error fetching cricket news:", error.message);
    res.status(500).json({
      success: false,
      error: "Error fetching cricket news",
      message: error.message,
    });
  }
});

// Get single article by slug (SEO endpoint)
router.get('/news/:slug', async (req, res) => {
  // Get single news article by slug (cricket only)
  try {
    // Set cache headers (1 hour)
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400');
    
    const prisma = require("../../component/prismaClient");
    
    const article = await prisma.newsArticle.findFirst({
      where: { 
        slug: req.params.slug,
        sport: 'cricket'
      }
    });
    
    if (!article) {
      return res.status(404).json({
        success: false,
        error: 'Article not found'
      });
    }
    
    res.json({
      success: true,
      data: article
    });
  } catch (error) {
    console.error('Error fetching article:', error.message);
    res.status(500).json({
      success: false,
      error: 'Error fetching article',
      message: error.message
    });
  }
});

module.exports = router;
