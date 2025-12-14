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
        description: "Get latest cricket news articles from Cricbuzz",
        cacheTTL: "30 minutes",
        parameters: {
          limit: { type: "integer", required: false, default: 10, max: 20, description: "Maximum articles to return" }
        },
        response: {
          success: "boolean",
          count: "number",
          data: "array of news article objects",
          source: "string (database|scraped)"
        },
        example: `${baseUrl}/news?limit=5`
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
    
    // Parse query parameters - default to 20 for better performance
    const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 20), 50);
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    
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
    
    // Parse query parameters
    const limit = req.query.limit ? Math.min(Math.max(1, parseInt(req.query.limit) || 50), 50) : null;
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    
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
    
    // Parse query parameters
    const limit = req.query.limit ? Math.min(Math.max(1, parseInt(req.query.limit) || 50), 50) : null;
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    
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
    res.status(500).json({
      success: false,
      error: "Error fetching the webpage",
      message: error.message,
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
