const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const getScorecardDetails = require("./scorecard");
const { getCache, setCache } = require("../../component/redisClient");
const { parsePublishTime } = require("../../utils/timeParser");
const {
  ApiError,
  ValidationError,
  NotFoundError,
  RateLimitError,
  ScrapingError,
  TimeoutError,
  ServiceUnavailableError,
  handleAxiosError,
  retryWithBackoff,
  validatePaginationParams,
  validateSlug,
  sendError,
  isRateLimited
} = require("../../utils/apiErrors");

const router = express.Router();


// URLs for scraping
const urls = {
  recentMatches:
    "https://www.cricbuzz.com/cricket-match/live-scores/recent-matches",
  liveScores: "https://www.cricbuzz.com/cricket-match/live-scores",
  upcomingMatches:
    "https://www.cricbuzz.com/cricket-match/live-scores/upcoming-matches",
};

// API Documentation - Self-documenting endpoint
router.get("/", (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host")}/api/cricket`;
  
  res.json({
    name: "Cricket API",
    version: "1.0.0",
    description: "Real-time cricket scores, matches, and news scraped from Cricbuzz",
    baseUrl,
    documentation: {
      note: "All endpoints return JSON responses with consistent structure",
      authentication: "No authentication required",
      rateLimit: "No rate limit (cached responses)",
      caching: "Responses are cached in Redis for optimal performance"
    },
    endpoints: [
      {
        path: "/live-scores",
        method: "GET",
        description: "Get currently live cricket matches with real-time scores",
        cacheTTL: "60 seconds",
        parameters: {
          limit: { type: "integer", required: false, default: "all", max: 50, description: "Maximum matches to return" },
          offset: { type: "integer", required: false, default: 0, description: "Skip first N matches (for pagination)" }
        },
        response: {
          success: "boolean",
          count: "number (returned items)",
          total: "number (total available)",
          offset: "number",
          limit: "number",
          data: "array of match objects"
        },
        example: `${baseUrl}/live-scores?limit=5`
      },
      {
        path: "/recent-scores",
        method: "GET",
        description: "Get recently completed cricket matches with final scores (optimized: max 30 scraped)",
        cacheTTL: "1 hour",
        parameters: {
          limit: { type: "integer", required: false, default: 20, max: 50, description: "Maximum matches to return (default: 20)" },
          offset: { type: "integer", required: false, default: 0, description: "Skip first N matches (for pagination)" }
        },
        response: {
          success: "boolean",
          count: "number",
          total: "number (max 30 due to scrape limit)",
          offset: "number",
          limit: "number",
          data: "array of match objects"
        },
        example: `${baseUrl}/recent-scores?limit=10`
      },
      {
        path: "/upcoming-matches",
        method: "GET",
        description: "Get scheduled upcoming cricket matches with start times",
        cacheTTL: "3 hours",
        parameters: {
          limit: { type: "integer", required: false, default: "all", max: 50, description: "Maximum matches to return" },
          offset: { type: "integer", required: false, default: 0, description: "Skip first N matches (for pagination)" }
        },
        response: {
          success: "boolean",
          count: "number",
          total: "number",
          offset: "number",
          limit: "number",
          data: "array of match objects"
        },
        example: `${baseUrl}/upcoming-matches?limit=5&offset=0`
      },
      {
        path: "/news",
        method: "GET",
        description: "Get latest cricket news articles from database (Cricbuzz + ESPN Cricinfo)",
        cacheTTL: "30 minutes",
        parameters: {
          limit: { type: "integer", required: false, default: 10, max: 50, description: "Maximum articles to return" },
          offset: { type: "integer", required: false, default: 0, description: "Skip first N articles (for pagination)" },
          source: { type: "string", required: false, default: "all", enum: ["cricbuzz", "espncricinfo", "all"], description: "Filter by news source" }
        },
        response: {
          success: "boolean",
          count: "number (returned items)",
          total: "number (total available)",
          offset: "number",
          limit: "number",
          hasMore: "boolean (more articles available)",
          data: "array of news article objects",
          source: "string (database|redis)"
        },
        example: `${baseUrl}/news?limit=10&offset=0&source=all`
      },
      {
        path: "/news/:slug",
        method: "GET",
        description: "Get single news article by slug (ID)",
        cacheTTL: "1 hour",
        parameters: {
          slug: { type: "string", required: true, location: "path", description: "Article unique identifier" }
        },
        response: {
          success: "boolean",
          data: "news article object with full content"
        },
        example: `${baseUrl}/news/136890`
      }
    ],
    matchObject: {
      description: "Structure of match objects returned by score endpoints",
      fields: {
        title: "string - Full match title (e.g., 'India vs Australia, 2nd Test')",
        matchLink: "string - URL to match page on Cricbuzz",
        matchDetails: "string - Match description",
        status: "string - Current match status from page",
        matchStatus: "string - Match state: 'completed', 'live', or 'upcoming'",
        result: "string - Match result (only for completed matches, e.g., 'India won by 7 wkts')",
        time: "string - Start time for upcoming, 'LIVE' for live, or formatted date for completed",
        matchStartTime: "object - Detailed time info with ISO date",
        location: "string - Venue location",
        teams: "array - Full team names",
        teamAbbr: "array - Team abbreviations",
        team1Icon: "string - URL to team 1 logo image",
        team2Icon: "string - URL to team 2 logo image",
        playingTeamBat: "string - Team currently batting",
        playingTeamBall: "string - Team currently bowling",
        liveScorebat: "string - Current batting team score",
        liveScoreball: "string - Current bowling team score",
        liveCommentary: "string - Latest match commentary",
        links: "object - URLs to scorecard, full commentary, news",
        scorecard: "object - Detailed scorecard (when available)"
      }
    },
    newsObject: {
      description: "Structure of news article objects",
      fields: {
        id: "string - Unique article identifier",
        title: "string - Article headline",
        description: "string - Article summary",
        imageUrl: "string - Featured image URL",
        publishedAt: "string - ISO date of publication",
        content: "string - Full article content (in single article endpoint)",
        tags: "array - Article tags/categories",
        sourceName: "string - Source website name"
      }
    },
    examples: {
      pagination: `${baseUrl}/live-scores?limit=5&offset=10`,
      allMatches: `${baseUrl}/live-scores`,
      firstFiveUpcoming: `${baseUrl}/upcoming-matches?limit=5`
    }
  });
});

// Common scraping function with optional maxResults limit
const scrapeCricbuzzMatches = async (url, maxResults = null) => {
  let response;
  try {
    response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      timeout: 10000,
    });
  } catch (error) {
    throw handleAxiosError(error, 'Cricbuzz scraping');
  }

  const html = response.data;
  
  // Check for rate limiting in response
  if (isRateLimited(response, html)) {
    throw new RateLimitError('Cricbuzz', 60);
  }
  
  // Check if we got valid HTML
  if (!html || typeof html !== 'string' || html.length < 1000) {
    throw new ScrapingError('Received empty or invalid response from Cricbuzz', 'Cricbuzz');
  }

  const $ = cheerio.load(html);
  const matches = [];
  const processedLinks = new Set();

  // Extract match times from JSON-LD SportsEvent data
  // The page contains script tags with structured data including startDate and eventStatus
  const matchTimeMap = new Map();
  try {
    // Parse JSON-LD script tags
    const scriptTags = $('script[type="application/ld+json"]');
    scriptTags.each((i, script) => {
      try {
        const content = $(script).html();
        if (content && content.includes('SportsEvent')) {
          const jsonData = JSON.parse(content);
          
          // Helper function to extract SportsEvent data
          const extractSportsEvents = (items) => {
            if (!Array.isArray(items)) return;
            for (const item of items) {
              if (item['@type'] === 'SportsEvent') {
                const name = item.name;
                const startDate = item.startDate;
                const status = item.eventStatus;
                if (name && (startDate || status)) {
                  matchTimeMap.set(name, { startDate, status });
                }
              }
            }
          };
          
          // Handle WebPage with mainEntity.itemListElement (actual Cricbuzz format)
          if (jsonData['@type'] === 'WebPage' && jsonData.mainEntity?.itemListElement) {
            extractSportsEvents(jsonData.mainEntity.itemListElement);
          }
          // Handle ItemList containing SportsEvents
          if (jsonData['@type'] === 'ItemList' && jsonData.itemListElement) {
            extractSportsEvents(jsonData.itemListElement);
          }
          // Handle direct SportsEvent
          if (jsonData['@type'] === 'SportsEvent') {
            const name = jsonData.name;
            const startDate = jsonData.startDate;
            const status = jsonData.eventStatus;
            if (name && (startDate || status)) {
              matchTimeMap.set(name, { startDate, status });
            }
          }
        }
      } catch (e) {
        // JSON parse error, skip
      }
    });
    
    // Also extract from embedded RSC payload - look for SportsEvent pattern
    const sportsEvents = html.match(/"@type":"SportsEvent","name":"([^"]+)"[^}]*?"startDate":"([^"]+)"[^}]*?"eventStatus":"([^"]+)"/g);
    if (sportsEvents) {
      for (const eventStr of sportsEvents) {
        const nameMatch = eventStr.match(/"name":"([^"]+)"/);
        const dateMatch = eventStr.match(/"startDate":"([^"]+)"/);
        const statusMatch = eventStr.match(/"eventStatus":"([^"]+)"/);
        if (nameMatch && (dateMatch || statusMatch)) {
          matchTimeMap.set(nameMatch[1], {
            startDate: dateMatch ? dateMatch[1] : null,
            status: statusMatch ? statusMatch[1] : null
          });
        }
      }
    }
    
    console.log(`Found ${matchTimeMap.size} match times from page data`);
  } catch (e) {
    console.log('Time extraction error (non-critical):', e.message);
  }

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
    
    // Extract match ID from href for lookup
    const matchIdMatch = href.match(/\/(\d+)\//);
    const matchId = matchIdMatch ? matchIdMatch[1] : null;

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
    const teamIcons = [];

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
        
        // Extract team icon
        const iconImg = $row.find("img").first();
        const iconSrc = iconImg.attr("src");
        if (iconSrc) {
          // Ensure full URL
          const fullIconUrl = iconSrc.startsWith("http") 
            ? iconSrc 
            : `https://static.cricbuzz.com${iconSrc}`;
          teamIcons.push(fullIconUrl);
        }
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
    
    // Add team icons
    match.teamIcons = teamIcons;
    if (teamIcons.length >= 2) {
      match.team1Icon = teamIcons[0];
      match.team2Icon = teamIcons[1];
    } else if (teamIcons.length === 1) {
      match.team1Icon = teamIcons[0];
      match.team2Icon = null;
    } else {
      match.team1Icon = null;
      match.team2Icon = null;
    }

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

    // Try to get time from JSON-LD data
    // JSON-LD names are like "2nd Match, Big Bash League 2025-26"
    // Scraped titles are like "Melbourne Renegades vs Brisbane Heat, 2nd Match"
    // We need to find the common match description (e.g., "2nd Match", "7th Match")
    let timeInfo = null;
    
    // Extract match number/description from scraped data
    const matchDescParts = match.matchDetails?.split(',') || [];
    const matchNumber = matchDescParts.find(part => 
      /\d+(st|nd|rd|th)\s+(match|test|odi|t20)/i.test(part.trim())
    )?.trim();
    
    // Try to match by match description
    for (const [eventName, value] of matchTimeMap) {
      // Check if the event name starts with similar match description
      if (matchNumber && eventName.toLowerCase().includes(matchNumber.toLowerCase())) {
        timeInfo = value;
        break;
      }
      // Also check if scraped matchDetails contains the key parts of event name
      const eventParts = eventName.split(',');
      if (eventParts.length > 0 && match.matchDetails?.includes(eventParts[0].trim())) {
        timeInfo = value;
        break;
      }
    }

    // Helper to detect if a string is a match result (not a start time)
    const isMatchResult = (str) => {
      if (!str) return false;
      const resultPatterns = [
        /won by/i,                    // "India won by 7 wkts"
        /\bdrawn?\b/i,                // "Match drawn"
        /\btied?\b/i,                 // "Match tied"
        /no result/i,                 // "No result"
        /abandoned/i,                 // "Match abandoned"
        /cancelled/i,                 // "Match cancelled"
        /innings (and|&)/i,           // "won by an innings and 35 runs"
        /\d+\s*(wkts?|wickets?|runs?)/i  // "7 wkts", "35 runs"
      ];
      return resultPatterns.some(pattern => pattern.test(str));
    };
    
    // Helper to detect if a string is a live match status
    const isLiveStatus = (str) => {
      if (!str) return false;
      const livePatterns = [
        /\blive\b/i,
        /day \d+/i,                   // "Day 1", "Day 2"  
        /session/i,                   // "1st Session"
        /innings break/i,
        /tea\b|lunch\b|stumps/i,
        /at (bat|crease)/i
      ];
      return livePatterns.some(pattern => pattern.test(str));
    };

    if (timeInfo && timeInfo.status) {
      const statusStr = timeInfo.status;
      
      // Check if this is a completed match result
      if (isMatchResult(statusStr)) {
        match.result = statusStr;
        match.matchStatus = 'completed';
        // For completed matches, use the ISO date if available, otherwise mark time as N/A
        if (timeInfo.startDate) {
          match.matchStartTime = {
            startDateISO: timeInfo.startDate,
            note: 'Match completed'
          };
          // Try to format a readable time from ISO date
          try {
            const startDate = new Date(timeInfo.startDate);
            match.time = startDate.toLocaleString('en-US', { 
              month: 'short', 
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            });
          } catch (e) {
            match.time = "Completed";
          }
        } else {
          match.time = "Completed";
          match.matchStartTime = { note: 'Match completed' };
        }
      }
      // Check if this is a live match
      else if (isLiveStatus(statusStr)) {
        match.matchStatus = 'live';
        match.time = 'LIVE';
        match.matchStartTime = {
          startDateISO: timeInfo.startDate || null,
          status: statusStr
        };
      }
      // Parse "Match starts at Dec 15, 08:15 GMT" format for upcoming matches
      else {
        const matchStartsMatch = statusStr.match(/Match starts at\s+(?:([A-Za-z]+\s+\d{1,2}),?\s+)?(\d{1,2}:\d{2})\s*(GMT|IST|Local)?/i);
        if (matchStartsMatch) {
          const datePart = matchStartsMatch[1] || '';
          const timePart = matchStartsMatch[2];
          const tzPart = matchStartsMatch[3] || 'GMT';
          match.time = datePart ? `${datePart}, ${timePart} ${tzPart}` : `${timePart} ${tzPart}`;
          match.matchStatus = 'upcoming';
          match.matchStartTime = {
            date: datePart || null,
            time: timePart,
            timezone: tzPart,
            startDateISO: timeInfo.startDate,
            raw: statusStr
          };
        } else {
          // Unknown status format - store as-is but in appropriate field
          match.time = statusStr;
          match.matchStartTime = { startDateISO: timeInfo.startDate, raw: statusStr };
        }
      }
    } else if (match.liveCommentary) {
      // Fallback: try to extract from liveCommentary
      
      // Check if it's a result
      if (isMatchResult(match.liveCommentary)) {
        match.result = match.liveCommentary;
        match.matchStatus = 'completed';
        match.time = "Completed";
      }
      // Check if it's live
      else if (isLiveStatus(match.liveCommentary)) {
        match.matchStatus = 'live';
        match.time = 'LIVE';
      }
      // Try to parse start time
      else {
        const matchStartsMatch = match.liveCommentary.match(/Match starts at\s+(?:([A-Za-z]+\s+\d{1,2}),?\s+)?(\d{1,2}:\d{2})\s*(GMT|IST|Local)?/i);
        if (matchStartsMatch) {
          const datePart = matchStartsMatch[1] || '';
          const timePart = matchStartsMatch[2];
          const tzPart = matchStartsMatch[3] || 'GMT';
          match.time = datePart ? `${datePart}, ${timePart} ${tzPart}` : `${timePart} ${tzPart}`;
          match.matchStatus = 'upcoming';
          match.matchStartTime = {
            date: datePart || null,
            time: timePart,
            timezone: tzPart,
            raw: match.liveCommentary
          };
        } else {
          match.time = "N/A";
        }
      }
    } else {
      match.time = "N/A";
    }
    
    matches.push(match);
    
    // Early exit if maxResults is reached
    if (maxResults && matches.length >= maxResults) {
      return false; // Stop .each() loop
    }
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

// Recent Scores endpoint (optimized: default 20, max scrape 30)
router.get("/recent-scores", async (req, res) => {
  try {
    setCacheHeaders(res, { maxAge: 60, staleWhileRevalidate: 30 });
    
    // Validate query parameters
    let limit, offset;
    try {
      const validated = validatePaginationParams(req.query, { defaultLimit: 20, maxLimit: 50, allowNoLimit: false });
      limit = validated.limit;
      offset = validated.offset;
    } catch (validationError) {
      return sendError(res, validationError);
    }
    
    // Try to get from cache first
    const cacheKey = "cricket:recent-scores";
    const cachedData = await getCache(cacheKey);
    
    if (cachedData) {
      // Apply limit/offset to cached data
      const allMatches = cachedData.data || [];
      const slicedMatches = allMatches.slice(offset, offset + limit);
      
      return res.json({
        ...cachedData,
        count: slicedMatches.length,
        total: allMatches.length,
        offset,
        limit,
        data: slicedMatches
      });
    }
    
    // Cache miss - fetch from source (limit to 30 matches for performance)
    const MAX_SCRAPE_LIMIT = 30;
    const matches = await scrapeCricbuzzMatches(urls.recentMatches, MAX_SCRAPE_LIMIT);
    const enrichedMatches = await enrichMatchesWithScorecard(matches);
    
    // Cache full response
    const fullResponse = {
      success: true,
      count: enrichedMatches.length,
      data: enrichedMatches,
    };
    await setCache(cacheKey, fullResponse, 3600);
    
    // Apply limit/offset for this request
    const slicedMatches = limit 
      ? enrichedMatches.slice(offset, offset + limit)
      : enrichedMatches.slice(offset);
    
    res.json({
      success: true,
      count: slicedMatches.length,
      total: enrichedMatches.length,
      offset,
      limit: limit || enrichedMatches.length,
      data: slicedMatches,
    });
  } catch (error) {
    console.error("Error fetching recent matches:", error.message);
    // Try to return cached data as fallback
    try {
      const cacheKey = "cricket:recent-scores";
      const staleCache = await getCache(cacheKey);
      if (staleCache) {
        console.log('Returning stale cache due to error');
        return res.json({ ...staleCache, stale: true, error_note: 'Serving cached data due to source error' });
      }
    } catch (cacheError) {
      console.error('Cache fallback failed:', cacheError.message);
    }
    return sendError(res, error);
  }
});

// Live Scores endpoint
router.get("/live-scores", async (req, res) => {
  try {
    setCacheHeaders(res, { maxAge: 30, staleWhileRevalidate: 15 });
    
    // Validate query parameters
    let limit, offset;
    try {
      const validated = validatePaginationParams(req.query, { defaultLimit: null, maxLimit: 50, allowNoLimit: true });
      limit = validated.limit;
      offset = validated.offset;
    } catch (validationError) {
      return sendError(res, validationError);
    }
    
    // Try to get from cache first
    const cacheKey = "cricket:live-scores";
    const cachedData = await getCache(cacheKey);
    
    if (cachedData) {
      // Apply limit/offset to cached data
      const allMatches = cachedData.data || [];
      const slicedMatches = limit 
        ? allMatches.slice(offset, offset + limit)
        : allMatches.slice(offset);
      
      return res.json({
        ...cachedData,
        count: slicedMatches.length,
        total: allMatches.length,
        offset,
        limit: limit || allMatches.length,
        data: slicedMatches
      });
    }
    
    // Cache miss - fetch from source
    const matches = await scrapeCricbuzzMatches(urls.liveScores);
    const enrichedMatches = await enrichMatchesWithScorecard(matches);

    // Cache full response
    const fullResponse = {
      success: true,
      count: enrichedMatches.length,
      data: enrichedMatches,
    };
    await setCache(cacheKey, fullResponse, 60);
    
    // Apply limit/offset for this request
    const slicedMatches = limit 
      ? enrichedMatches.slice(offset, offset + limit)
      : enrichedMatches.slice(offset);
    
    res.json({
      success: true,
      count: slicedMatches.length,
      total: enrichedMatches.length,
      offset,
      limit: limit || enrichedMatches.length,
      data: slicedMatches,
    });
  } catch (error) {
    console.error("Error fetching live scores:", error.message);
    // Try to return cached data as fallback
    try {
      const cacheKey = "cricket:live-scores";
      const staleCache = await getCache(cacheKey);
      if (staleCache) {
        console.log('Returning stale cache due to error');
        return res.json({ ...staleCache, stale: true, error_note: 'Serving cached data due to source error' });
      }
    } catch (cacheError) {
      console.error('Cache fallback failed:', cacheError.message);
    }
    return sendError(res, error);
  }
});

// Upcoming Matches endpoint
router.get("/upcoming-matches", async (req, res) => {
  try {
    setCacheHeaders(res, { maxAge: 120, staleWhileRevalidate: 60 });
    
    // Validate query parameters
    let limit, offset;
    try {
      const validated = validatePaginationParams(req.query, { defaultLimit: null, maxLimit: 50, allowNoLimit: true });
      limit = validated.limit;
      offset = validated.offset;
    } catch (validationError) {
      return sendError(res, validationError);
    }
    
    // Try to get from cache first
    const cacheKey = "cricket:upcoming-matches";
    const cachedData = await getCache(cacheKey);
    
    if (cachedData) {
      // Apply limit/offset to cached data
      const allMatches = cachedData.data || [];
      const slicedMatches = limit 
        ? allMatches.slice(offset, offset + limit)
        : allMatches.slice(offset);
      
      return res.json({
        ...cachedData,
        count: slicedMatches.length,
        total: allMatches.length,
        offset,
        limit: limit || allMatches.length,
        data: slicedMatches
      });
    }
    
    // Cache miss - fetch from source
    const matches = await scrapeCricbuzzMatches(urls.upcomingMatches);
    const enrichedMatches = await enrichMatchesWithScorecard(matches);

    // Cache full response
    const fullResponse = {
      success: true,
      count: enrichedMatches.length,
      data: enrichedMatches,
    };
    await setCache(cacheKey, fullResponse, 10800);
    
    // Apply limit/offset for this request
    const slicedMatches = limit 
      ? enrichedMatches.slice(offset, offset + limit)
      : enrichedMatches.slice(offset);
    
    res.json({
      success: true,
      count: slicedMatches.length,
      total: enrichedMatches.length,
      offset,
      limit: limit || enrichedMatches.length,
      data: slicedMatches,
    });
  } catch (error) {
    console.error("Error fetching upcoming matches:", error.message);
    // Try to return cached data as fallback
    try {
      const cacheKey = "cricket:upcoming-matches";
      const staleCache = await getCache(cacheKey);
      if (staleCache) {
        console.log('Returning stale cache due to error');
        return res.json({ ...staleCache, stale: true, error_note: 'Serving cached data due to source error' });
      }
    } catch (cacheError) {
      console.error('Cache fallback failed:', cacheError.message);
    }
    return sendError(res, error);
  }
});

// Cricket News endpoint with database storage for SEO
router.get("/news", async (req, res) => {
  try {
    // Cache for 30 min (data refreshes every 6 hours via GitHub Actions)
    setCacheHeaders(res, { maxAge: 1800, staleWhileRevalidate: 1800 });
    
    // Validate query parameters with consistent pagination
    let limit, offset;
    try {
      const validated = validatePaginationParams(req.query, { 
        defaultLimit: 10, 
        maxLimit: 50, 
        allowNoLimit: false 
      });
      limit = validated.limit;
      offset = validated.offset;
    } catch (validationError) {
      return sendError(res, validationError);
    }
    
    // Optional source filter (cricbuzz, espncricinfo, or all)
    const sourceFilter = req.query.source?.toLowerCase();
    const validSources = ['cricbuzz', 'espncricinfo', 'all'];
    if (sourceFilter && !validSources.includes(sourceFilter)) {
      return sendError(res, new ValidationError(`Invalid source. Must be one of: ${validSources.join(', ')}`));
    }
    
    const prisma = require("../../component/prismaClient");
    
    // Build where clause for source filtering
    const whereClause = {};
    if (sourceFilter && sourceFilter !== 'all') {
      whereClause.sourceName = sourceFilter === 'cricbuzz' ? 'Cricbuzz' : 'ESPN Cricinfo';
    }
    
    // Cache key includes limit, offset, and source for proper caching
    const cacheKey = `cricket:news:${limit}:${offset}:${sourceFilter || 'all'}`;
    
    // STEP 1: Try Redis cache first (fastest)
    const cachedData = await getCache(cacheKey);
    
    if (cachedData) {
      console.log(`✅ Returning news from Redis cache (limit=${limit}, offset=${offset})`);
      return res.json({ ...cachedData, source: 'redis' });
    }
    
    // STEP 2: Get total count for pagination metadata
    const totalCount = await prisma.newsArticle.count({
      where: whereClause
    });
    
    // STEP 3: Get paginated articles from database
    const articles = await prisma.newsArticle.findMany({
      where: whereClause,
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' }
    });
    
    // Build response with full pagination metadata
    const response = {
      success: true,
      count: articles.length,
      total: totalCount,
      offset,
      limit,
      hasMore: offset + articles.length < totalCount,
      data: articles,
      source: 'database',
      timestamp: new Date().toISOString()
    };
    
    // Cache in Redis for 30 minutes (1800 seconds)
    await setCache(cacheKey, response, 1800);
    
    return res.json(response);
  } catch (error) {
    console.error("Error fetching cricket news:", error.message);
    return sendError(res, error);
  }
});

// Get single article by slug (SEO endpoint)
router.get('/news/:slug', async (req, res) => {
  try {
    // Validate slug parameter
    let slug;
    try {
      slug = validateSlug(req.params.slug);
    } catch (validationError) {
      return sendError(res, validationError);
    }
    
    // Set cache headers (1 hour)
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400');
    
    const prisma = require("../../component/prismaClient");
    
    const article = await prisma.newsArticle.findFirst({
      where: { 
        slug: slug,
        sport: 'cricket'
      }
    });
    
    if (!article) {
      return sendError(res, new NotFoundError('Article'));
    }
    
    res.json({
      success: true,
      data: article
    });
  } catch (error) {
    console.error('Error fetching article:', error.message);
    return sendError(res, error);
  }
});

module.exports = router;
