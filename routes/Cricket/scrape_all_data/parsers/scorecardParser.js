const cheerio = require('cheerio');

/**
 * Parse cricket scorecard HTML and extract structured data
 * @param {string} html - The HTML content to parse
 * @returns {Object} Parsed scorecard data
 */
function parseScorecard(html) {
    const $ = cheerio.load(html);
    
    const scorecard = {
        matchResult: '',
        innings: []
    };

    try {
        // Extract match result
        const matchResultElement = $('.cb-scrcrd-status');
        if (matchResultElement.length > 0) {
            scorecard.matchResult = matchResultElement.text().trim();
        }

        // Parse each innings
        $('[id^="innings_"]').each((index, inningsElement) => {
            const inningsData = parseInnings($, inningsElement);
            if (inningsData) {
                scorecard.innings.push(inningsData);
            }
        });

        return scorecard;
    } catch (error) {
        throw new Error(`Failed to parse scorecard: ${error.message}`);
    }
}

/**
 * Parse individual innings data
 * @param {Object} $ - Cheerio instance
 * @param {Object} inningsElement - The innings DOM element
 * @returns {Object} Parsed innings data
 */
function parseInnings($, inningsElement) {
    const $innings = $(inningsElement);
    
    const innings = {
        team: '',
        score: '',
        overs: '',
        batsmen: [],
        bowlers: [],
        extras: {},
        fallOfWickets: []
    };

    try {
        // Extract team name and score
        const headerElement = $innings.find('.cb-scrd-hdr-rw');
        if (headerElement.length > 0) {
            const teamSpan = headerElement.find('span').first();
            const scoreSpan = headerElement.find('span.pull-right');
            
            innings.team = teamSpan.text().replace(' Innings', '').trim();
            
            if (scoreSpan.length > 0) {
                const scoreText = scoreSpan.text().trim();
                const scoreMatch = scoreText.match(/(\d+-\d+)\s*\(([^)]+)\)/);
                if (scoreMatch) {
                    innings.score = scoreMatch[1];
                    innings.overs = scoreMatch[2];
                }
            }
        }

        // Parse batting data
        innings.batsmen = parseBattingData($, $innings);

        // Parse bowling data
        innings.bowlers = parseBowlingData($, $innings);

        // Parse extras
        innings.extras = parseExtras($, $innings);

        // Parse fall of wickets
        innings.fallOfWickets = parseFallOfWickets($, $innings);

        return innings;
    } catch (error) {
        console.error('Error parsing innings:', error);
        return null;
    }
}

/**
 * Parse batting data from innings
 * @param {Object} $ - Cheerio instance
 * @param {Object} $innings - Innings element
 * @returns {Array} Array of batsman data
 */
function parseBattingData($, $innings) {
    const batsmen = [];
    
    // Find batting section
    const battingRows = $innings.find('.cb-scrd-itms').not(':has(.cb-col:contains("Extras"))').not(':has(.cb-col:contains("Total"))');
    
    battingRows.each((index, row) => {
        const $row = $(row);
        const cols = $row.find('.cb-col');
        
        if (cols.length >= 7) {
            const nameElement = $row.find('a.cb-text-link');
            const dismissalElement = $row.find('.text-gray');
            
            if (nameElement.length > 0) {
                const batsman = {
                    name: nameElement.text().trim(),
                    dismissal: dismissalElement.length > 0 ? dismissalElement.text().trim() : '',
                    runs: parseInt($(cols[2]).text().trim()) || 0,
                    balls: parseInt($(cols[3]).text().trim()) || 0,
                    fours: parseInt($(cols[4]).text().trim()) || 0,
                    sixes: parseInt($(cols[5]).text().trim()) || 0,
                    strikeRate: parseFloat($(cols[6]).text().trim()) || 0
                };
                
                batsmen.push(batsman);
            }
        }
    });
    
    return batsmen;
}

/**
 * Parse bowling data from innings
 * @param {Object} $ - Cheerio instance
 * @param {Object} $innings - Innings element
 * @returns {Array} Array of bowler data
 */
function parseBowlingData($, $innings) {
    const bowlers = [];
    
    // Find bowling section (usually after batting data)
    const bowlingSection = $innings.find('.cb-scrd-sub-hdr:contains("Bowler")').parent();
    
    if (bowlingSection.length > 0) {
        const bowlingRows = bowlingSection.find('.cb-scrd-itms');
        
        bowlingRows.each((index, row) => {
            const $row = $(row);
            const cols = $row.find('.cb-col');
            
            if (cols.length >= 7) {
                const nameElement = $row.find('a.cb-text-link');
                
                if (nameElement.length > 0) {
                    const bowler = {
                        name: nameElement.text().trim(),
                        overs: $(cols[1]).text().trim(),
                        maidens: parseInt($(cols[2]).text().trim()) || 0,
                        runs: parseInt($(cols[3]).text().trim()) || 0,
                        wickets: parseInt($(cols[4]).text().trim()) || 0,
                        noBalls: parseInt($(cols[5]).text().trim()) || 0,
                        wides: parseInt($(cols[6]).text().trim()) || 0,
                        economy: parseFloat($(cols[7]).text().trim()) || 0
                    };
                    
                    bowlers.push(bowler);
                }
            }
        });
    }
    
    return bowlers;
}

/**
 * Parse extras data
 * @param {Object} $ - Cheerio instance
 * @param {Object} $innings - Innings element
 * @returns {Object} Extras data
 */
function parseExtras($, $innings) {
    const extrasRow = $innings.find('.cb-scrd-itms:has(.cb-col:contains("Extras"))');
    
    if (extrasRow.length > 0) {
        const extrasText = extrasRow.text();
        const totalMatch = extrasText.match(/Extras\s+(\d+)/);
        const detailMatch = extrasText.match(/\(([^)]+)\)/);
        
        const extras = {
            total: totalMatch ? parseInt(totalMatch[1]) : 0,
            byes: 0,
            legByes: 0,
            wides: 0,
            noBalls: 0,
            penalties: 0
        };
        
        if (detailMatch) {
            const details = detailMatch[1];
            const byesMatch = details.match(/b (\d+)/);
            const legByesMatch = details.match(/lb (\d+)/);
            const widesMatch = details.match(/w (\d+)/);
            const noBallsMatch = details.match(/nb (\d+)/);
            const penaltiesMatch = details.match(/p (\d+)/);
            
            if (byesMatch) extras.byes = parseInt(byesMatch[1]);
            if (legByesMatch) extras.legByes = parseInt(legByesMatch[1]);
            if (widesMatch) extras.wides = parseInt(widesMatch[1]);
            if (noBallsMatch) extras.noBalls = parseInt(noBallsMatch[1]);
            if (penaltiesMatch) extras.penalties = parseInt(penaltiesMatch[1]);
        }
        
        return extras;
    }
    
    return {};
}

/**
 * Parse fall of wickets data
 * @param {Object} $ - Cheerio instance
 * @param {Object} $innings - Innings element
 * @returns {Array} Fall of wickets data
 */
function parseFallOfWickets($, $innings) {
    const fallOfWickets = [];
    const fowSection = $innings.find('.cb-scrd-sub-hdr:contains("Fall of Wickets")').next();
    
    if (fowSection.length > 0) {
        const fowText = fowSection.text();
        const wicketMatches = fowText.match(/(\d+-\d+)\s*\([^,)]+\)/g);
        
        if (wicketMatches) {
            wicketMatches.forEach(match => {
                const scoreMatch = match.match(/(\d+)-(\d+)/);
                const playerMatch = match.match(/\(([^,)]+)/);
                
                if (scoreMatch && playerMatch) {
                    fallOfWickets.push({
                        wicket: parseInt(scoreMatch[2]),
                        score: parseInt(scoreMatch[1]),
                        batsman: playerMatch[1].trim()
                    });
                }
            });
        }
    }
    
    return fallOfWickets;
}

/**
 * Get test data for testing the parser
 * @returns {string} Sample HTML data
 */
function getTestData() {
    return `<div class="cb-col cb-col-67 cb-scrd-lft-col html-refresh ng-isolate-scope" url="/api/html/cricket-scorecard/118349" timeout="30000" ng-init="seriesId='9746';">
<div class="cb-col cb-scrcrd-status cb-col-100 cb-text-complete ng-scope">South Africa A won by 42 runs</div> <div id="innings_1" class="ng-scope"> <div class="cb-col cb-col-100 cb-ltst-wgt-hdr"> <div class="cb-col cb-col-100 cb-scrd-hdr-rw"> <span>South Africa A Innings</span> <span class="pull-right">283-10 (46.2 Ov)</span> </div> <div class="cb-col cb-col-100 cb-scrd-sub-hdr cb-bg-gray"> <div class="cb-col cb-col-25 text-bold">Batter</div> <div class="cb-col cb-col-33"></div> <div class="cb-col cb-col-8 text-right text-bold">R</div> <div class="cb-col cb-col-8 text-right">B</div> <div class="cb-col cb-col-8 text-right">4s</div> <div class="cb-col cb-col-8 text-right" style="padding-right:10px;">6s</div> <div class="cb-col cb-col-8 text-right">SR</div> <div class="cb-col cb-col-82 text-right"></div> </div> <div class="cb-col cb-col-100 cb-scrd-itms"> <div class="cb-col cb-col-25 "> <a href="/profiles/18142/lesego-senokwane" title="View profile of Lesego Senokwane" class="cb-text-link"> Lesego Senokwane </a> </div> <div class="cb-col cb-col-33"> <span class="text-gray">c Kevlon Anderson b Jediah Blades</span> </div> <div class="cb-col cb-col-8 text-right text-bold">4</div> <div class="cb-col cb-col-8 text-right">9</div> <div class="cb-col cb-col-8 text-right">0</div> <div class="cb-col cb-col-8 text-right" style="padding-right:10px;">0</div> <div class="cb-col cb-col-8 text-right">44.44</div> <div class="cb-col text-right cb-col-2"> <a class="cb-ico cb-caret-right" title="view Highlights of Lesego Senokwane" href="/player-match-highlights/118349/1/18142/batting"></a> </div> </div> <div class="cb-col cb-col-100 cb-scrd-itms"> <div class="cb-col cb-col-25 "> <a href="/profiles/11206/rivaldo-moonsamy" title="View profile of Rivaldo Moonsamy" class="cb-text-link"> Rivaldo Moonsamy </a> </div> <div class="cb-col cb-col-33"> <span class="text-gray">c Mindley b Kevlon Anderson</span> </div> <div class="cb-col cb-col-8 text-right text-bold">49</div> <div class="cb-col cb-col-8 text-right">58</div> <div class="cb-col cb-col-8 text-right">5</div> <div class="cb-col cb-col-8 text-right" style="padding-right:10px;">2</div> <div class="cb-col cb-col-8 text-right">84.48</div> <div class="cb-col text-right cb-col-2"> <a class="cb-ico cb-caret-right" title="view Highlights of Rivaldo Moonsamy" href="/player-match-highlights/118349/1/11206/batting"></a> </div> </div> <div class="cb-col cb-col-100 cb-scrd-itms"> <div class="cb-col cb-col-25 "> <a href="/profiles/21386/jordan-hermann" title="View profile of Jordan Hermann" class="cb-text-link"> Jordan Hermann </a> </div> <div class="cb-col cb-col-33"> <span class="text-gray">c and b Darel Cyrus</span> </div> <div class="cb-col cb-col-8 text-right text-bold">53</div> <div class="cb-col cb-col-8 text-right">47</div> <div class="cb-col cb-col-8 text-right">8</div> <div class="cb-col cb-col-8 text-right" style="padding-right:10px;">1</div> <div class="cb-col cb-col-8 text-right">112.77</div> <div class="cb-col text-right cb-col-2"> <a class="cb-ico cb-caret-right" title="view Highlights of Jordan Hermann" href="/player-match-highlights/118349/1/21386/batting"></a> </div> </div> <div class="cb-col cb-col-100 cb-scrd-itms"> <div class="cb-col cb-col-25 "> <a href="/profiles/12188/mj-ackerman" title="View profile of MJ Ackerman" class="cb-text-link"> MJ Ackerman (c) </a> </div> <div class="cb-col cb-col-33"> <span class="text-gray">lbw b Kevlon Anderson</span> </div> <div class="cb-col cb-col-8 text-right text-bold">4</div> <div class="cb-col cb-col-8 text-right">5</div> <div class="cb-col cb-col-8 text-right">0</div> <div class="cb-col cb-col-8 text-right" style="padding-right:10px;">0</div> <div class="cb-col cb-col-8 text-right">80.00</div> <div class="cb-col text-right cb-col-2"> <a class="cb-ico cb-caret-right" title="view Highlights of MJ Ackerman" href="/player-match-highlights/118349/1/12188/batting"></a> </div> </div> <div class="cb-col cb-col-100 cb-scrd-itms"> <div class="cb-col cb-col-25 "> <a href="/profiles/13667/qeshile" title="View profile of Qeshile" class="cb-text-link"> Qeshile (wk) </a> </div> <div class="cb-col cb-col-33"> <span class="text-gray">c Darel Cyrus b Kadeem Alleyne</span> </div> <div class="cb-col cb-col-8 text-right text-bold">55</div> <div class="cb-col cb-col-8 text-right">55</div> <div class="cb-col cb-col-8 text-right">5</div> <div class="cb-col cb-col-8 text-right" style="padding-right:10px;">1</div> <div class="cb-col cb-col-8 text-right">100.00</div> <div class="cb-col text-right cb-col-2"> <a class="cb-ico cb-caret-right" title="view Highlights of Qeshile" href="/player-match-highlights/118349/1/13667/batting"></a> </div> </div> <div class="cb-col cb-col-100 cb-scrd-itms"> <div class="cb-col cb-col-25 "> <a href="/profiles/9587/j-smith" title="View profile of J Smith" class="cb-text-link"> J Smith </a> </div> <div class="cb-col cb-col-33"> <span class="text-gray">c Kemol Savory b Jediah Blades</span> </div> <div class="cb-col cb-col-8 text-right text-bold">55</div> <div class="cb-col cb-col-8 text-right">44</div> <div class="cb-col cb-col-8 text-right">3</div> <div class="cb-col cb-col-8 text-right" style="padding-right:10px;">3</div> <div class="cb-col cb-col-8 text-right">125.00</div> <div class="cb-col text-right cb-col-2"> <a class="cb-ico cb-caret-right" title="view Highlights of J Smith" href="/player-match-highlights/118349/1/9587/batting"></a> </div> </div> <div class="cb-col cb-col-100 cb-scrd-itms"> <div class="cb-col cb-col-25 "> <a href="/profiles/17026/mpongwana" title="View profile of Mpongwana" class="cb-text-link"> Mpongwana </a> </div> <div class="cb-col cb-col-33"> <span class="text-gray">c Jediah Blades b Mindley</span> </div> <div class="cb-col cb-col-8 text-right text-bold">4</div> <div class="cb-col cb-col-8 text-right">12</div> <div class="cb-col cb-col-8 text-right">0</div> <div class="cb-col cb-col-8 text-right" style="padding-right:10px;">0</div> <div class="cb-col cb-col-8 text-right">33.33</div> <div class="cb-col text-right cb-col-2"> <a class="cb-ico cb-caret-right" title="view Highlights of Mpongwana" href="/player-match-highlights/118349/1/17026/batting"></a> </div> </div> <div class="cb-col cb-col-100 cb-scrd-itms"> <div class="cb-col cb-col-25 "> <a href="/profiles/10676/bjorn-fortuin" title="View profile of Bjorn Fortuin" class="cb-text-link"> Bjorn Fortuin </a> </div> <div class="cb-col cb-col-33"> <span class="text-gray">c Kemol Savory b Jediah Blades</span> </div> <div class="cb-col cb-col-8 text-right text-bold">1</div> <div class="cb-col cb-col-8 text-right">3</div> <div class="cb-col cb-col-8 text-right">0</div> <div class="cb-col cb-col-8 text-right" style="padding-right:10px;">0</div> <div class="cb-col cb-col-8 text-right">33.33</div> <div class="cb-col text-right cb-col-2"> <a class="cb-ico cb-caret-right" title="view Highlights of Bjorn Fortuin" href="/player-match-highlights/118349/1/10676/batting"></a> </div> </div> <div class="cb-col cb-col-100 cb-scrd-itms"> <div class="cb-col cb-col-25 "> <a href="/profiles/50972/tristan-luus" title="View profile of Tristan Luus" class="cb-text-link"> Tristan Luus </a> </div> <div class="cb-col cb-col-33"> <span class="text-gray">c Kemol Savory b Kadeem Alleyne</span> </div> <div class="cb-col cb-col-8 text-right text-bold">16</div> <div class="cb-col cb-col-8 text-right">20</div> <div class="cb-col cb-col-8 text-right">2</div> <div class="cb-col cb-col-8 text-right" style="padding-right:10px;">0</div> <div class="cb-col cb-col-8 text-right">80.00</div> <div class="cb-col text-right cb-col-2"> <a class="cb-ico cb-caret-right" title="view Highlights of Tristan Luus" href="/player-match-highlights/118349/1/50972/batting"></a> </div> </div> <div class="cb-col cb-col-100 cb-scrd-itms"> <div class="cb-col cb-col-25 "> <a href="/profiles/10679/tshepo-moreki" title="View profile of Tshepo Moreki" class="cb-text-link"> Tshepo Moreki </a> </div> <div class="cb-col cb-col-33"> <span class="text-gray">not out</span> </div> <div class="cb-col cb-col-8 text-right text-bold">6</div> <div class="cb-col cb-col-8 text-right">14</div> <div class="cb-col cb-col-8 text-right">0</div> <div class="cb-col cb-col-8 text-right" style="padding-right:10px;">0</div> <div class="cb-col cb-col-8 text-right">42.86</div> <div class="cb-col text-right cb-col-2"> <a class="cb-ico cb-caret-right" title="view Highlights of Tshepo Moreki" href="/player-match-highlights/118349/1/10679/batting"></a> </div> </div> <div class="cb-col cb-col-100 cb-scrd-itms"> <div class="cb-col cb-col-25 "> <a href="/profiles/12191/okuhle-cele" title="View profile of Okuhle Cele" class="cb-text-link"> Okuhle Cele </a> </div> <div class="cb-col cb-col-33"> <span class="text-gray">c Kemol Savory b Oshane Thomas</span> </div> <div class="cb-col cb-col-8 text-right text-bold">17</div> <div class="cb-col cb-col-8 text-right">14</div> <div class="cb-col cb-col-8 text-right">3</div> <div class="cb-col cb-col-8 text-right " style="padding-right:10px;">0</div> <div class="cb-col cb-col-8 text-right">121.43</div> <div class="cb-col text-right cb-col-2"> <a class="cb-ico cb-caret-right" title="view Highlights of Okuhle Cele" href="/player-match-highlights/118349/1/12191/batting"></a> </div> </div> <div class="cb-col cb-col-100 cb-scrd-itms"> <div class="cb-col cb-col-60">Extras</div> <div class="cb-col cb-col-8 text-bold cb-text-black text-right"> 19 </div> <div class="cb-col-32 cb-col"> (b 0, lb 3, w 13, nb 3, p 0)</div> </div> <div class="cb-col cb-col-100 cb-scrd-itms"> <div class="cb-col cb-col-60">Total</div> <div class="cb-col cb-col-8 text-bold text-black text-right"> 283 </div> <div class="cb-col-32 cb-col"> (10 wkts, 46.2 Ov) </div> </div> </div> <div class="cb-col cb-col-100 cb-scrd-sub-hdr cb-bg-gray text-bold">Fall of Wickets</div><div class="cb-col cb-col-100 cb-col-rt cb-font-13"><span>9-1 (<a href="/profiles/18142/lesego-senokwane" title="View profile of Lesego Senokwane" class="cb-text-link">Lesego Senokwane</a>, 1.4), </span><span>102-2 (<a href="/profiles/21386/jordan-hermann" title="View profile of Jordan Hermann" class="cb-text-link">Jordan Hermann</a>, 16.5), </span><span>108-3 (<a href="/profiles/12188/mj-ackerman" title="View profile of MJ Ackerman" class="cb-text-link">MJ Ackerman</a>, 17.5), </span><span>125-4 (<a href="/profiles/11206/rivaldo-moonsamy" title="View profile of Rivaldo Moonsamy" class="cb-text-link">Rivaldo Moonsamy</a>, 21.2), </span><span>210-5 (<a href="/profiles/9587/j-smith" title="View profile of J Smith" class="cb-text-link">J Smith</a>, 33.1), </span><span>222-6 (<a href="/profiles/17026/mpongwana" title="View profile of Mpongwana" class="cb-text-link">Mpongwana</a>, 36.3), </span><span>230-7 (<a href="/profiles/10676/bjorn-fortuin" title="View profile of Bjorn Fortuin" class="cb-text-link">Bjorn Fortuin</a>, 37.4), </span><span>242-8 (<a href="/profiles/13667/qeshile" title="View profile of Qeshile" class="cb-text-link">Qeshile</a>, 39.5), </span><span>258-9 (<a href="/profiles/50972/tristan-luus" title="View profile of Tristan Luus" class="cb-text-link">Tristan Luus</a>, 43.2), </span><span>283-10 (<a href="/profiles/12191/okuhle-cele" title="View profile of Okuhle Cele" class="cb-text-link">Okuhle Cele</a>, 46.2)</span></div> </div> </div>`;
}

module.exports = {
    parseScorecard,
    getTestData
};
