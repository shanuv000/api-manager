/**
 * Health Monitoring Router — /api/health/*
 * Production-grade health endpoints for Uptime Kuma monitoring.
 *
 * Endpoints:
 *   GET /api/health          → Summary health status (quick, for frequent polling)
 *   GET /api/health/system   → CPU, memory, disk, uptime
 *   GET /api/health/redis    → Real Redis read/write test on both clients
 *   GET /api/health/workers  → PM2 process status via `pm2 jlist`
 *   GET /api/health/match-index → Verify Redis match index with real key lookup
 *   GET /api/health/disk      → Disk usage, inodes, log directories, writable test
 *   GET /api/health/db        → PostgreSQL connectivity, pool stats, enhancement backlog
 */

const express = require('express');
const os = require('os');
const { execSync } = require('child_process');
const { getClient, KEYS, getMatchIndex } = require('../utils/redis-client');
const { redis: getGeneralRedis } = require('../component/redisClient');
const prisma = require('../component/prismaClient');
const { pool: dbPool } = prisma;

const router = express.Router();

// ─── Helper: safe JSON parse ───
function safeJsonParse(str) {
    try { return JSON.parse(str); } catch { return null; }
}

// ─── Helper: get disk usage ───
function getDiskUsage() {
    try {
        const output = execSync("df -B1 / | tail -1", { timeout: 3000, encoding: 'utf8' });
        const parts = output.trim().split(/\s+/);
        // Format: Filesystem 1B-blocks Used Available Use% Mounted
        return {
            totalGB: +(parts[1] / 1e9).toFixed(1),
            usedGB: +(parts[2] / 1e9).toFixed(1),
            availableGB: +(parts[3] / 1e9).toFixed(1),
            usagePercent: parseInt(parts[4], 10),
        };
    } catch {
        return null;
    }
}

// ─── Helper: CPU load (1-min average as percentage of cores) ───
function getCpuLoad() {
    const load1 = os.loadavg()[0];
    const cpus = os.cpus().length;
    return {
        load1min: +load1.toFixed(2),
        load5min: +os.loadavg()[1].toFixed(2),
        load15min: +os.loadavg()[2].toFixed(2),
        cores: cpus,
        usagePercent: +((load1 / cpus) * 100).toFixed(1),
    };
}

// ─── Critical PM2 processes to monitor ───
const CRITICAL_PROCESSES = [
    'api-manager',
    'sportspulse',
    'vk-blog',
    'live-score-worker',
    'recent-score-worker',
];

// ─── 1. GET /api/health — Quick summary ───
router.get('/', async (req, res) => {
    const startTime = Date.now();
    const checks = {};
    let overall = 'ok';

    // Quick Redis ping (live-scores client)
    try {
        const liveRedis = getClient();
        if (liveRedis && liveRedis.status === 'ready') {
            await liveRedis.ping();
            checks.redis = 'ok';
        } else {
            checks.redis = 'disconnected';
            overall = 'degraded';
        }
    } catch {
        checks.redis = 'error';
        overall = 'degraded';
    }

    // Memory check
    const mem = process.memoryUsage();
    const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
    checks.memory_mb = heapMB;
    if (heapMB > 400) {
        checks.memory = 'warning';
        if (overall === 'ok') overall = 'warning';
    } else {
        checks.memory = 'ok';
    }

    const httpStatus = overall === 'ok' ? 200 : 503;
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.status(httpStatus).json({
        status: overall,
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        responseMs: Date.now() - startTime,
        checks,
    });
});

// ─── 2. GET /api/health/system — CPU, memory, disk, uptime ───
router.get('/system', (req, res) => {
    const startTime = Date.now();
    let status = 'ok';

    const cpu = getCpuLoad();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = +((usedMem / totalMem) * 100).toFixed(1);
    const disk = getDiskUsage();

    // Thresholds
    if (cpu.usagePercent > 90) status = 'degraded';
    if (memPercent > 90) status = 'degraded';
    if (disk && disk.usagePercent > 90) status = 'degraded';

    const httpStatus = status === 'ok' ? 200 : 503;
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.status(httpStatus).json({
        status,
        timestamp: new Date().toISOString(),
        responseMs: Date.now() - startTime,
        system: {
            uptime: Math.floor(os.uptime()),
            platform: os.platform(),
            arch: os.arch(),
            hostname: os.hostname(),
        },
        cpu,
        memory: {
            totalGB: +(totalMem / 1e9).toFixed(1),
            usedGB: +(usedMem / 1e9).toFixed(1),
            freeGB: +(freeMem / 1e9).toFixed(1),
            usagePercent: memPercent,
        },
        disk,
        process: {
            pid: process.pid,
            uptimeSeconds: Math.floor(process.uptime()),
            heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
        },
    });
});

// ─── 3. GET /api/health/redis — Real read/write test ───
router.get('/redis', async (req, res) => {
    const startTime = Date.now();
    const checks = {};
    let status = 'ok';

    const testKey = '_health_check_test';
    const testValue = `health_${Date.now()}`;

    // Test live-scores Redis client
    try {
        const liveRedis = getClient();
        if (!liveRedis || liveRedis.status !== 'ready') {
            checks.live_client = { status: 'disconnected' };
            status = 'degraded';
        } else {
            const writeStart = Date.now();
            await liveRedis.set(testKey, testValue, 'EX', 10);
            const readVal = await liveRedis.get(testKey);
            await liveRedis.del(testKey);
            const latencyMs = Date.now() - writeStart;

            const passed = readVal === testValue;
            checks.live_client = {
                status: passed ? 'ok' : 'failed',
                latencyMs,
                readWriteVerified: passed,
            };
            if (!passed) status = 'degraded';
        }
    } catch (e) {
        checks.live_client = { status: 'error', error: e.message };
        status = 'degraded';
    }

    // Test general cache Redis client
    try {
        const generalRedis = getGeneralRedis();
        if (!generalRedis || generalRedis.status !== 'ready') {
            checks.general_client = { status: 'disconnected' };
            status = 'degraded';
        } else {
            const writeStart = Date.now();
            await generalRedis.set(testKey, testValue, 'EX', 10);
            const readVal = await generalRedis.get(testKey);
            await generalRedis.del(testKey);
            const latencyMs = Date.now() - writeStart;

            const passed = readVal === testValue;
            checks.general_client = {
                status: passed ? 'ok' : 'failed',
                latencyMs,
                readWriteVerified: passed,
            };
            if (!passed) status = 'degraded';
        }
    } catch (e) {
        checks.general_client = { status: 'error', error: e.message };
        status = 'degraded';
    }

    // Redis server info (memory + keyspace)
    try {
        const liveRedis = getClient();
        if (liveRedis && liveRedis.status === 'ready') {
            const info = await liveRedis.info('memory');
            const usedMatch = info.match(/used_memory_human:(\S+)/);
            const maxMatch = info.match(/maxmemory_human:(\S+)/);
            checks.server = {
                usedMemory: usedMatch ? usedMatch[1] : 'unknown',
                maxMemory: maxMatch ? maxMatch[1] : 'unknown',
            };
            const dbSize = await liveRedis.dbsize();
            checks.server.keyCount = dbSize;
        }
    } catch {
        // Non-critical, skip
    }

    const httpStatus = status === 'ok' ? 200 : 503;
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.status(httpStatus).json({
        status,
        timestamp: new Date().toISOString(),
        responseMs: Date.now() - startTime,
        checks,
    });
});

// ─── 4. GET /api/health/workers — PM2 process status ───
router.get('/workers', (req, res) => {
    const startTime = Date.now();
    let status = 'ok';
    const processes = {};

    try {
        const raw = execSync('pm2 jlist', { timeout: 5000, encoding: 'utf8' });
        const pm2List = safeJsonParse(raw);

        if (!pm2List || !Array.isArray(pm2List)) {
            return res.status(503).json({
                status: 'error',
                error: 'Failed to parse PM2 process list',
                timestamp: new Date().toISOString(),
            });
        }

        // Check each critical process
        for (const name of CRITICAL_PROCESSES) {
            const proc = pm2List.find(p => p.name === name);
            if (!proc) {
                processes[name] = { status: 'missing', online: false };
                status = 'degraded';
            } else {
                const isOnline = proc.pm2_env?.status === 'online';
                const restarts = proc.pm2_env?.restart_time || 0;
                const uptime = proc.pm2_env?.pm_uptime
                    ? Math.floor((Date.now() - proc.pm2_env.pm_uptime) / 1000)
                    : 0;
                const memMB = proc.monit?.memory
                    ? Math.round(proc.monit.memory / 1024 / 1024)
                    : 0;
                const cpu = proc.monit?.cpu || 0;

                processes[name] = {
                    status: isOnline ? 'online' : proc.pm2_env?.status || 'unknown',
                    online: isOnline,
                    pid: proc.pid,
                    restarts,
                    uptimeSeconds: uptime,
                    memoryMB: memMB,
                    cpu,
                };

                if (!isOnline) status = 'degraded';
                // Flag excessive restarts (>15 in current lifecycle = crash loop)
                if (restarts > 15) {
                    processes[name].warning = 'excessive_restarts';
                    if (status === 'ok') status = 'warning';
                }
            }
        }
    } catch (e) {
        return res.status(503).json({
            status: 'error',
            error: `PM2 check failed: ${e.message}`,
            timestamp: new Date().toISOString(),
        });
    }

    const httpStatus = status === 'ok' ? 200 : (status === 'warning' ? 200 : 503);
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.status(httpStatus).json({
        status,
        timestamp: new Date().toISOString(),
        responseMs: Date.now() - startTime,
        processes,
    });
});

// ─── 5. GET /api/health/match-index — Verify Redis match index ───
router.get('/match-index', async (req, res) => {
    const startTime = Date.now();
    let status = 'ok';
    const checks = {};

    try {
        const liveRedis = getClient();
        if (!liveRedis || liveRedis.status !== 'ready') {
            return res.status(503).json({
                status: 'degraded',
                error: 'Redis not connected',
                timestamp: new Date().toISOString(),
            });
        }

        // Find a real match key to test with
        const matchKeys = await liveRedis.call('SCAN', '0', 'MATCH', 'match:*', 'COUNT', '5');
        const keys = matchKeys[1] || [];
        checks.totalIndexKeys = keys.length;

        if (keys.length === 0) {
            // No match keys — this could be normal if no matches are active
            // Check if live_scores_cache exists (worker is running but no matches indexed yet)
            const hasLiveData = await liveRedis.exists(KEYS.LIVE_SCORES);
            checks.liveScoresExists = !!hasLiveData;
            checks.note = hasLiveData
                ? 'Live scores exist but no match index keys found — possible indexing delay'
                : 'No live scores or match index keys — workers may be starting up';
            // Don't mark as degraded — could be between cricket seasons
            status = 'ok';
        } else {
            // Test actual lookup with first found key
            const testKey = keys[0]; // e.g., "match:147049"
            const testMatchId = testKey.replace('match:', '');
            const lookupStart = Date.now();
            const matchData = await getMatchIndex(testMatchId);
            const lookupMs = Date.now() - lookupStart;

            checks.testMatchId = testMatchId;
            checks.lookupMs = lookupMs;

            if (matchData) {
                checks.lookup = 'ok';
                checks.matchTitle = matchData.title || 'unknown';
                checks.source = matchData._meta?.source || 'unknown';
                checks.indexedAt = matchData._meta?.indexedAt
                    ? new Date(matchData._meta.indexedAt).toISOString()
                    : 'unknown';
            } else {
                checks.lookup = 'failed';
                status = 'degraded';
            }
        }

        // Get total count of match:* keys
        let totalKeys = 0;
        let cursor = '0';
        do {
            const result = await liveRedis.call('SCAN', cursor, 'MATCH', 'match:*', 'COUNT', '100');
            cursor = result[0];
            totalKeys += result[1].length;
        } while (cursor !== '0');
        checks.totalMatchKeys = totalKeys;

    } catch (e) {
        status = 'degraded';
        checks.error = e.message;
    }

    const httpStatus = status === 'ok' ? 200 : 503;
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.status(httpStatus).json({
        status,
        timestamp: new Date().toISOString(),
        responseMs: Date.now() - startTime,
        checks,
    });
});

// ─── 6. GET /api/health/disk — Disk exhaustion early detection ───
router.get('/disk', (req, res) => {
    const startTime = Date.now();
    let status = 'ok';
    const checks = {};
    const warnings = [];

    // ── Filesystem usage ──
    try {
        const output = execSync("df -B1 / | tail -1", { timeout: 3000, encoding: 'utf8' });
        const parts = output.trim().split(/\s+/);
        const usagePercent = parseInt(parts[4], 10);
        checks.filesystem = {
            totalGB: +(parts[1] / 1e9).toFixed(1),
            usedGB: +(parts[2] / 1e9).toFixed(1),
            availableGB: +(parts[3] / 1e9).toFixed(1),
            usagePercent,
        };
        if (usagePercent >= 90) {
            status = 'critical';
            warnings.push(`Disk usage critical: ${usagePercent}%`);
        } else if (usagePercent >= 80) {
            if (status === 'ok') status = 'warning';
            warnings.push(`Disk usage high: ${usagePercent}%`);
        }
    } catch (e) {
        checks.filesystem = { error: e.message };
        status = 'degraded';
    }

    // ── Inode usage (silent killer) ──
    try {
        const output = execSync("df -i / | tail -1", { timeout: 3000, encoding: 'utf8' });
        const parts = output.trim().split(/\s+/);
        const inodePercent = parseInt(parts[4], 10);
        checks.inodes = {
            total: parseInt(parts[1], 10),
            used: parseInt(parts[2], 10),
            free: parseInt(parts[3], 10),
            usagePercent: inodePercent,
        };
        if (inodePercent >= 90) {
            status = 'critical';
            warnings.push(`Inode usage critical: ${inodePercent}%`);
        } else if (inodePercent >= 80) {
            if (status === 'ok') status = 'warning';
            warnings.push(`Inode usage high: ${inodePercent}%`);
        }
    } catch (e) {
        checks.inodes = { error: e.message };
    }

    // ── Watched directories (log growth detection) ──
    const watchedDirs = [
        { name: 'app_logs', path: '/home/ubuntu/apps/logs', warnMB: 500 },
        { name: 'pm2_logs', path: '/home/ubuntu/.pm2/logs', warnMB: 200 },
        { name: 'redis_data', path: '/var/lib/redis', warnMB: 300 },
        { name: 'tmp', path: '/tmp', warnMB: 1000 },
    ];

    checks.directories = {};
    for (const dir of watchedDirs) {
        try {
            const output = execSync(`du -sb ${dir.path} 2>/dev/null | cut -f1`, {
                timeout: 3000,
                encoding: 'utf8',
            });
            const bytes = parseInt(output.trim(), 10) || 0;
            const sizeMB = +(bytes / 1e6).toFixed(1);
            checks.directories[dir.name] = { sizeMB, path: dir.path };
            if (sizeMB > dir.warnMB) {
                if (status === 'ok') status = 'warning';
                warnings.push(`${dir.name} large: ${sizeMB}MB (threshold: ${dir.warnMB}MB)`);
                checks.directories[dir.name].warning = true;
            }
        } catch {
            checks.directories[dir.name] = { sizeMB: 0, path: dir.path, note: 'not_found' };
        }
    }

    // ── Writable test (catch read-only filesystem) ──
    try {
        const testFile = '/tmp/_health_disk_write_test';
        execSync(`echo "test" > ${testFile} && rm -f ${testFile}`, {
            timeout: 2000,
            encoding: 'utf8',
        });
        checks.writable = true;
    } catch {
        checks.writable = false;
        status = 'critical';
        warnings.push('Filesystem is NOT writable');
    }

    if (warnings.length > 0) checks.warnings = warnings;

    const httpStatus = status === 'ok' || status === 'warning' ? 200 : 503;
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.status(httpStatus).json({
        status,
        timestamp: new Date().toISOString(),
        responseMs: Date.now() - startTime,
        checks,
    });
});

// ─── 7. GET /api/health/db — PostgreSQL connectivity + enhancement backlog ───
router.get('/db', async (req, res) => {
    const startTime = Date.now();
    let status = 'ok';
    const checks = {};

    // ── Direct DB probe ──
    try {
        const probeStart = Date.now();
        await prisma.$queryRawUnsafe('SELECT 1');
        const latencyMs = Date.now() - probeStart;
        checks.query = {
            status: 'ok',
            latencyMs,
        };
        if (latencyMs > 1000) {
            checks.query.warning = 'high_latency';
            if (status === 'ok') status = 'warning';
        }
    } catch (e) {
        checks.query = { status: 'error', error: e.message };
        status = 'degraded';
    }

    // ── Connection pool stats ──
    try {
        checks.pool = {
            totalCount: dbPool.totalCount,
            idleCount: dbPool.idleCount,
            waitingCount: dbPool.waitingCount,
        };
        if (dbPool.waitingCount > 0) {
            checks.pool.warning = 'connections_waiting';
            if (status === 'ok') status = 'warning';
        }
    } catch {
        checks.pool = { status: 'unavailable' };
    }

    // ── Enhancement backlog ──
    try {
        const backlogCount = await prisma.newsArticle.count({
            where: { enhancedContent: null },
        });
        checks.backlog = {
            unenhancedArticles: backlogCount,
        };
        if (backlogCount > 50) {
            checks.backlog.status = 'degraded';
            checks.backlog.warning = `backlog_high: ${backlogCount} articles unenhanced`;
            if (status === 'ok' || status === 'warning') status = 'degraded';
        } else if (backlogCount > 20) {
            checks.backlog.status = 'warning';
            checks.backlog.warning = `backlog_growing: ${backlogCount} articles unenhanced`;
            if (status === 'ok') status = 'warning';
        } else {
            checks.backlog.status = 'ok';
        }
    } catch (e) {
        checks.backlog = { status: 'error', error: e.message };
        // Backlog query failure is non-critical — DB probe already checks connectivity
    }

    const httpStatus = status === 'ok' || status === 'warning' ? 200 : 503;
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.status(httpStatus).json({
        status,
        timestamp: new Date().toISOString(),
        responseMs: Date.now() - startTime,
        checks,
    });
});

module.exports = router;
