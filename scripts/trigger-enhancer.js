#!/usr/bin/env node
/**
 * Enhancement Trigger Script
 *
 * Spawns the content enhancer in the background if not already running.
 * Uses a lock file to prevent multiple instances.
 *
 * Usage: node scripts/trigger-enhancer.js
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const LOCK_FILE = "/tmp/content-enhancer.lock";
const ENHANCER_SCRIPT = path.join(
  __dirname,
  "../scrapers/content-enhancer-perplexity.js"
);
const LOCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes max lock time

/**
 * Check if enhancer is already running
 */
function isEnhancerRunning() {
  try {
    if (!fs.existsSync(LOCK_FILE)) {
      return false;
    }

    // Check if lock file is stale (older than timeout)
    const stats = fs.statSync(LOCK_FILE);
    const age = Date.now() - stats.mtimeMs;

    if (age > LOCK_TIMEOUT_MS) {
      console.log("⚠️ Stale lock file found, removing...");
      fs.unlinkSync(LOCK_FILE);
      return false;
    }

    // Check if PID in lock file is still running
    const pid = fs.readFileSync(LOCK_FILE, "utf-8").trim();
    if (pid) {
      try {
        // Signal 0 doesn't kill but checks if process exists
        process.kill(parseInt(pid), 0);
        return true; // Process is running
      } catch (e) {
        // Process not running, remove stale lock
        console.log("⚠️ Process not running, removing stale lock...");
        fs.unlinkSync(LOCK_FILE);
        return false;
      }
    }

    return false;
  } catch (error) {
    console.error("Error checking lock:", error.message);
    return false;
  }
}

/**
 * Create lock file with PID
 */
function createLock(pid) {
  fs.writeFileSync(LOCK_FILE, pid.toString());
}

/**
 * Spawn enhancer in background
 */
function spawnEnhancer() {
  if (isEnhancerRunning()) {
    console.log("🔒 Content enhancer already running, skipping...");
    return false;
  }

  console.log("🚀 Spawning content enhancer in background...");

  const child = spawn("node", [ENHANCER_SCRIPT], {
    detached: true,
    stdio: "ignore",
    cwd: path.join(__dirname, ".."),
  });

  // Store PID in lock file
  createLock(child.pid);

  // Detach from parent
  child.unref();

  console.log(`   PID: ${child.pid}`);
  console.log("   ✅ Enhancer started in background");

  return true;
}

// CLI execution
if (require.main === module) {
  const started = spawnEnhancer();
  process.exit(started ? 0 : 1);
}

module.exports = { spawnEnhancer, isEnhancerRunning };
