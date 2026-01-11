/**
 * IPL Service Module
 * Fetches IPL data directly from IPLT20's public JSONP API
 * 
 * API Endpoints discovered:
 * - Points Table: https://scores.iplt20.com/ipl/feeds/stats/{competitionId}-groupstandings.js
 * - Match Schedule: https://scores.iplt20.com/ipl/feeds/{competitionId}-matchschedule.js
 */

const axios = require('axios');

// Competition ID mapping for each IPL season
const COMPETITION_IDS = {
    2025: '203',
    2024: '201',
    2023: '143',
    2022: '117',
    2021: '106',
    2020: '99',
    2019: '76',
    2018: '70',
    2017: '65',
    2016: '60',
    2015: '55',
    2014: '51',
    2013: '50',
    2012: '49',
    2011: '48'
};

const BASE_URL = 'https://scores.iplt20.com/ipl/feeds';

/**
 * Parse JSONP response to extract JSON data
 * @param {string} jsonpData - Raw JSONP response
 * @param {string} callbackName - Expected callback function name
 * @returns {Object|null} Parsed JSON or null
 */
function parseJSONP(jsonpData, callbackName) {
    try {
        // Match pattern: callbackName({...});
        const regex = new RegExp(`${callbackName}\\(([\\s\\S]+)\\);?$`);
        const match = jsonpData.match(regex);
        if (match && match[1]) {
            return JSON.parse(match[1]);
        }
        return null;
    } catch (error) {
        console.error(`JSONP parse error for ${callbackName}:`, error.message);
        return null;
    }
}

/**
 * Get competition ID for a given season
 * @param {number|string} season - Year (e.g., 2025)
 * @returns {string|null} Competition ID or null
 */
function getCompetitionId(season) {
    const year = parseInt(season, 10);
    return COMPETITION_IDS[year] || null;
}

/**
 * Fetch IPL Points Table
 * @param {number|string} season - IPL season year (default: current/2025)
 * @returns {Promise<Object>} Points table data
 */
async function fetchPointsTable(season = 2025) {
    const competitionId = getCompetitionId(season);
    if (!competitionId) {
        throw new Error(`Invalid season: ${season}. Valid seasons: ${Object.keys(COMPETITION_IDS).join(', ')}`);
    }

    const url = `${BASE_URL}/stats/${competitionId}-groupstandings.js`;

    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*',
                'Referer': 'https://www.iplt20.com/'
            },
            timeout: 10000
        });

        const data = parseJSONP(response.data, 'ongroupstandings');
        if (!data) {
            throw new Error('Failed to parse points table response');
        }

        // Transform to cleaner format
        const standings = data.points.map((team, index) => ({
            position: index + 1,
            teamId: team.TeamID,
            teamCode: team.TeamCode,
            teamName: team.TeamName,
            teamLogo: team.TeamLogo,
            matches: parseInt(team.Matches, 10),
            won: parseInt(team.Wins, 10),
            lost: parseInt(team.Loss, 10),
            tied: parseInt(team.Tied, 10),
            noResult: parseInt(team.NoResult, 10),
            points: parseInt(team.Points, 10),
            netRunRate: parseFloat(team.NetRunRate),
            forRuns: team.ForTeams,
            againstRuns: team.AgainstTeam,
            recentForm: team.Performance ? team.Performance.split(',') : [],
            isQualified: team.IsQualified === '1',
            positionChange: team.Status, // UP, DOWN, SAME
            previousPosition: parseInt(team.PrevPosition, 10) || null
        }));

        return {
            season: parseInt(season, 10),
            competitionId,
            lastUpdated: new Date().toISOString(),
            standings
        };

    } catch (error) {
        if (error.response?.status === 404) {
            throw new Error(`Points table not available for season ${season}`);
        }
        throw error;
    }
}

/**
 * Fetch IPL Match Schedule
 * @param {number|string} season - IPL season year (default: current/2025)
 * @returns {Promise<Object>} Match schedule data
 */
async function fetchSchedule(season = 2025) {
    const competitionId = getCompetitionId(season);
    if (!competitionId) {
        throw new Error(`Invalid season: ${season}. Valid seasons: ${Object.keys(COMPETITION_IDS).join(', ')}`);
    }

    const url = `${BASE_URL}/${competitionId}-matchschedule.js`;

    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*',
                'Referer': 'https://www.iplt20.com/'
            },
            timeout: 15000
        });

        const data = parseJSONP(response.data, 'MatchSchedule');
        if (!data || !data.Matchsummary) {
            throw new Error('Failed to parse schedule response');
        }

        // Helper to normalize status
        const normalizeStatus = (matchStatus) => {
            if (!matchStatus) return 'unknown';
            const s = matchStatus.toLowerCase();
            if (s === 'post') return 'completed';
            if (s === 'live') return 'live';
            if (s === 'pre') return 'upcoming';
            return s;
        };

        // Transform matches to cleaner format
        const matches = data.Matchsummary.map(match => {
            const status = normalizeStatus(match.MatchStatus);
            return {
                matchId: match.MatchID,
                matchNumber: parseInt(match.MatchOrder, 10) || null,
                matchName: match.MatchName,
                matchDate: match.MatchDate,
                matchTime: match.MatchTime,
                gmtTime: match.GMTMatchTime,
                venue: match.Venue,
                city: match.City,
                status, // normalized: upcoming, live, completed

                // Teams
                team1: {
                    id: match.Team1ID,
                    code: match.Team1Code,
                    name: match.Team1Name,
                    shortName: match.Team1ShortName,
                    logo: match.Team1Logo
                },
                team2: {
                    id: match.Team2ID,
                    code: match.Team2Code,
                    name: match.Team2Name,
                    shortName: match.Team2ShortName,
                    logo: match.Team2Logo
                },

                // Scores (if available)
                team1Score: match.Team1Innings1 || null,
                team2Score: match.Team2Innings1 || null,

                // Result
                result: match.Conclusion || null,
                winningTeam: match.WinningTeam || null,

                // Toss
                tossWinner: match.TossWinner || null,
                tossDecision: match.TossDecision || null,

                // Player of Match
                playerOfMatch: match.MOM || null,

                // URLs
                matchUrl: `https://www.iplt20.com/match/${season}/${match.MatchID}`
            };
        });

        // Categorize matches
        const live = matches.filter(m => m.status === 'live');
        const upcoming = matches.filter(m => m.status === 'upcoming');
        const completed = matches.filter(m => m.status === 'completed');

        return {
            season: parseInt(season, 10),
            competitionId,
            lastUpdated: new Date().toISOString(),
            summary: {
                total: matches.length,
                completed: completed.length,
                live: live.length,
                upcoming: upcoming.length
            },
            matches
        };

    } catch (error) {
        if (error.response?.status === 404) {
            throw new Error(`Schedule not available for season ${season}`);
        }
        throw error;
    }
}

/**
 * Get a single match by ID
 * @param {string|number} matchId - Match ID
 * @param {number|string} season - IPL season year (default: 2025)
 * @returns {Promise<Object>} Match details
 */
async function getMatchById(matchId, season = 2025) {
    const schedule = await fetchSchedule(season);
    // Compare as strings to handle both number and string matchId
    const targetId = String(matchId);
    const match = schedule.matches.find(m => String(m.matchId) === targetId);

    if (!match) {
        return null;
    }

    return {
        season: schedule.season,
        lastUpdated: schedule.lastUpdated,
        match
    };
}

/**
 * Get available seasons
 * @returns {Array} List of available seasons
 */
function getAvailableSeasons() {
    return Object.keys(COMPETITION_IDS).map(year => ({
        year: parseInt(year, 10),
        competitionId: COMPETITION_IDS[year]
    })).sort((a, b) => b.year - a.year);
}

// ================================
// TEAMS & PLAYERS (Cheerio Scraping)
// ================================

const cheerio = require('cheerio');

const TEAMS_URL = 'https://www.iplt20.com/teams';

// Team slug to ID mapping (for consistent data)
const TEAM_SLUGS = {
    'chennai-super-kings': { id: '13', code: 'CSK', name: 'Chennai Super Kings' },
    'delhi-capitals': { id: '14', code: 'DC', name: 'Delhi Capitals' },
    'gujarat-titans': { id: '35', code: 'GT', name: 'Gujarat Titans' },
    'kolkata-knight-riders': { id: '16', code: 'KKR', name: 'Kolkata Knight Riders' },
    'lucknow-super-giants': { id: '77', code: 'LSG', name: 'Lucknow Super Giants' },
    'mumbai-indians': { id: '17', code: 'MI', name: 'Mumbai Indians' },
    'punjab-kings': { id: '15', code: 'PBKS', name: 'Punjab Kings' },
    'rajasthan-royals': { id: '18', code: 'RR', name: 'Rajasthan Royals' },
    'royal-challengers-bengaluru': { id: '19', code: 'RCB', name: 'Royal Challengers Bengaluru' },
    'sunrisers-hyderabad': { id: '20', code: 'SRH', name: 'Sunrisers Hyderabad' }
};

/**
 * Fetch all IPL teams
 * @returns {Promise<Object>} Teams list
 */
async function fetchTeams() {
    try {
        const response = await axios.get(TEAMS_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html'
            },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        const teams = [];

        // Extract team links from the page
        $('a[href*="/teams/"]').each((i, el) => {
            const href = $(el).attr('href');
            const slugMatch = href?.match(/\/teams\/([a-z-]+)$/);
            if (slugMatch) {
                const slug = slugMatch[1];
                const teamInfo = TEAM_SLUGS[slug];
                if (teamInfo && !teams.find(t => t.slug === slug)) {
                    // Try to find team logo
                    const logo = $(el).find('img').attr('src') ||
                        $(el).find('img').attr('data-src') ||
                        `https://scores.iplt20.com/ipl/teamlogos/${teamInfo.code}.png`;

                    teams.push({
                        slug,
                        ...teamInfo,
                        logo: logo.startsWith('http') ? logo : `https://www.iplt20.com${logo}`,
                        url: `https://www.iplt20.com/teams/${slug}`
                    });
                }
            }
        });

        // Ensure all teams are included even if not found in HTML
        Object.entries(TEAM_SLUGS).forEach(([slug, info]) => {
            if (!teams.find(t => t.slug === slug)) {
                teams.push({
                    slug,
                    ...info,
                    logo: `https://scores.iplt20.com/ipl/teamlogos/${info.code}.png`,
                    url: `https://www.iplt20.com/teams/${slug}`
                });
            }
        });

        return {
            count: teams.length,
            lastUpdated: new Date().toISOString(),
            teams: teams.sort((a, b) => a.name.localeCompare(b.name))
        };

    } catch (error) {
        console.error('Error fetching teams:', error.message);
        throw error;
    }
}

/**
 * Fetch team squad/roster
 * @param {string} teamSlug - Team slug (e.g., 'mumbai-indians')
 * @returns {Promise<Object>} Team details with squad
 */
async function fetchTeamSquad(teamSlug) {
    const teamInfo = TEAM_SLUGS[teamSlug];
    if (!teamInfo) {
        throw new Error(`Invalid team slug: ${teamSlug}. Valid slugs: ${Object.keys(TEAM_SLUGS).join(', ')}`);
    }

    const url = `https://www.iplt20.com/teams/${teamSlug}`;

    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html'
            },
            timeout: 15000
        });

        const $ = cheerio.load(response.data);
        const players = [];
        const seenNames = new Set();

        // Extract players from the team page
        $('a[data-player_name]').each((i, el) => {
            const name = $(el).attr('data-player_name');
            if (!name || seenNames.has(name)) return;
            seenNames.add(name);

            const href = $(el).attr('href') || '';
            const playerIdMatch = href.match(/\/(\d+)\s*$/);
            const playerSlugMatch = href.match(/\/players\/([^/]+)\//);

            // Get role from the span inside
            const role = $(el).find('span.d-block').text().trim() || 'Unknown';

            // Get headshot image
            const img = $(el).find('img[data-src]').attr('data-src') ||
                $(el).find('img').attr('src') || null;

            players.push({
                name,
                slug: playerSlugMatch ? playerSlugMatch[1] : null,
                id: playerIdMatch ? playerIdMatch[1] : null,
                role: normalizePlayerRole(role),
                nationality: null, // Not available in list view
                image: img,
                profileUrl: href.trim() ? `https://www.iplt20.com${href.trim()}` : null
            });
        });

        // Categorize players by role
        const squad = {
            batters: players.filter(p => p.role === 'Batter' || p.role === 'WK-Batter'),
            allRounders: players.filter(p => p.role === 'All-Rounder'),
            bowlers: players.filter(p => p.role === 'Bowler'),
            unknown: players.filter(p => p.role === 'Unknown')
        };

        return {
            team: {
                slug: teamSlug,
                ...teamInfo,
                logo: `https://scores.iplt20.com/ipl/teamlogos/${teamInfo.code}.png`,
                url
            },
            squadSize: players.length,
            lastUpdated: new Date().toISOString(),
            squad,
            players // Flat list for convenience
        };

    } catch (error) {
        if (error.response?.status === 404) {
            throw new Error(`Team not found: ${teamSlug}`);
        }
        throw error;
    }
}

/**
 * Normalize player role string
 */
function normalizePlayerRole(role) {
    if (!role) return 'Unknown';
    const r = role.toLowerCase();
    if (r.includes('batter') && r.includes('wk')) return 'WK-Batter';
    if (r.includes('batter') || r.includes('batsman')) return 'Batter';
    if (r.includes('all-rounder') || r.includes('allrounder')) return 'All-Rounder';
    if (r.includes('bowler')) return 'Bowler';
    return role;
}

/**
 * Get valid team slugs
 */
function getTeamSlugs() {
    return Object.keys(TEAM_SLUGS);
}

/**
 * Fetch player profile details
 * @param {string} playerSlug - Player slug (e.g., 'karun-nair')
 * @param {string|number} playerId - Player ID (e.g., '276')
 * @returns {Promise<Object>} Player profile data
 */
async function fetchPlayerProfile(playerSlug, playerId) {
    const url = `https://www.iplt20.com/players/${playerSlug}/${playerId}`;

    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html'
            },
            timeout: 15000
        });

        const $ = cheerio.load(response.data);

        // Extract player name and nationality from header
        const nameSection = $('.plyr-name-nationality');
        const name = nameSection.find('h1').first().text().trim() || null;
        const nationality = nameSection.find('span').first().text().trim() || null;

        // Extract headshot from meta or inline image
        const headshot = $('meta[property="og:image"]').attr('content') ||
            $('meta[name="twitter:image"]').attr('content') ||
            $('.plyr-name-nationality').prev('img').attr('src') || null;

        // Extract team from title
        const title = $('title').text();
        const teamMatch = title.match(/\|\s*([^|]+)\s*\|/);
        const team = teamMatch ? teamMatch[1].trim() : null;

        // Extract overview grid data
        const overviewData = {};
        $('.player-overview-detail .grid-items').each((i, el) => {
            const value = $(el).find('p').first().text().trim();
            const label = $(el).find('span').first().text().trim().toLowerCase();

            if (label && value) {
                if (label.includes('debut')) overviewData.iplDebut = value;
                else if (label.includes('special')) overviewData.specialization = value;
                else if (label.includes('birth')) overviewData.dateOfBirth = value;
                else if (label.includes('match')) overviewData.matches = parseInt(value, 10) || value;
            }
        });

        // Extract bio
        const bioElement = $('.player-overview-detail').next().find('p').first();
        let bio = null;
        // Alternative: look for bio in the page structure
        $('p').each((i, el) => {
            const text = $(el).text().trim();
            if (text.length > 100 && text.includes(name?.split(' ')[0] || '')) {
                bio = text;
                return false; // break
            }
        });

        // Look for additional stats from modal table (if present)
        const role = $('#plyrole').text().trim() || overviewData.specialization || null;
        const bats = null; // Would need to find this in page
        const bowls = null;

        return {
            id: playerId,
            slug: playerSlug,
            name,
            nationality,
            team,
            role: normalizePlayerRole(role),
            headshot,
            dateOfBirth: overviewData.dateOfBirth || null,
            iplDebut: overviewData.iplDebut || null,
            totalMatches: overviewData.matches || null,
            specialization: overviewData.specialization || null,
            bio,
            profileUrl: url,
            lastUpdated: new Date().toISOString()
        };

    } catch (error) {
        if (error.response?.status === 404) {
            throw new Error(`Player not found: ${playerSlug}/${playerId}`);
        }
        throw error;
    }
}

module.exports = {
    fetchPointsTable,
    fetchSchedule,
    getMatchById,
    getAvailableSeasons,
    getCompetitionId,
    fetchTeams,
    fetchTeamSquad,
    getTeamSlugs,
    fetchPlayerProfile,
    COMPETITION_IDS,
    TEAM_SLUGS
};
