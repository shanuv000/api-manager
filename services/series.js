/**
 * Cricbuzz Series Service
 *
 * Scrapes cricket series data from Cricbuzz using Cheerio + Axios
 * No Puppeteer needed - data is embedded as JSON in Next.js script tags
 *
 * Endpoints supported:
 * - getSeriesList(category) - Get all series by category
 * - getSeriesDetails(seriesId) - Get matches for a specific series
 * - getCurrentSeries() - Get currently running series only
 * - getSeriesPointsTable(seriesId) - Get points table for a series
 */

const axios = require("axios");
const cheerio = require("cheerio");

const DEBUG = process.env.NODE_ENV !== 'production';

// Series page URLs by category
const SERIES_URLS = {
    all: "https://www.cricbuzz.com/cricket-schedule/series/all",
    international: "https://www.cricbuzz.com/cricket-schedule/series/international",
    domestic: "https://www.cricbuzz.com/cricket-schedule/series/domestic",
    league: "https://www.cricbuzz.com/cricket-schedule/series/league",
    women: "https://www.cricbuzz.com/cricket-schedule/series/women",
};

// Common HTTP headers
const HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
};

/**
 * Extract seriesScheduleData from Next.js __next_f script tags
 * The data is in escaped JSON format within RSC payload
 * @param {string} html - Raw HTML content
 * @returns {Array} Array of month/series objects
 */
function extractSeriesData(html) {
    try {
        // Pattern 1: Escaped JSON format (Next.js RSC payload)
        const escapedMatch = html.match(
            /\\"seriesScheduleData\\":\s*(\[[\s\S]*?\])(?=\s*,\s*\\"contentFilters\\"|,\\"contentFilters\\")/
        );

        if (escapedMatch && escapedMatch[1]) {
            const unescaped = escapedMatch[1]
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, '\\');
            const seriesData = JSON.parse(unescaped);
            console.log(`📊 Extracted ${seriesData.length} month groups (escaped format)`);
            return seriesData;
        }

        // Pattern 2: Regular JSON format (direct)
        const directMatch = html.match(
            /"seriesScheduleData":\s*(\[[\s\S]*?\])(?=\s*,\s*"contentFilters")/
        );

        if (directMatch && directMatch[1]) {
            const seriesData = JSON.parse(directMatch[1]);
            console.log(`📊 Extracted ${seriesData.length} month groups (direct format)`);
            return seriesData;
        }

        if (DEBUG) console.log("⚠️ Could not find seriesScheduleData in page");
        return [];
    } catch (error) {
        console.error("❌ Error extracting series data:", error.message);
        return [];
    }
}

/**
 * Extract pointsTableData from Next.js RSC payload
 * @param {string} html - Raw HTML content
 * @returns {Object|null} Points table data
 */
function extractPointsTableData(html) {
    try {
        // Find the start of pointsTableData
        // Format in HTML: pointsTableData\":{ where \" is literally backslash + quote
        // Build the search string using character codes to avoid escaping issues
        const searchStr = 'pointsTableData' + String.fromCharCode(92, 34, 58); // \": 
        const startIdx = html.indexOf(searchStr);

        if (startIdx === -1) {
            if (DEBUG) console.log("⚠️ Could not find pointsTableData in page");
            return null;
        }

        // Find the JSON object starting after the key
        const jsonStart = startIdx + searchStr.length;

        // Find balanced braces to get complete JSON object
        let braceCount = 0;
        let endIdx = jsonStart;
        let foundStart = false;

        for (let i = jsonStart; i < html.length && i < jsonStart + 100000; i++) {
            const char = html[i];
            if (char === '{') {
                foundStart = true;
                braceCount++;
            } else if (char === '}') {
                braceCount--;
                if (foundStart && braceCount === 0) {
                    endIdx = i + 1;
                    break;
                }
            }
        }

        if (endIdx > jsonStart) {
            let jsonStr = html.substring(jsonStart, endIdx);
            // Unescape the JSON (\" -> " and \\ -> \)
            const unescaped = jsonStr
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, '\\');

            const data = JSON.parse(unescaped);
            console.log(`📊 Extracted points table data`);
            return data;
        }

        if (DEBUG) console.log("⚠️ Could not find complete pointsTableData JSON");
        return null;
    } catch (error) {
        console.error("❌ Error extracting points table:", error.message);
        return null;
    }
}


/**
 * Transform raw series data into normalized format
 * @param {Array} rawData - Raw series data from page
 * @returns {Array} Normalized series data
 */
function transformSeriesData(rawData) {
    const now = Date.now();

    return rawData.map((monthGroup) => {
        const series = monthGroup.series.map((s) => {
            const startDate = new Date(parseInt(s.startDt));
            const endDate = new Date(parseInt(s.endDt));

            // Determine series status
            let status = "upcoming";
            if (now >= parseInt(s.startDt) && now <= parseInt(s.endDt)) {
                status = "live";
            } else if (now > parseInt(s.endDt)) {
                status = "completed";
            }

            // Generate slug from name
            const slug = s.name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "");

            return {
                id: s.id,
                name: s.name,
                slug,
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                startTimestamp: parseInt(s.startDt),
                endTimestamp: parseInt(s.endDt),
                status,
                url: `https://www.cricbuzz.com/cricket-series/${s.id}/${slug}/matches`,
                matchesUrl: `/api/cricket/series/${s.id}`,
                pointsTableUrl: `/api/cricket/series/${s.id}/points-table`,
            };
        });

        // Format month nicely (e.g., "JANUARY 2026" -> "January 2026")
        const month = monthGroup.date
            .split(" ")
            .map((word, i) =>
                i === 0
                    ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
                    : word
            )
            .join(" ");

        return {
            month,
            series,
        };
    });
}

/**
 * Transform raw points table data into clean format
 * @param {Object} rawData - Raw points table data
 * @returns {Object} Cleaned points table data
 */
function transformPointsTableData(rawData) {
    if (!rawData || !rawData.pointsTable) {
        return null;
    }

    return {
        seriesId: rawData.seriesId,
        seriesName: rawData.seriesName,
        matchType: rawData.match_type,
        groups: rawData.pointsTable.map((group) => ({
            groupName: group.groupName,
            qualifyingTeams: group.no_of_qual || 0,
            teams: group.pointsTableInfo.map((team) => ({
                teamId: team.teamId,
                teamName: team.teamName,
                teamFullName: team.teamFullName,
                matchesPlayed: team.matchesPlayed || 0,
                wins: team.matchesWon || 0,
                losses: team.matchesLost || 0,
                ties: team.matchesTied || 0,
                noResult: team.noRes || 0,
                draws: team.matchesDrawn || 0,
                netRunRate: parseFloat(team.nrr) || 0,
                points: team.points || 0,
                form: team.form || [],
                qualifyStatus: team.teamQualifyStatus || '',
                recentMatches: team.teamMatches
                    ? team.teamMatches.map((m) => ({
                        matchId: m.matchId,
                        matchName: m.matchName,
                        opponent: m.opponent,
                        opponentShortName: m.opponentSName,
                        opponentId: m.opponentId,
                        startTime: m.startdt ? new Date(m.startdt).toISOString() : null,
                        result: m.result || null,
                        isWinner: m.winner === team.teamId,
                    }))
                    : [],
            })),
        })),
    };
}

/**
 * Get list of cricket series by category
 * @param {string} category - Category filter (all, international, domestic, league, women)
 * @returns {Promise<Object>} Series data grouped by month
 */
async function getSeriesList(category = "all") {
    const url = SERIES_URLS[category] || SERIES_URLS.all;

    try {
        console.log(`📡 Fetching series list (${category})...`);

        const response = await axios.get(url, {
            headers: HEADERS,
            timeout: 15000,
        });

        const rawData = extractSeriesData(response.data);

        if (rawData.length === 0) {
            return {
                success: false,
                error: "No series data found",
                category,
            };
        }

        const transformedData = transformSeriesData(rawData);

        const totalSeries = transformedData.reduce(
            (sum, month) => sum + month.series.length,
            0
        );

        console.log(
            `✅ Found ${totalSeries} series across ${transformedData.length} months`
        );

        return {
            success: true,
            count: totalSeries,
            months: transformedData.length,
            category,
            data: transformedData,
        };
    } catch (error) {
        console.error(`❌ Error fetching series list: ${error.message}`);
        return {
            success: false,
            error: error.message,
            category,
        };
    }
}

/**
 * Get currently running/live series only
 * @returns {Promise<Object>} Currently active series
 */
async function getCurrentSeries() {
    try {
        const result = await getSeriesList("all");

        if (!result.success) {
            return result;
        }

        // Filter to only live/current series
        const currentSeries = [];
        result.data.forEach((monthGroup) => {
            const liveSeries = monthGroup.series.filter((s) => s.status === "live");
            if (liveSeries.length > 0) {
                currentSeries.push(...liveSeries);
            }
        });

        console.log(`🏏 Found ${currentSeries.length} currently running series`);

        return {
            success: true,
            count: currentSeries.length,
            data: currentSeries,
        };
    } catch (error) {
        console.error(`❌ Error fetching current series: ${error.message}`);
        return {
            success: false,
            error: error.message,
        };
    }
}

/**
 * Get details for a specific series including matches
 * @param {number|string} seriesId - Series ID from Cricbuzz
 * @returns {Promise<Object>} Series details with matches
 */
async function getSeriesDetails(seriesId) {
    // First, get the correct URL with slug (same approach as points table)
    const matchesUrl = `https://www.cricbuzz.com/cricket-series/${seriesId}/matches`;

    try {
        console.log(`📡 Fetching series details (${seriesId})...`);

        const response = await axios.get(matchesUrl, {
            headers: HEADERS,
            timeout: 15000,
            maxRedirects: 5,
        });

        const $ = cheerio.load(response.data);

        // Extract series name from page title
        const pageTitle = $("title").text().trim();
        const seriesName =
            pageTitle.replace(/ matches,.*$/i, "").replace(/ \| Cricbuzz.*$/i, "").trim() ||
            `Series ${seriesId}`;

        // Generate series slug from name
        const seriesSlug = seriesName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");

        // Extract matches from the page - ONLY those matching this series
        const matches = [];

        $('a[href*="/live-cricket-scores/"]').each((i, el) => {
            const $match = $(el);
            const href = $match.attr("href") || "";
            const title = $match.attr("title") || $match.text().trim();

            // Only include matches that belong to this series (check slug in URL)
            // The match URL ends with the series slug, e.g., "...-sa20-2025-26"
            const hrefLower = href.toLowerCase();
            const matchBelongsToSeries = hrefLower.endsWith(seriesSlug) ||
                hrefLower.includes(`-${seriesSlug}`);

            if (href && title && title.includes("vs") && matchBelongsToSeries) {
                const matchIdMatch = href.match(/\/(\d+)\//);
                const matchId = matchIdMatch ? matchIdMatch[1] : null;

                if (matchId && !matches.find((m) => m.matchId === matchId)) {
                    matches.push({
                        matchId,
                        title: title.trim(),
                        url: `https://www.cricbuzz.com${href}`,
                        scorecardUrl: `/api/cricket/scorecard/${matchId}`,
                    });
                }
            }
        });

        console.log(`✅ Found ${matches.length} matches for series ${seriesId} (slug: ${seriesSlug})`);

        return {
            success: true,
            seriesId: parseInt(seriesId),
            name: seriesName,
            slug: seriesSlug,
            matchCount: matches.length,
            matches,
            pointsTableUrl: `/api/cricket/series/${seriesId}/points-table`,
        };
    } catch (error) {
        console.error(`❌ Error fetching series details: ${error.message}`);

        if (error.response && error.response.status === 404) {
            return {
                success: false,
                error: "Series not found",
                seriesId: parseInt(seriesId),
            };
        }

        return {
            success: false,
            error: error.message,
            seriesId: parseInt(seriesId),
        };
    }
}

/**
 * Get points table for a specific series
 * @param {number|string} seriesId - Series ID from Cricbuzz
 * @param {string} [seriesSlug] - Optional series slug (if not provided, will be auto-detected)
 * @returns {Promise<Object>} Points table data
 */
async function getSeriesPointsTable(seriesId, seriesSlug = null) {
    try {
        console.log(`📡 Fetching points table (${seriesId})...`);

        // If slug not provided, we need to fetch the matches page first to get the redirect/slug
        if (!seriesSlug) {
            // Fetch any page for this series to get the canonical slug from the response
            const matchesUrl = `https://www.cricbuzz.com/cricket-series/${seriesId}/matches`;
            const matchesResp = await axios.get(matchesUrl, {
                headers: HEADERS,
                timeout: 15000,
                maxRedirects: 5,
            });

            // Extract slug from the final URL or page content
            const finalUrl = matchesResp.request?.res?.responseUrl || matchesResp.config?.url;
            const slugMatch = finalUrl?.match(/cricket-series\/\d+\/([^\/]+)/);
            if (slugMatch) {
                seriesSlug = slugMatch[1];
            } else {
                // Try to extract from page title
                const $ = cheerio.load(matchesResp.data);
                const title = $('title').text();
                seriesSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-')[0] || 'series';
            }
        }

        // Now fetch points table with full URL
        const url = `https://www.cricbuzz.com/cricket-series/${seriesId}/${seriesSlug}/points-table`;
        console.log(`  Using URL: ${url}`);

        const response = await axios.get(url, {
            headers: HEADERS,
            timeout: 15000,
        });

        const rawData = extractPointsTableData(response.data);

        if (!rawData) {
            return {
                success: false,
                error: "Points table not available for this series",
                seriesId: parseInt(seriesId),
            };
        }

        const transformedData = transformPointsTableData(rawData);

        if (!transformedData) {
            return {
                success: false,
                error: "Failed to transform points table data",
                seriesId: parseInt(seriesId),
            };
        }

        const totalTeams = transformedData.groups.reduce(
            (sum, group) => sum + group.teams.length,
            0
        );

        console.log(
            `✅ Found ${transformedData.groups.length} groups with ${totalTeams} teams`
        );

        return {
            success: true,
            ...transformedData,
        };
    } catch (error) {
        console.error(`❌ Error fetching points table: ${error.message}`);

        if (error.response && error.response.status === 404) {
            return {
                success: false,
                error: "Series not found",
                seriesId: parseInt(seriesId),
            };
        }

        return {
            success: false,
            error: error.message,
            seriesId: parseInt(seriesId),
        };
    }
}

// Export functions
module.exports = {
    getSeriesList,
    getCurrentSeries,
    getSeriesDetails,
    getSeriesPointsTable,
    SERIES_URLS,
};

// Test if run directly
if (require.main === module) {
    async function test() {
        console.log("\n🧪 Testing Series Service...\n");

        // Test getSeriesList
        console.log("1. Testing getSeriesList('all')...");
        const allSeries = await getSeriesList("all");
        console.log(`   Result: ${allSeries.success ? "✅" : "❌"} ${allSeries.count || 0} series found\n`);

        // Test getCurrentSeries
        console.log("2. Testing getCurrentSeries()...");
        const currentSeries = await getCurrentSeries();
        console.log(`   Result: ${currentSeries.success ? "✅" : "❌"} ${currentSeries.count || 0} current series\n`);

        // Test getSeriesPointsTable
        console.log("3. Testing getSeriesPointsTable(11209)...");
        const pointsTable = await getSeriesPointsTable(11209);
        console.log(`   Result: ${pointsTable.success ? "✅" : "❌"} ${pointsTable.groups?.length || 0} groups found\n`);

        // Test with different category
        console.log("4. Testing getSeriesList('international')...");
        const intlSeries = await getSeriesList("international");
        console.log(`   Result: ${intlSeries.success ? "✅" : "❌"} ${intlSeries.count || 0} series found\n`);

        // Show sample data
        if (allSeries.success && allSeries.data.length > 0) {
            console.log("📋 Sample series data:");
            const firstMonth = allSeries.data[0];
            console.log(`   Month: ${firstMonth.month}`);
            if (firstMonth.series.length > 0) {
                const sample = firstMonth.series[0];
                console.log(`   First series: ${sample.name}`);
                console.log(`   Status: ${sample.status}`);
                console.log(`   Dates: ${sample.startDate} to ${sample.endDate}`);
            }
        }

        // Show points table sample
        if (pointsTable.success && pointsTable.groups?.length > 0) {
            console.log("\n📊 Points Table Sample:");
            console.log(`   Series: ${pointsTable.seriesName}`);
            console.log(`   Match Type: ${pointsTable.matchType}`);
            const firstGroup = pointsTable.groups[0];
            console.log(`   First Group: ${firstGroup.groupName} (${firstGroup.teams.length} teams)`);
            if (firstGroup.teams.length > 0) {
                const topTeam = firstGroup.teams[0];
                console.log(`   Top Team: ${topTeam.teamFullName} - ${topTeam.points} pts, NRR: ${topTeam.netRunRate}`);
            }
        }

        console.log("\n✨ Tests complete!");
    }

    test().catch(console.error);
}
