const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const getScorecardDetails = require("./scorecard");
const { getCache, setCache } = require("../../component/redisClient");
const { parsePublishTime } = require("../../utils/timeParser");
const {
  fetchRankings,
  fetchStandings,
  fetchRecordFilters,
  fetchRecords,
  fetchPhotosList,
  fetchPhotoGallery,
  fetchImage,
  getRapidAPIQuota,
} = require("./stats");
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
  isRateLimited,
} = require("../../utils/apiErrors");
const scraperHealth = require("../../utils/scraper-health");

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
    version: "2.0.0",
    description:
      "Comprehensive cricket API featuring real-time scores, matches, news, stats, rankings, and photo galleries from Cricbuzz",
    baseUrl,
    lastUpdated: "2025-12-19",
    documentation: {
      note: "All endpoints return JSON responses with consistent structure",
      authentication: "No authentication required",
      rateLimit: "Rate limited at 30 requests per minute per IP",
      caching: "Responses are cached in Redis for optimal performance",
      errorHandling:
        "All errors return { success: false, error: { code, message, details, timestamp } }",
    },
    categories: {
      scores: ["/live-scores", "/recent-scores", "/upcoming-matches"],
      news: ["/news", "/news/:slug"],
      stats: [
        "/stats/rankings",
        "/stats/standings",
        "/stats/record-filters",
        "/stats/records",
      ],
      photos: ["/photos/list", "/photos/gallery/:galleryId", "/photos/image/*"],
    },
    endpoints: [
      {
        path: "/live-scores",
        method: "GET",
        category: "scores",
        description: "Get currently live cricket matches with real-time scores",
        cacheTTL: "30 seconds",
        parameters: {
          limit: {
            type: "integer",
            required: false,
            default: "all",
            max: 50,
            description: "Maximum matches to return",
          },
          offset: {
            type: "integer",
            required: false,
            default: 0,
            description: "Skip first N matches (for pagination)",
          },
        },
        response: {
          success: "boolean",
          count: "number (returned items)",
          total: "number (total available)",
          offset: "number",
          limit: "number",
          data: "array of match objects",
        },
        example: `${baseUrl}/live-scores?limit=5`,
      },
      {
        path: "/recent-scores",
        method: "GET",
        category: "scores",
        description:
          "Get recently completed cricket matches with final scores (optimized: max 30 scraped)",
        cacheTTL: "1 hour",
        parameters: {
          limit: {
            type: "integer",
            required: false,
            default: 20,
            max: 50,
            description: "Maximum matches to return (default: 20)",
          },
          offset: {
            type: "integer",
            required: false,
            default: 0,
            description: "Skip first N matches (for pagination)",
          },
        },
        response: {
          success: "boolean",
          count: "number",
          total: "number (max 30 due to scrape limit)",
          offset: "number",
          limit: "number",
          data: "array of match objects",
        },
        example: `${baseUrl}/recent-scores?limit=10`,
      },
      {
        path: "/upcoming-matches",
        method: "GET",
        category: "scores",
        description: "Get scheduled upcoming cricket matches with start times",
        cacheTTL: "3 hours",
        parameters: {
          limit: {
            type: "integer",
            required: false,
            default: "all",
            max: 50,
            description: "Maximum matches to return",
          },
          offset: {
            type: "integer",
            required: false,
            default: 0,
            description: "Skip first N matches (for pagination)",
          },
        },
        response: {
          success: "boolean",
          count: "number",
          total: "number",
          offset: "number",
          limit: "number",
          data: "array of match objects",
        },
        example: `${baseUrl}/upcoming-matches?limit=5&offset=0`,
      },
      {
        path: "/news",
        method: "GET",
        category: "news",
        description:
          "Get latest cricket news articles from database (Cricbuzz + ESPN Cricinfo)",
        cacheTTL: "30 minutes",
        parameters: {
          limit: {
            type: "integer",
            required: false,
            default: 10,
            max: 50,
            description: "Maximum articles to return",
          },
          offset: {
            type: "integer",
            required: false,
            default: 0,
            description: "Skip first N articles (for pagination)",
          },
          source: {
            type: "string",
            required: false,
            default: "all",
            enum: ["cricbuzz", "espncricinfo", "all"],
            description: "Filter by news source",
          },
        },
        response: {
          success: "boolean",
          count: "number (returned items)",
          total: "number (total available)",
          offset: "number",
          limit: "number",
          hasMore: "boolean (more articles available)",
          data: "array of news article objects",
          source: "string (database|redis)",
        },
        example: `${baseUrl}/news?limit=10&offset=0&source=all`,
      },
      {
        path: "/news/:slug",
        method: "GET",
        category: "news",
        description: "Get single news article by slug (ID)",
        cacheTTL: "1 hour",
        parameters: {
          slug: {
            type: "string",
            required: true,
            location: "path",
            description: "Article unique identifier",
          },
        },
        response: {
          success: "boolean",
          data: "news article object with full content",
        },
        example: `${baseUrl}/news/136890`,
      },
      {
        path: "/stats/rankings",
        method: "GET",
        category: "stats",
        description: "Get ICC player/team rankings (via RapidAPI)",
        cacheTTL: "24 hours",
        parameters: {
          category: {
            type: "string",
            required: true,
            enum: ["batsmen", "bowlers", "allrounders", "teams"],
            description: "Ranking category",
          },
          formatType: {
            type: "string",
            required: true,
            enum: ["test", "odi", "t20"],
            description: "Match format",
          },
        },
        response: {
          success: "boolean",
          data: "object - Rankings data from Cricbuzz",
          cached: "boolean",
        },
        example: `${baseUrl}/stats/rankings?category=batsmen&formatType=test`,
      },
      {
        path: "/stats/standings",
        method: "GET",
        category: "stats",
        description: "Get ICC championship standings (via RapidAPI)",
        cacheTTL: "24 hours",
        parameters: {
          matchType: {
            type: "string",
            required: true,
            enum: ["1", "2"],
            description: "1=World Test Championship, 2=World Cup Super League",
          },
        },
        response: {
          success: "boolean",
          data: "object - Standings data",
          cached: "boolean",
        },
        example: `${baseUrl}/stats/standings?matchType=1`,
      },
      {
        path: "/stats/record-filters",
        method: "GET",
        category: "stats",
        description:
          "Get available filter options for cricket records (via RapidAPI)",
        cacheTTL: "24 hours",
        response: {
          success: "boolean",
          data: "object - Filter options",
          cached: "boolean",
        },
        example: `${baseUrl}/stats/record-filters`,
      },
      {
        path: "/stats/records",
        method: "GET",
        category: "stats",
        description: "Get cricket records/stats (via RapidAPI)",
        cacheTTL: "24 hours",
        parameters: {
          statsType: {
            type: "string",
            required: true,
            description:
              "Stats type: mostRuns, mostWickets, highestScore, etc.",
          },
          id: {
            type: "integer",
            required: false,
            default: 0,
            description: "Stats ID (pagination)",
          },
        },
        response: {
          success: "boolean",
          data: "object - Records data with filters and values",
          cached: "boolean",
        },
        example: `${baseUrl}/stats/records?statsType=mostRuns`,
      },
      {
        path: "/photos/list",
        method: "GET",
        category: "photos",
        description:
          "Get list of photo galleries from Cricbuzz featuring match highlights, player photos, and event coverage",
        cacheTTL: "1 hour",
        parameters: {},
        response: {
          success: "boolean - Indicates if the request was successful",
          data: {
            photoGalleryInfoList: "array - List of gallery items",
            appIndex: "object - SEO metadata including title and description",
          },
          source: "string - Data source (rapidapi)",
          cached: "boolean - Whether response was served from cache",
          timestamp: "string - ISO timestamp of the response",
        },
        responseExample: {
          success: true,
          data: {
            photoGalleryInfoList: [
              {
                photoGalleryInfo: {
                  galleryId: 6064,
                  headline: "India vs South Africa, 2025 - 2nd ODI, Raipur",
                  imageId: 791826,
                  publishedTime: "1764782490515",
                  imageHash: "363badb0a608ba8a3e10c0d7e682b169",
                },
              },
            ],
          },
        },
        example: `${baseUrl}/photos/list`,
      },
      {
        path: "/photos/gallery/:galleryId",
        method: "GET",
        category: "photos",
        description:
          "Get specific photo gallery details including all photos, captions, and associated tags (teams, series, matches)",
        cacheTTL: "1 hour",
        parameters: {
          galleryId: {
            type: "integer",
            required: true,
            location: "path",
            description:
              "Unique gallery identifier (numeric). Get gallery IDs from /photos/list endpoint",
            example: "6064",
          },
        },
        response: {
          success: "boolean",
          data: {
            photoGalleryDetails:
              "array - List of photos with imageId, caption, and imageHash",
            tags: "array - Associated tags (series, match, teams) with itemName, itemType, itemId",
            headline: "string - Gallery title",
            intro: "string - Gallery description",
            publishedTime: "string - Unix timestamp of publication",
            appIndex: "object - SEO metadata with webURL for the gallery page",
          },
          cached: "boolean",
        },
        responseExample: {
          success: true,
          data: {
            photoGalleryDetails: [
              {
                imageId: 791826,
                caption: "Ruturaj Gaikwad registered his maiden ODI hundred",
                imageHash: "363badb0a608ba8a3e10c0d7e682b169",
              },
            ],
            tags: [
              {
                itemName: "South Africa tour of India, 2025",
                itemType: "series",
                itemId: "9638",
              },
              { itemName: "India", itemType: "team", itemId: "2" },
            ],
            headline: "India vs South Africa, 2025 - 2nd ODI, Raipur",
          },
        },
        errors: {
          VALIDATION_ERROR: "Gallery ID must be a valid number",
        },
        example: `${baseUrl}/photos/gallery/6064`,
      },
      {
        path: "/photos/image/*",
        method: "GET",
        category: "photos",
        description:
          "Proxy endpoint to fetch and cache images from Cricbuzz CDN. Returns binary image data with appropriate headers. Use this to avoid CORS issues when displaying Cricbuzz images in web applications.",
        cacheTTL: "7 days",
        parameters: {
          "*": {
            type: "string",
            required: true,
            location: "path",
            description: "Image path in format: i1/c{imageId}/i.jpg",
            examples: ["i1/c791826/i.jpg - Standard image format"],
            note: "Currently only i1 size is supported by the Cricbuzz API",
          },
        },
        response: "Binary image data (JPEG/PNG) with Content-Type header",
        headers: {
          "Content-Type": "image/jpeg or image/png based on image format",
          "Cache-Control":
            "public, max-age=604800, stale-while-revalidate=86400",
          "X-Cache": "HIT or MISS indicating cache status",
        },
        usage: {
          inHTML: `<img src="${baseUrl}/photos/image/i1/c791826/i.jpg" alt="Cricket photo" />`,
          constructFromGallery:
            "Use imageId from gallery response: /photos/image/i1/c{imageId}/i.jpg",
        },
        errors: {
          VALIDATION_ERROR: "Invalid image path format",
          NOT_FOUND: "Image not found (404)",
        },
        example: `${baseUrl}/photos/image/i1/c791826/i.jpg`,
      },
    ],
    dataModels: {
      matchObject: {
        description: "Structure of match objects returned by score endpoints",
        fields: {
          title:
            "string - Full match title (e.g., 'India vs Australia, 2nd Test')",
          matchLink: "string - URL to match page on Cricbuzz",
          matchDetails: "string - Match description",
          status: "string - Current match status from page",
          matchStatus:
            "string - Match state: 'completed', 'live', or 'upcoming'",
          result:
            "string - Match result (only for completed matches, e.g., 'India won by 7 wkts')",
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
          scorecard: "object - Detailed scorecard (when available)",
          // Enhanced fields
          matchFormat:
            "string - Match format (e.g., '3rd Test', 'T20I', 'ODI')",
          matchNumberInfo: "string - Match number in series",
          venue: "string - Stadium/venue name",
          day: "number - Day number for Test matches (1-5)",
          session: "number - Session number for Test matches (1-3)",
          target: "number - Target score for chasing team",
          lead: "number - Lead by runs (if applicable)",
          trail: "number - Trail by runs (if applicable)",
          winner: "string - Winner team name (for completed matches)",
        },
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
          sourceName: "string - Source website name",
        },
      },
      photoGalleryObject: {
        description: "Structure of photo gallery list items from /photos/list",
        fields: {
          galleryId:
            "integer - Unique gallery identifier, use with /photos/gallery/:galleryId",
          headline: "string - Gallery title describing the event/match",
          imageId:
            "integer - Cover image ID, use with /photos/image/i1/c{imageId}/i.jpg",
          publishedTime: "string - Unix timestamp in milliseconds",
          imageHash: "string - Hash for image validation/caching",
        },
      },
      photoObject: {
        description: "Structure of individual photo objects within a gallery",
        fields: {
          imageId: "integer - Unique image identifier",
          caption: "string - Description of what the photo shows",
          imageHash: "string - Hash for image validation",
        },
        imageUrlConstruction: {
          description: "How to construct image URLs from imageId",
          format: "/photos/image/i1/c{imageId}/i.jpg",
          note: "Currently only i1 format is supported by the Cricbuzz API",
        },
      },
    },
    errorCodes: {
      VALIDATION_ERROR: "Invalid or missing required parameters",
      NOT_FOUND: "Requested resource not found",
      RATE_LIMIT_ERROR: "Too many requests, please slow down",
      SCRAPING_ERROR: "Failed to fetch data from source",
      TIMEOUT_ERROR: "Request timed out",
      SERVICE_UNAVAILABLE: "External API is temporarily unavailable",
    },
    examples: {
      scores: {
        pagination: `${baseUrl}/live-scores?limit=5&offset=10`,
        allLiveMatches: `${baseUrl}/live-scores`,
        firstFiveUpcoming: `${baseUrl}/upcoming-matches?limit=5`,
        recentWithPagination: `${baseUrl}/recent-scores?limit=10&offset=5`,
      },
      news: {
        latestNews: `${baseUrl}/news?limit=10`,
        cricbuzzOnly: `${baseUrl}/news?source=cricbuzz`,
        singleArticle: `${baseUrl}/news/136890`,
      },
      stats: {
        testBatsmen: `${baseUrl}/stats/rankings?category=batsmen&formatType=test`,
        wtcStandings: `${baseUrl}/stats/standings?matchType=1`,
        mostRuns: `${baseUrl}/stats/records?statsType=mostRuns`,
      },
      photos: {
        allGalleries: `${baseUrl}/photos/list`,
        specificGallery: `${baseUrl}/photos/gallery/6064`,
        image: `${baseUrl}/photos/image/i1/c791826/i.jpg`,
      },
    },
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
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      timeout: 10000,
    });
  } catch (error) {
    throw handleAxiosError(error, "Cricbuzz scraping");
  }

  const html = response.data;

  // Check for rate limiting in response
  if (isRateLimited(response, html)) {
    throw new RateLimitError("Cricbuzz", 60);
  }

  // Check if we got valid HTML
  if (!html || typeof html !== "string" || html.length < 1000) {
    throw new ScrapingError(
      "Received empty or invalid response from Cricbuzz",
      "Cricbuzz"
    );
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
        if (content && content.includes("SportsEvent")) {
          const jsonData = JSON.parse(content);

          // Helper function to extract SportsEvent data
          const extractSportsEvents = (items) => {
            if (!Array.isArray(items)) return;
            for (const item of items) {
              if (item["@type"] === "SportsEvent") {
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
          if (
            jsonData["@type"] === "WebPage" &&
            jsonData.mainEntity?.itemListElement
          ) {
            extractSportsEvents(jsonData.mainEntity.itemListElement);
          }
          // Handle ItemList containing SportsEvents
          if (jsonData["@type"] === "ItemList" && jsonData.itemListElement) {
            extractSportsEvents(jsonData.itemListElement);
          }
          // Handle direct SportsEvent
          if (jsonData["@type"] === "SportsEvent") {
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

    // Also extract from embedded RSC payload - look for SportsEvent pattern with competitors
    // Use a broader regex to capture the full SportsEvent object including competitor teams
    const sportsEventPattern =
      /"@type":"SportsEvent","name":"([^"]+)"[^]*?"competitor":\[([^\]]+)\][^]*?"startDate":"([^"]+)"[^]*?"eventStatus":"([^"]+)"/g;
    let eventMatch;
    while ((eventMatch = sportsEventPattern.exec(html)) !== null) {
      const name = eventMatch[1];
      const competitorBlock = eventMatch[2];
      const startDate = eventMatch[3];
      const status = eventMatch[4];

      // Extract team names from competitor block
      const teamNames = [];
      const teamPattern = /"name":"([^"]+)"/g;
      let teamMatch;
      while ((teamMatch = teamPattern.exec(competitorBlock)) !== null) {
        teamNames.push(teamMatch[1].toLowerCase());
      }

      if (name && (startDate || status)) {
        matchTimeMap.set(name, {
          startDate: startDate || null,
          status: status || null,
          teams: teamNames, // Store team names for validation
        });
      }
    }

    // Fallback: simpler pattern without competitors (for cases where competitor is missing)
    const simpleSportsEvents = html.match(
      /"@type":"SportsEvent","name":"([^"]+)"[^}]*?"startDate":"([^"]+)"[^}]*?"eventStatus":"([^"]+)"/g
    );
    if (simpleSportsEvents) {
      for (const eventStr of simpleSportsEvents) {
        const nameMatch = eventStr.match(/"name":"([^"]+)"/);
        const dateMatch = eventStr.match(/"startDate":"([^"]+)"/);
        const statusMatch = eventStr.match(/"eventStatus":"([^"]+)"/);
        if (
          nameMatch &&
          (dateMatch || statusMatch) &&
          !matchTimeMap.has(nameMatch[1])
        ) {
          matchTimeMap.set(nameMatch[1], {
            startDate: dateMatch ? dateMatch[1] : null,
            status: statusMatch ? statusMatch[1] : null,
            teams: [], // No teams available
          });
        }
      }
    }

    console.log(`Found ${matchTimeMap.size} match times from page data`);
  } catch (e) {
    console.log("Time extraction error (non-critical):", e.message);
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

    // === ENHANCED DATA EXTRACTION ===

    // Extract match format (Test, ODI, T20, T10)
    const formatMatch = title.match(
      /(\d+(?:st|nd|rd|th)?\s*(?:Test|T20I?|ODI|T10))/i
    );
    match.matchFormat = formatMatch ? formatMatch[1] : null;

    // Extract venue from location (e.g., "3rd Test • Adelaide, Adelaide Oval")
    const locationParts = match.location.split("•").map((s) => s.trim());
    match.matchNumberInfo = locationParts[0] || null;
    match.venue = locationParts[1] || match.location;

    // Parse commentary for day/session (Test matches)
    const dayMatch = match.liveCommentary.match(/Day\s*(\d+)/i);
    match.day = dayMatch ? parseInt(dayMatch[1]) : null;

    const sessionMatch = match.liveCommentary.match(
      /(\d+)(?:st|nd|rd|th)?\s*Session/i
    );
    match.session = sessionMatch ? parseInt(sessionMatch[1]) : null;

    // Parse target/lead/trail/need from commentary
    const targetMatch = match.liveCommentary.match(
      /(?:need|require|target)[:\s]+(\d+)/i
    );
    match.target = targetMatch ? parseInt(targetMatch[1]) : null;

    const leadMatch = match.liveCommentary.match(/lead\s+(?:by\s+)?(\d+)/i);
    match.lead = leadMatch ? parseInt(leadMatch[1]) : null;

    const trailMatch = match.liveCommentary.match(/trail\s+(?:by\s+)?(\d+)/i);
    match.trail = trailMatch ? parseInt(trailMatch[1]) : null;

    // Parse winner from result (for completed matches)
    const winnerMatch = match.liveCommentary.match(/^(.+?)\s+won\b/i);
    match.winner = winnerMatch ? winnerMatch[1].trim() : null;

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
    // JSON-LD names are like "3rd Test, The Ashes, 2025-26"
    // Scraped titles are like "Australia vs England, 3rd Test"
    // Match by: 1) match description (e.g., "3rd Test") AND 2) team name validation
    let timeInfo = null;

    // Extract match number/description from scraped data
    const matchDescParts = match.matchDetails?.split(",") || [];
    const matchNumber = matchDescParts
      .find((part) =>
        /\d+(st|nd|rd|th)\s+(match|test|odi|t20)/i.test(part.trim())
      )
      ?.trim();

    // Helper to check if scraped teams match JSON-LD teams
    const teamsMatch = (scrapedTeams, jsonLdTeams) => {
      if (!jsonLdTeams || jsonLdTeams.length === 0) return false; // No teams = can't validate
      if (!scrapedTeams || scrapedTeams.length === 0) return false;

      // Check if at least one scraped team matches a JSON-LD team
      const scrapedLower = scrapedTeams.map((t) => t.toLowerCase());
      return jsonLdTeams.some((jsonTeam) =>
        scrapedLower.some(
          (scraped) => scraped.includes(jsonTeam) || jsonTeam.includes(scraped)
        )
      );
    };

    // Try to match by match description AND team validation
    for (const [eventName, value] of matchTimeMap) {
      // Check if the event name contains the match number (e.g., "3rd Test")
      const descriptionMatches =
        matchNumber &&
        eventName.toLowerCase().includes(matchNumber.toLowerCase());

      // Also check if scraped matchDetails contains the key parts of event name
      const eventParts = eventName.split(",");
      const eventPartMatches =
        eventParts.length > 0 &&
        match.matchDetails?.includes(eventParts[0].trim());

      if (descriptionMatches || eventPartMatches) {
        // CRITICAL FIX: Validate team names before assigning
        // This prevents "NZ vs WI, 3rd Test" from matching "AUS vs ENG, 3rd Test" data
        if (teamsMatch(match.teams, value.teams)) {
          timeInfo = value;
          break;
        }
        // If teams don't match, continue searching for correct match
      }
    }

    // Helper to detect if a string is a match result (not a start time)
    const isMatchResult = (str) => {
      if (!str) return false;
      const resultPatterns = [
        /won by/i, // "India won by 7 wkts"
        /\bdrawn?\b/i, // "Match drawn"
        /\btied?\b/i, // "Match tied"
        /no result/i, // "No result"
        /abandoned/i, // "Match abandoned"
        /cancelled/i, // "Match cancelled"
        /innings (and|&)/i, // "won by an innings and 35 runs"
        /\d+\s*(wkts?|wickets?|runs?)/i, // "7 wkts", "35 runs"
      ];
      return resultPatterns.some((pattern) => pattern.test(str));
    };

    // Helper to detect if a string is a live match status
    const isLiveStatus = (str) => {
      if (!str) return false;
      const livePatterns = [
        /\blive\b/i,
        /day \d+/i, // "Day 1", "Day 2"
        /session/i, // "1st Session"
        /innings break/i,
        /tea\b|lunch\b|stumps/i,
        /at (bat|crease)/i,
        /opt to (bat|bowl)/i, // Toss result - match just started
        /trail by|lead by/i, // Ongoing multi-day match
        /\bneed\s+\d+\s+runs?\b/i, // Chasing team needs runs
      ];
      return livePatterns.some((pattern) => pattern.test(str));
    };

    if (timeInfo && timeInfo.status) {
      const statusStr = timeInfo.status;

      // IMPORTANT: Check if this is a LIVE match status FIRST
      // This prevents "Day 4: Stumps - England need 228 runs" from being marked as completed
      // because "228 runs" would match the result pattern otherwise
      if (isLiveStatus(statusStr)) {
        match.matchStatus = "live";
        match.result = statusStr; // Store as result for display
        match.time = "LIVE";
        match.matchStartTime = {
          startDateISO: timeInfo.startDate || null,
          status: statusStr,
        };
      }
      // Then check if this is a completed match result
      else if (isMatchResult(statusStr)) {
        match.result = statusStr;
        match.matchStatus = "completed";
        // For completed matches, use the ISO date if available, otherwise mark time as N/A
        if (timeInfo.startDate) {
          match.matchStartTime = {
            startDateISO: timeInfo.startDate,
            note: "Match completed",
          };
          // Try to format a readable time from ISO date
          try {
            const startDate = new Date(timeInfo.startDate);
            match.time = startDate.toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            });
          } catch (e) {
            match.time = "Completed";
          }
        } else {
          match.time = "Completed";
          match.matchStartTime = { note: "Match completed" };
        }
      }
      // Parse "Match starts at Dec 15, 08:15 GMT" format for upcoming matches
      else {
        const matchStartsMatch = statusStr.match(
          /Match starts at\s+(?:([A-Za-z]+\s+\d{1,2}),?\s+)?(\d{1,2}:\d{2})\s*(GMT|IST|Local)?/i
        );
        if (matchStartsMatch) {
          const datePart = matchStartsMatch[1] || "";
          const timePart = matchStartsMatch[2];
          const tzPart = matchStartsMatch[3] || "GMT";
          match.time = datePart
            ? `${datePart}, ${timePart} ${tzPart}`
            : `${timePart} ${tzPart}`;
          match.matchStatus = "upcoming";
          match.matchStartTime = {
            date: datePart || null,
            time: timePart,
            timezone: tzPart,
            startDateISO: timeInfo.startDate,
            raw: statusStr,
          };
        } else {
          // Unknown status format - store as-is but in appropriate field
          match.time = statusStr;
          match.matchStartTime = {
            startDateISO: timeInfo.startDate,
            raw: statusStr,
          };
        }
      }
    } else if (match.liveCommentary) {
      // Fallback: try to extract from liveCommentary

      // IMPORTANT: Check live status FIRST (same fix as above)
      if (isLiveStatus(match.liveCommentary)) {
        match.result = match.liveCommentary;
        match.matchStatus = "live";
        match.time = "LIVE";
      }
      // Then check if it's a completed result
      else if (isMatchResult(match.liveCommentary)) {
        match.result = match.liveCommentary;
        match.matchStatus = "completed";
        match.time = "Completed";
      }
      // Try to parse start time
      else {
        const matchStartsMatch = match.liveCommentary.match(
          /Match starts at\s+(?:([A-Za-z]+\s+\d{1,2}),?\s+)?(\d{1,2}:\d{2})\s*(GMT|IST|Local)?/i
        );
        if (matchStartsMatch) {
          const datePart = matchStartsMatch[1] || "";
          const timePart = matchStartsMatch[2];
          const tzPart = matchStartsMatch[3] || "GMT";
          match.time = datePart
            ? `${datePart}, ${timePart} ${tzPart}`
            : `${timePart} ${tzPart}`;
          match.matchStatus = "upcoming";
          match.matchStartTime = {
            date: datePart || null,
            time: timePart,
            timezone: tzPart,
            raw: match.liveCommentary,
          };
        } else {
          // Bug #3 fix: Default to 'live' for /live-scores endpoint
          match.time = "N/A";
          match.matchStatus = "live";
        }
      }
    } else {
      // Bug #3 fix: Ensure matchStatus is never null
      match.time = "N/A";
      match.matchStatus = "live";
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
    maxAge = 60, // Edge cache time in seconds
    staleWhileRevalidate = 30, // Stale content serving time
    mustRevalidate = false, // Force revalidation
  } = options;

  const cacheControl = [
    "public",
    `s-maxage=${maxAge}`,
    `stale-while-revalidate=${staleWhileRevalidate}`,
  ];

  if (mustRevalidate) {
    cacheControl.push("must-revalidate");
  }

  res.setHeader("Cache-Control", cacheControl.join(", "));
  res.setHeader("Vary", "Accept-Encoding"); // Important for compressed responses
  res.setHeader("X-Content-Type-Options", "nosniff");
};

// Recent Scores endpoint (optimized: default 20, max scrape 30)
router.get("/recent-scores", async (req, res) => {
  try {
    setCacheHeaders(res, { maxAge: 60, staleWhileRevalidate: 30 });

    // Validate query parameters
    let limit, offset;
    try {
      const validated = validatePaginationParams(req.query, {
        defaultLimit: 20,
        maxLimit: 50,
        allowNoLimit: false,
      });
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
        data: slicedMatches,
      });
    }

    // Cache miss - fetch from source (limit to 30 matches for performance)
    const MAX_SCRAPE_LIMIT = 30;
    const matches = await scrapeCricbuzzMatches(
      urls.recentMatches,
      MAX_SCRAPE_LIMIT
    );
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
        console.log("Returning stale cache due to error");
        return res.json({
          ...staleCache,
          stale: true,
          error_note: "Serving cached data due to source error",
        });
      }
    } catch (cacheError) {
      console.error("Cache fallback failed:", cacheError.message);
    }
    return sendError(res, error);
  }
});

// Live Scores endpoint
// Supports ?full=true for full payload with embedded scorecards (backward compatible)
// Default: returns lite data without scorecards (~10x smaller payload)
router.get("/live-scores", async (req, res) => {
  try {
    setCacheHeaders(res, { maxAge: 30, staleWhileRevalidate: 15 });

    // Validate query parameters
    let limit, offset;
    try {
      const validated = validatePaginationParams(req.query, {
        defaultLimit: null,
        maxLimit: 50,
        allowNoLimit: true,
      });
      limit = validated.limit;
      offset = validated.offset;
    } catch (validationError) {
      return sendError(res, validationError);
    }

    const wantsFull = req.query.full === "true";

    // Import redis-client for tiered data
    let redisClient;
    try {
      redisClient = require("../../utils/redis-client");
    } catch (e) {
      // Fallback to legacy if redis-client not available
      redisClient = null;
    }

    if (redisClient) {
      if (wantsFull) {
        // FULL MODE: Return complete data with embedded scorecards
        const redisCached = await redisClient.getLiveScores();
        if (redisCached && redisCached.data) {
          const allMatches = redisCached.data;
          const slicedMatches = limit
            ? allMatches.slice(offset, offset + limit)
            : allMatches.slice(offset);

          return res.json({
            success: true,
            count: slicedMatches.length,
            total: allMatches.length,
            offset,
            limit: limit || allMatches.length,
            data: slicedMatches,
            fromCache: true,
            cacheSource: "redis-full",
            cacheAgeSeconds: Math.round(
              (Date.now() - redisCached.timestamp) / 1000
            ),
          });
        }
      } else {
        // LITE MODE (default): Return match list without scorecards
        const liteCached = await redisClient.getLiteScores();
        if (liteCached && liteCached.data) {
          const allMatches = liteCached.data;
          const slicedMatches = limit
            ? allMatches.slice(offset, offset + limit)
            : allMatches.slice(offset);

          return res.json({
            success: true,
            count: slicedMatches.length,
            total: allMatches.length,
            offset,
            limit: limit || allMatches.length,
            data: slicedMatches,
            fromCache: true,
            cacheSource: "redis-lite",
            cacheAgeSeconds: Math.round(
              (Date.now() - liteCached.timestamp) / 1000
            ),
            hint: "Use ?full=true for embedded scorecards, or fetch /scorecard/:matchId individually",
          });
        }

        // Fallback to full data if lite is not available
        const redisCached = await redisClient.getLiveScores();
        if (redisCached && redisCached.data) {
          // Strip scorecards from full data
          const liteData = redisCached.data.map((match) => {
            const { scorecard, ...liteMatch } = match;
            if (match.matchId && scorecard) {
              liteMatch.scorecardUrl = `/api/cricket/scorecard/${match.matchId}`;
              liteMatch.hasScorecard = true;
            } else {
              liteMatch.hasScorecard = false;
            }
            return liteMatch;
          });

          const slicedMatches = limit
            ? liteData.slice(offset, offset + limit)
            : liteData.slice(offset);

          return res.json({
            success: true,
            count: slicedMatches.length,
            total: liteData.length,
            offset,
            limit: limit || liteData.length,
            data: slicedMatches,
            fromCache: true,
            cacheSource: "redis-full-stripped",
            cacheAgeSeconds: Math.round(
              (Date.now() - redisCached.timestamp) / 1000
            ),
            hint: "Use ?full=true for embedded scorecards, or fetch /scorecard/:matchId individually",
          });
        }
      }
    }

    // Fallback to legacy cache if Redis tiered data not available
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
        data: slicedMatches,
        cacheSource: "legacy-cache",
      });
    }

    // Cache miss - fetch from source (fallback scrape)
    const matches = await scrapeCricbuzzMatches(urls.liveScores);
    const enrichedMatches = await enrichMatchesWithScorecard(matches);

    // Cache full response
    const fullResponse = {
      success: true,
      count: enrichedMatches.length,
      data: enrichedMatches,
    };
    await setCache(cacheKey, fullResponse, 30);

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
      cacheSource: "fallback-scrape",
    });

    // Record success for health monitoring
    scraperHealth.recordSuccess("liveScores", Date.now());
  } catch (error) {
    console.error("Error fetching live scores:", error.message);

    // Record failure for health monitoring (may trigger Discord alert)
    await scraperHealth.recordFailure("liveScores", error, 0);
    // Try to return cached data as fallback
    try {
      const cacheKey = "cricket:live-scores";
      const staleCache = await getCache(cacheKey);
      if (staleCache) {
        console.log("Returning stale cache due to error");
        return res.json({
          ...staleCache,
          stale: true,
          error_note: "Serving cached data due to source error",
        });
      }
    } catch (cacheError) {
      console.error("Cache fallback failed:", cacheError.message);
    }
    return sendError(res, error);
  }
});

// Live Scores Worker Status endpoint (for monitoring)
router.get("/live-scores/worker-status", async (req, res) => {
  try {
    // Import redis-client dynamically to avoid breaking if not configured
    let redisClient;
    try {
      redisClient = require("../../utils/redis-client");
    } catch (e) {
      return res.json({
        success: true,
        worker: {
          status: "not-configured",
          message: "Redis client not available",
        },
        cache: { available: false },
      });
    }

    const status = await redisClient.getWorkerStatus();
    const cache = await redisClient.getLiveScores();

    res.json({
      success: true,
      worker: status || {
        status: "unknown",
        message: "No worker status found - worker may not be running",
      },
      cache: cache
        ? {
            available: true,
            matchCount: cache.count,
            ageSeconds: Math.round((Date.now() - cache.timestamp) / 1000),
          }
        : {
            available: false,
            message: "No cached data - worker may not be running",
          },
    });
  } catch (error) {
    console.error("Error fetching worker status:", error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Individual scorecard endpoint - fetches scorecard for a single match
// This allows clients to load scorecards on-demand instead of all at once
router.get("/scorecard/:matchId", async (req, res) => {
  const startTime = Date.now();
  const { matchId } = req.params;

  // Validate matchId
  if (!matchId || !/^\d+$/.test(matchId)) {
    return res.status(400).json({
      success: false,
      error: "Invalid matchId",
      message: "matchId must be a numeric string",
      responseTime: Date.now() - startTime,
    });
  }

  try {
    // Import redis-client dynamically
    let redisClient;
    try {
      redisClient = require("../../utils/redis-client");
    } catch (e) {
      return res.status(503).json({
        success: false,
        error: "Service unavailable",
        message: "Redis client not available",
        responseTime: Date.now() - startTime,
      });
    }

    // Try Redis cache first
    const cached = await redisClient.getMatchScorecard(matchId);
    if (cached) {
      return res.json({
        success: true,
        matchId,
        data: cached,
        fromCache: true,
        cacheSource: "redis",
        cacheAgeSeconds: Math.round((Date.now() - cached.timestamp) / 1000),
        responseTime: Date.now() - startTime,
      });
    }

    // Fallback: Try to find in full cache
    const fullCache = await redisClient.getLiveScores();
    if (fullCache && fullCache.data) {
      const match = fullCache.data.find((m) => m.matchId === matchId);
      if (match && match.scorecard) {
        return res.json({
          success: true,
          matchId,
          data: {
            matchId,
            title: match.title,
            teams: match.teams,
            innings: match.scorecard,
            timestamp: fullCache.timestamp,
          },
          fromCache: true,
          cacheSource: "redis-full-fallback",
          responseTime: Date.now() - startTime,
        });
      }
    }

    // Scorecard not found
    return res.status(404).json({
      success: false,
      error: "Scorecard not found",
      message: `No scorecard available for matchId: ${matchId}`,
      responseTime: Date.now() - startTime,
    });
  } catch (error) {
    console.error(`Error fetching scorecard for ${matchId}:`, error.message);
    res.status(500).json({
      success: false,
      error: "Error fetching scorecard",
      message: error.message,
      responseTime: Date.now() - startTime,
    });
  }
});

// Upcoming Matches endpoint
router.get("/upcoming-matches", async (req, res) => {
  try {
    setCacheHeaders(res, { maxAge: 120, staleWhileRevalidate: 60 });

    // Validate query parameters
    let limit, offset;
    try {
      const validated = validatePaginationParams(req.query, {
        defaultLimit: null,
        maxLimit: 50,
        allowNoLimit: true,
      });
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
        data: slicedMatches,
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
        console.log("Returning stale cache due to error");
        return res.json({
          ...staleCache,
          stale: true,
          error_note: "Serving cached data due to source error",
        });
      }
    } catch (cacheError) {
      console.error("Cache fallback failed:", cacheError.message);
    }
    return sendError(res, error);
  }
});

// Cricket News endpoint with database storage for SEO
router.get("/news", async (req, res) => {
  try {
    // Cache for 5 min (data refreshes every 6 hours via VPS cron)
    setCacheHeaders(res, { maxAge: 300, staleWhileRevalidate: 600 });

    // Validate query parameters with consistent pagination
    let limit, offset;
    try {
      const validated = validatePaginationParams(req.query, {
        defaultLimit: 10,
        maxLimit: 50,
        allowNoLimit: false,
      });
      limit = validated.limit;
      offset = validated.offset;
    } catch (validationError) {
      return sendError(res, validationError);
    }

    // Optional source filter (cricbuzz, espncricinfo, icc, or all)
    const sourceFilter = req.query.source?.toLowerCase();
    const validSources = ["cricbuzz", "espncricinfo", "espn", "icc", "all"];
    if (sourceFilter && !validSources.includes(sourceFilter)) {
      return sendError(
        res,
        new ValidationError(
          `Invalid source. Must be one of: ${validSources.join(", ")}`
        )
      );
    }

    // Optional search query
    const searchQuery = req.query.search?.trim();

    // Optional tag filter
    const tagFilter = req.query.tag?.trim();

    // Optional sort (newest, oldest)
    const sortOrder = req.query.sort?.toLowerCase() || "newest";
    if (!["newest", "oldest"].includes(sortOrder)) {
      return sendError(
        res,
        new ValidationError("Invalid sort. Must be 'newest' or 'oldest'")
      );
    }

    const prisma = require("../../component/prismaClient");

    // Build where clause for filtering
    const whereClause = {};

    // Source filtering
    if (sourceFilter && sourceFilter !== "all") {
      if (sourceFilter === "espn" || sourceFilter === "espncricinfo") {
        whereClause.sourceName = "ESPN Cricinfo";
      } else if (sourceFilter === "icc") {
        whereClause.sourceName = "ICC Cricket";
      } else {
        whereClause.sourceName = "Cricbuzz";
      }
    }

    // Search in title and content
    if (searchQuery) {
      whereClause.OR = [
        { title: { contains: searchQuery, mode: "insensitive" } },
        { description: { contains: searchQuery, mode: "insensitive" } },
        { content: { contains: searchQuery, mode: "insensitive" } },
      ];
    }

    // Tag filtering
    if (tagFilter) {
      whereClause.tags = { has: tagFilter };
    }

    // Cache key includes all filter params
    const cacheKey = `cricket:news:${limit}:${offset}:${
      sourceFilter || "all"
    }:${searchQuery || ""}:${tagFilter || ""}:${sortOrder}`;

    // STEP 1: Try Redis cache first (fastest)
    const cachedData = await getCache(cacheKey);

    if (cachedData) {
      console.log(`✅ Returning news from Redis cache`);
      return res.json({ ...cachedData, source: "redis" });
    }

    // STEP 2: Get total count for pagination metadata
    const totalCount = await prisma.newsArticle.count({
      where: whereClause,
    });

    // STEP 3: Get paginated articles from database
    const articles = await prisma.newsArticle.findMany({
      where: whereClause,
      take: limit,
      skip: offset,
      orderBy: { createdAt: sortOrder === "newest" ? "desc" : "asc" },
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        imageUrl: true,
        thumbnailUrl: true,
        publishedTime: true,
        sourceName: true,
        sourceUrl: true,
        tags: true,
        embeddedTweets: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Build response with full pagination metadata
    const response = {
      success: true,
      count: articles.length,
      total: totalCount,
      page: Math.floor(offset / limit) + 1,
      totalPages: Math.ceil(totalCount / limit),
      offset,
      limit,
      hasNext: offset + articles.length < totalCount,
      hasPrev: offset > 0,
      filters: {
        source: sourceFilter || "all",
        search: searchQuery || null,
        tag: tagFilter || null,
        sort: sortOrder,
      },
      data: articles,
      source: "database",
      timestamp: new Date().toISOString(),
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
router.get("/news/:slug", async (req, res) => {
  try {
    // Validate slug parameter
    let slug;
    try {
      slug = validateSlug(req.params.slug);
    } catch (validationError) {
      return sendError(res, validationError);
    }

    // Set cache headers (1 hour)
    res.setHeader(
      "Cache-Control",
      "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400"
    );

    const prisma = require("../../component/prismaClient");

    const article = await prisma.newsArticle.findFirst({
      where: {
        slug: slug,
        sport: "cricket",
      },
    });

    if (!article) {
      return sendError(res, new NotFoundError("Article"));
    }

    res.json({
      success: true,
      data: article,
    });
  } catch (error) {
    console.error("Error fetching article:", error.message);
    return sendError(res, error);
  }
});

// =============================================
// STATS ENDPOINTS (RapidAPI Cricbuzz)
// =============================================

// ICC Rankings endpoint
router.get("/stats/rankings", async (req, res) => {
  const startTime = Date.now();
  const SCRAPER_NAME = "stats-rankings";
  const { category, formatType } = req.query;

  // Validate required parameters early
  if (!category || !formatType) {
    return sendError(
      res,
      new ValidationError(
        "Both 'category' and 'formatType' parameters are required"
      )
    );
  }

  const cacheKey = `cricket:stats:rankings:${category}:${formatType}`;

  try {
    setCacheHeaders(res, { maxAge: 86400, staleWhileRevalidate: 3600 }); // 24 hours

    // Check cache first
    const cachedData = await getCache(cacheKey);

    if (cachedData) {
      return res.json({ ...cachedData, cached: true });
    }

    // Fetch from RapidAPI
    const data = await fetchRankings(category, formatType);

    const response = {
      success: true,
      data,
      source: "rapidapi",
      cached: false,
      timestamp: new Date().toISOString(),
    };

    // Cache for 24 hours
    await setCache(cacheKey, response, 86400);

    // Record success for health monitoring
    scraperHealth.recordSuccess(SCRAPER_NAME, Date.now() - startTime);

    res.json(response);
  } catch (error) {
    console.error("Error fetching rankings:", error.message);

    // Record failure for health monitoring
    await scraperHealth.recordFailure(
      SCRAPER_NAME,
      error,
      Date.now() - startTime
    );

    // Try to return stale cached data as fallback
    try {
      const staleCache = await getCache(cacheKey);
      if (staleCache) {
        console.log("Returning stale cache for rankings due to error");
        return res.json({
          ...staleCache,
          cached: true,
          stale: true,
          error_note: "Serving cached data due to RapidAPI error",
        });
      }
    } catch (cacheError) {
      console.error("Cache fallback failed:", cacheError.message);
    }

    return sendError(res, error);
  }
});

// ICC Standings endpoint
router.get("/stats/standings", async (req, res) => {
  const startTime = Date.now();
  const SCRAPER_NAME = "stats-standings";
  const { matchType } = req.query;

  if (!matchType) {
    return sendError(
      res,
      new ValidationError(
        "'matchType' parameter is required (1=World Test Championship, 2=World Cup Super League)"
      )
    );
  }

  const cacheKey = `cricket:stats:standings:${matchType}`;

  try {
    setCacheHeaders(res, { maxAge: 86400, staleWhileRevalidate: 3600 }); // 24 hours

    // Check cache first
    const cachedData = await getCache(cacheKey);

    if (cachedData) {
      return res.json({ ...cachedData, cached: true });
    }

    // Fetch from RapidAPI
    const data = await fetchStandings(matchType);

    const response = {
      success: true,
      data,
      source: "rapidapi",
      cached: false,
      timestamp: new Date().toISOString(),
    };

    // Cache for 24 hours
    await setCache(cacheKey, response, 86400);

    // Record success for health monitoring
    scraperHealth.recordSuccess(SCRAPER_NAME, Date.now() - startTime);

    res.json(response);
  } catch (error) {
    console.error("Error fetching standings:", error.message);

    // Record failure for health monitoring
    await scraperHealth.recordFailure(
      SCRAPER_NAME,
      error,
      Date.now() - startTime
    );

    // Try to return stale cached data as fallback
    try {
      const staleCache = await getCache(cacheKey);
      if (staleCache) {
        console.log("Returning stale cache for standings due to error");
        return res.json({
          ...staleCache,
          cached: true,
          stale: true,
          error_note: "Serving cached data due to RapidAPI error",
        });
      }
    } catch (cacheError) {
      console.error("Cache fallback failed:", cacheError.message);
    }

    return sendError(res, error);
  }
});

// Record Filters endpoint
router.get("/stats/record-filters", async (req, res) => {
  const startTime = Date.now();
  const SCRAPER_NAME = "stats-record-filters";
  const cacheKey = "cricket:stats:record-filters";

  try {
    // 7 days cache - filters rarely change, conserve free tier quota
    setCacheHeaders(res, { maxAge: 604800, staleWhileRevalidate: 86400 });

    // Check cache first
    const cachedData = await getCache(cacheKey);

    if (cachedData) {
      return res.json({ ...cachedData, cached: true });
    }

    // Fetch from RapidAPI
    const data = await fetchRecordFilters();

    const response = {
      success: true,
      data,
      source: "rapidapi",
      cached: false,
      timestamp: new Date().toISOString(),
    };

    // Cache for 7 days (604800 seconds) - static data
    await setCache(cacheKey, response, 604800);

    // Record success for health monitoring
    scraperHealth.recordSuccess(SCRAPER_NAME, Date.now() - startTime);

    res.json(response);
  } catch (error) {
    console.error("Error fetching record filters:", error.message);

    // Record failure for health monitoring
    await scraperHealth.recordFailure(
      SCRAPER_NAME,
      error,
      Date.now() - startTime
    );

    // Try to return stale cached data as fallback
    try {
      const staleCache = await getCache(cacheKey);
      if (staleCache) {
        console.log("Returning stale cache for record-filters due to error");
        return res.json({
          ...staleCache,
          cached: true,
          stale: true,
          error_note: "Serving cached data due to RapidAPI error",
        });
      }
    } catch (cacheError) {
      console.error("Cache fallback failed:", cacheError.message);
    }

    return sendError(res, error);
  }
});

// Records endpoint
router.get("/stats/records", async (req, res) => {
  const startTime = Date.now();
  const SCRAPER_NAME = "stats-records";
  const { statsType, id = 0, ...otherFilters } = req.query;

  if (!statsType) {
    return sendError(
      res,
      new ValidationError(
        "'statsType' parameter is required. Use /stats/record-filters to get available types."
      )
    );
  }

  // Build cache key from all params
  const filterStr = Object.entries(otherFilters)
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const cacheKey = `cricket:stats:records:${statsType}:${id}:${filterStr}`;

  try {
    // 48 hours cache - records don't change often, conserve free tier quota
    setCacheHeaders(res, { maxAge: 172800, staleWhileRevalidate: 43200 });

    const cachedData = await getCache(cacheKey);

    if (cachedData) {
      return res.json({ ...cachedData, cached: true });
    }

    // Fetch from RapidAPI
    const data = await fetchRecords(statsType, id);

    const response = {
      success: true,
      data,
      source: "rapidapi",
      cached: false,
      timestamp: new Date().toISOString(),
    };

    // Cache for 48 hours (172800 seconds)
    await setCache(cacheKey, response, 172800);

    // Record success for health monitoring
    scraperHealth.recordSuccess(SCRAPER_NAME, Date.now() - startTime);

    res.json(response);
  } catch (error) {
    console.error("Error fetching records:", error.message);

    // Record failure for health monitoring
    await scraperHealth.recordFailure(
      SCRAPER_NAME,
      error,
      Date.now() - startTime
    );

    // Try to return stale cached data as fallback
    try {
      const staleCache = await getCache(cacheKey);
      if (staleCache) {
        console.log("Returning stale cache for records due to error");
        return res.json({
          ...staleCache,
          cached: true,
          stale: true,
          error_note: "Serving cached data due to RapidAPI error",
        });
      }
    } catch (cacheError) {
      console.error("Cache fallback failed:", cacheError.message);
    }

    return sendError(res, error);
  }
});

// ============================================
// PHOTOS ENDPOINTS
// ============================================

// Photos List endpoint - Get list of photo galleries
router.get("/photos/list", async (req, res) => {
  const startTime = Date.now();
  const SCRAPER_NAME = "photos-list";
  const cacheKey = "cricket:photos:list";

  try {
    // 6 hours cache - optimized for free tier RapidAPI (200 req/month)
    setCacheHeaders(res, { maxAge: 21600, staleWhileRevalidate: 3600 });

    // Check cache first
    const cachedData = await getCache(cacheKey);

    if (cachedData) {
      return res.json({ ...cachedData, cached: true });
    }

    // Fetch from RapidAPI
    const data = await fetchPhotosList();

    const response = {
      success: true,
      data,
      source: "rapidapi",
      cached: false,
      timestamp: new Date().toISOString(),
    };

    // Cache for 6 hours (21600 seconds) - conserve API quota
    await setCache(cacheKey, response, 21600);

    // Record success for health monitoring
    scraperHealth.recordSuccess(SCRAPER_NAME, Date.now() - startTime);

    res.json(response);
  } catch (error) {
    console.error("Error fetching photos list:", error.message);

    // Record failure for health monitoring (may trigger Discord alert)
    await scraperHealth.recordFailure(
      SCRAPER_NAME,
      error,
      Date.now() - startTime
    );

    // Try to return stale cached data as fallback
    try {
      const staleCache = await getCache(cacheKey);
      if (staleCache) {
        console.log("Returning stale cache for photos list due to error");
        return res.json({
          ...staleCache,
          cached: true,
          stale: true,
          error_note: "Serving cached data due to RapidAPI error",
        });
      }
    } catch (cacheError) {
      console.error("Cache fallback failed:", cacheError.message);
    }

    return sendError(res, error);
  }
});

// Photo Gallery endpoint - Get specific gallery details
router.get("/photos/gallery/:galleryId", async (req, res) => {
  const startTime = Date.now();
  const SCRAPER_NAME = "photos-gallery";
  const { galleryId } = req.params;

  // Validate early before any cache operations
  if (!galleryId) {
    return sendError(res, new ValidationError("Gallery ID is required"));
  }

  if (!/^\d+$/.test(galleryId)) {
    return sendError(
      res,
      new ValidationError("Gallery ID must be a valid number")
    );
  }

  const cacheKey = `cricket:photos:gallery:${galleryId}`;

  try {
    // 12 hours cache - galleries don't change, conserve free tier quota
    setCacheHeaders(res, { maxAge: 43200, staleWhileRevalidate: 7200 });

    // Check cache first
    const cachedData = await getCache(cacheKey);

    if (cachedData) {
      return res.json({ ...cachedData, cached: true });
    }

    // Fetch from RapidAPI
    const data = await fetchPhotoGallery(galleryId);

    const response = {
      success: true,
      data,
      source: "rapidapi",
      cached: false,
      timestamp: new Date().toISOString(),
    };

    // Cache for 12 hours (43200 seconds) - galleries are static content
    await setCache(cacheKey, response, 43200);

    // Record success for health monitoring
    scraperHealth.recordSuccess(SCRAPER_NAME, Date.now() - startTime);

    res.json(response);
  } catch (error) {
    console.error("Error fetching photo gallery:", error.message);

    // Record failure for health monitoring (may trigger Discord alert)
    await scraperHealth.recordFailure(
      SCRAPER_NAME,
      error,
      Date.now() - startTime
    );

    // Try to return stale cached data as fallback
    try {
      const staleCache = await getCache(cacheKey);
      if (staleCache) {
        console.log(
          `Returning stale cache for gallery ${galleryId} due to error`
        );
        return res.json({
          ...staleCache,
          cached: true,
          stale: true,
          error_note: "Serving cached data due to RapidAPI error",
        });
      }
    } catch (cacheError) {
      console.error("Cache fallback failed:", cacheError.message);
    }

    return sendError(res, error);
  }
});

// Photo Image endpoint - Proxy images from Cricbuzz
router.get("/photos/image/*", async (req, res) => {
  const startTime = Date.now();
  const SCRAPER_NAME = "photos-image";

  // Get the image path from the URL (everything after /photos/image/)
  const imagePath = req.params[0];

  if (!imagePath) {
    return sendError(res, new ValidationError("Image path is required"));
  }

  // Validate image path format (basic security check)
  if (!/^[a-zA-Z0-9\/_.-]+$/.test(imagePath)) {
    return sendError(res, new ValidationError("Invalid image path format"));
  }

  const cacheKey = `cricket:photos:image:${imagePath}`;

  try {
    // Check cache first (cache the image as base64)
    const cachedData = await getCache(cacheKey);

    if (cachedData) {
      // Set appropriate headers for cached image
      res.set("Content-Type", cachedData.contentType);
      res.set(
        "Cache-Control",
        "public, max-age=2592000, stale-while-revalidate=604800"
      ); // 30 days + 7 days stale
      res.set("X-Cache", "HIT");
      return res.send(Buffer.from(cachedData.data, "base64"));
    }

    // Fetch from RapidAPI
    const imageData = await fetchImage(imagePath);

    // Cache the image for 30 days (2592000 seconds) - images never change
    await setCache(
      cacheKey,
      {
        data: imageData.data.toString("base64"),
        contentType: imageData.contentType,
      },
      2592000
    );

    // Record success for health monitoring
    scraperHealth.recordSuccess(SCRAPER_NAME, Date.now() - startTime);

    // Set appropriate headers
    res.set("Content-Type", imageData.contentType);
    res.set(
      "Cache-Control",
      "public, max-age=2592000, stale-while-revalidate=604800"
    ); // 30 days + 7 days stale
    res.set("X-Cache", "MISS");
    res.send(imageData.data);
  } catch (error) {
    console.error("Error fetching image:", error.message);

    // Record failure for health monitoring
    await scraperHealth.recordFailure(
      SCRAPER_NAME,
      error,
      Date.now() - startTime
    );

    // Try to return stale cached image as fallback
    try {
      const staleCache = await getCache(cacheKey);
      if (staleCache) {
        console.log(`Returning stale cached image: ${imagePath}`);
        res.set("Content-Type", staleCache.contentType);
        res.set("Cache-Control", "public, max-age=86400"); // 1 day for stale
        res.set("X-Cache", "STALE");
        return res.send(Buffer.from(staleCache.data, "base64"));
      }
    } catch (cacheError) {
      console.error("Image cache fallback failed:", cacheError.message);
    }

    // For images, return a 404 or appropriate error status
    if (error.message.includes("not found")) {
      return res.status(404).json({ success: false, error: "Image not found" });
    }
    return sendError(res, error);
  }
});

// ============================================
// RAPIDAPI HEALTH & ANALYTICS ENDPOINT
// ============================================

// RapidAPI Health Dashboard - Monitor quota and scraper health
router.get("/rapidapi/health", async (req, res) => {
  try {
    // Set cache headers - allow 5 minute cache for dashboard
    res.setHeader(
      "Cache-Control",
      "public, max-age=300, s-maxage=300, stale-while-revalidate=60"
    );

    // Get RapidAPI quota status
    const quota = await getRapidAPIQuota();

    // Get health metrics for RapidAPI-dependent scrapers only
    const allMetrics = scraperHealth.getAllMetrics();
    const rapidAPIScrapers = [
      "stats-rankings",
      "stats-standings",
      "stats-record-filters",
      "stats-records",
      "photos-list",
      "photos-gallery",
      "photos-image",
    ];

    const scraperMetrics = {};
    let hasIssues = false;

    rapidAPIScrapers.forEach((name) => {
      const m = allMetrics[name];
      if (m) {
        scraperMetrics[name] = {
          status: m.status,
          consecutiveFailures: m.consecutiveFailures,
          successCount: m.successCount,
          failureCount: m.failureCount,
          successRate:
            m.requestCount > 0
              ? ((m.successCount / m.requestCount) * 100).toFixed(1) + "%"
              : "N/A",
          avgResponseTime:
            m.requestCount > 0
              ? Math.round(m.totalResponseTime / m.requestCount) + "ms"
              : "N/A",
          lastSuccess: m.lastSuccess,
          lastFailure: m.lastFailure,
        };
        if (m.status !== "healthy") hasIssues = true;
      }
    });

    // Calculate days remaining in month
    const now = new Date();
    const daysInMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0
    ).getDate();
    const dayOfMonth = now.getDate();
    const daysRemaining = daysInMonth - dayOfMonth;

    // Calculate usage rate
    const usageRate =
      dayOfMonth > 0 ? (quota.monthlyUsed / dayOfMonth).toFixed(2) : 0;
    const projectedMonthly = Math.round(usageRate * daysInMonth);

    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      overview: {
        status: hasIssues ? "degraded" : "healthy",
        quotaStatus:
          quota.monthlyRemaining <= 10
            ? "critical"
            : quota.monthlyRemaining <= 50
            ? "warning"
            : "healthy",
      },
      quota: {
        ...quota,
        daysRemaining,
        usageRatePerDay: parseFloat(usageRate),
        projectedMonthlyUsage: projectedMonthly,
        willExceedLimit: projectedMonthly > quota.monthlyLimit,
      },
      scrapers: scraperMetrics,
      tips: {
        cacheOptimization:
          "All RapidAPI endpoints use aggressive caching to minimize API calls",
        fallbackEnabled:
          "Stale cache fallback is enabled for all RapidAPI endpoints",
        recommendedUsage: `With ${
          quota.monthlyLimit
        } requests/month, aim for ~${Math.floor(
          quota.monthlyLimit / 30
        )} requests/day`,
      },
    };

    res.json(response);
  } catch (error) {
    console.error("Error generating RapidAPI health report:", error.message);
    return sendError(res, error);
  }
});

module.exports = router;
