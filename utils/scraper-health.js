/**
 * Scraper Health Monitoring
 * Tracks scraper metrics and sends Discord alerts on consecutive failures
 */

const axios = require("axios");

// Load Discord webhook from environment
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Configuration
const CONFIG = {
  CONSECUTIVE_FAILURES_ALERT: 3, // Alert after 3 consecutive failures
  HEALTH_CHECK_INTERVAL_MS: 60000, // 1 minute health check interval
  ALERT_COOLDOWN_MS: 300000, // 5 minute cooldown between alerts
};

// Metrics storage per scraper
const metrics = {};

/**
 * Initialize metrics for a scraper
 * @param {string} scraperName - Name of the scraper
 * @returns {Object} Metrics object
 */
function initMetrics(scraperName) {
  if (!metrics[scraperName]) {
    metrics[scraperName] = {
      name: scraperName,
      successCount: 0,
      failureCount: 0,
      consecutiveFailures: 0,
      totalResponseTime: 0,
      requestCount: 0,
      lastSuccess: null,
      lastFailure: null,
      lastError: null,
      lastAlertSent: null,
      status: "healthy",
    };
  }
  return metrics[scraperName];
}

/**
 * Get metrics for a scraper
 * @param {string} scraperName - Name of the scraper
 * @returns {Object} Metrics object
 */
function getMetrics(scraperName) {
  return initMetrics(scraperName);
}

/**
 * Get all metrics
 * @returns {Object} All metrics
 */
function getAllMetrics() {
  return { ...metrics };
}

/**
 * Record a successful scrape
 * @param {string} scraperName - Name of the scraper
 * @param {number} responseTimeMs - Response time in milliseconds
 */
function recordSuccess(scraperName, responseTimeMs = 0) {
  const m = initMetrics(scraperName);

  m.successCount++;
  m.requestCount++;
  m.totalResponseTime += responseTimeMs;
  m.lastSuccess = new Date().toISOString();
  m.consecutiveFailures = 0;
  m.status = "healthy";

  console.log(`📊 [${scraperName}] Success recorded (${responseTimeMs}ms)`);
}

/**
 * Record a failed scrape
 * @param {string} scraperName - Name of the scraper
 * @param {Error} error - The error that occurred
 * @param {number} responseTimeMs - Response time in milliseconds
 */
async function recordFailure(scraperName, error, responseTimeMs = 0) {
  const m = initMetrics(scraperName);

  m.failureCount++;
  m.requestCount++;
  m.totalResponseTime += responseTimeMs;
  m.lastFailure = new Date().toISOString();
  m.lastError = error.message;
  m.consecutiveFailures++;

  console.log(
    `📊 [${scraperName}] Failure recorded: ${error.message} (consecutive: ${m.consecutiveFailures})`
  );

  // Update status based on consecutive failures
  if (m.consecutiveFailures >= CONFIG.CONSECUTIVE_FAILURES_ALERT) {
    m.status = "critical";
  } else if (m.consecutiveFailures >= 2) {
    m.status = "degraded";
  }

  // Check if we should send an alert
  if (m.consecutiveFailures >= CONFIG.CONSECUTIVE_FAILURES_ALERT) {
    await maybeSendAlert(scraperName, error);
  }
}

/**
 * Send Discord alert if cooldown has passed
 * @param {string} scraperName - Name of the scraper
 * @param {Error} error - The error that occurred
 */
async function maybeSendAlert(scraperName, error) {
  const m = metrics[scraperName];

  // Check cooldown
  if (m.lastAlertSent) {
    const timeSinceLastAlert = Date.now() - new Date(m.lastAlertSent).getTime();
    if (timeSinceLastAlert < CONFIG.ALERT_COOLDOWN_MS) {
      console.log(`⏳ [${scraperName}] Alert skipped - cooldown active`);
      return;
    }
  }

  await sendDiscordAlert(scraperName, error, m);
  m.lastAlertSent = new Date().toISOString();
}

/**
 * Send alert to Discord webhook - Premium detailed message
 * @param {string} scraperName - Name of the scraper
 * @param {Error} error - The error
 * @param {Object} scraperMetrics - Current metrics
 */
async function sendDiscordAlert(scraperName, error, scraperMetrics) {
  if (!DISCORD_WEBHOOK_URL) {
    console.log("⚠️ Discord webhook URL not configured, skipping alert");
    return;
  }

  // Classify error type
  const errorType = classifyErrorType(error);
  const errorColor = getErrorColor(errorType);
  const statusEmoji = getStatusEmoji(scraperMetrics.status);

  // Calculate uptime stats
  const successRate =
    scraperMetrics.requestCount > 0
      ? (
          (scraperMetrics.successCount / scraperMetrics.requestCount) *
          100
        ).toFixed(1)
      : 0;
  const avgResponseTime =
    scraperMetrics.requestCount > 0
      ? Math.round(
          scraperMetrics.totalResponseTime / scraperMetrics.requestCount
        )
      : 0;

  // Build detailed error info
  const errorDetails = buildErrorDetails(error);

  // Get troubleshooting tips based on error type
  const troubleshootingTips = getTroubleshootingTips(errorType);

  const embed = {
    title: `${statusEmoji} Scraper Alert: ${scraperName}`,
    description: `**${errorType}** detected in scraper. Immediate attention may be required.`,
    color: errorColor,
    fields: [
      {
        name: "🔴 Error Message",
        value: `\`\`\`${error.message.substring(0, 500)}\`\`\``,
        inline: false,
      },
      {
        name: "📋 Error Type",
        value: `\`${errorType}\``,
        inline: true,
      },
      {
        name: "🎯 HTTP Status",
        value: error.response?.status
          ? `\`${error.response.status}\``
          : "`N/A`",
        inline: true,
      },
      {
        name: "⏱️ Response Time",
        value: `\`${avgResponseTime}ms\``,
        inline: true,
      },
      {
        name: "━━━━ 📊 Health Metrics ━━━━",
        value: "\u200B",
        inline: false,
      },
      {
        name: "🚦 Status",
        value: `**${scraperMetrics.status.toUpperCase()}**`,
        inline: true,
      },
      {
        name: "🔄 Consecutive Failures",
        value: `\`${scraperMetrics.consecutiveFailures}\``,
        inline: true,
      },
      {
        name: "📈 Success Rate",
        value: `\`${successRate}%\``,
        inline: true,
      },
      {
        name: "✅ Total Success",
        value: `\`${scraperMetrics.successCount}\``,
        inline: true,
      },
      {
        name: "❌ Total Failures",
        value: `\`${scraperMetrics.failureCount}\``,
        inline: true,
      },
      {
        name: "📊 Total Requests",
        value: `\`${scraperMetrics.requestCount}\``,
        inline: true,
      },
      {
        name: "━━━━ ⏰ Timeline ━━━━",
        value: "\u200B",
        inline: false,
      },
      {
        name: "🕐 Last Success",
        value: scraperMetrics.lastSuccess
          ? `<t:${Math.floor(
              new Date(scraperMetrics.lastSuccess).getTime() / 1000
            )}:R>`
          : "`Never`",
        inline: true,
      },
      {
        name: "🕐 Last Failure",
        value: scraperMetrics.lastFailure
          ? `<t:${Math.floor(
              new Date(scraperMetrics.lastFailure).getTime() / 1000
            )}:R>`
          : "`Never`",
        inline: true,
      },
      {
        name: "🔔 Alert Time",
        value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
        inline: true,
      },
    ],
    timestamp: new Date().toISOString(),
    footer: {
      text: "🏏 Cricket API • Scraper Health Monitor",
      icon_url: "https://static.cricbuzz.com/images/cb-logo.svg",
    },
    thumbnail: {
      url: "https://cdn-icons-png.flaticon.com/512/564/564619.png",
    },
  };

  // Add troubleshooting tips if available
  if (troubleshootingTips) {
    embed.fields.push({
      name: "━━━━ 💡 Troubleshooting ━━━━",
      value: troubleshootingTips,
      inline: false,
    });
  }

  // Add error stack trace if available (truncated)
  if (error.stack) {
    const stackPreview = error.stack.split("\n").slice(0, 4).join("\n");
    embed.fields.push({
      name: "🔍 Stack Trace (Preview)",
      value: `\`\`\`${stackPreview.substring(0, 300)}\`\`\``,
      inline: false,
    });
  }

  try {
    await axios.post(DISCORD_WEBHOOK_URL, {
      username: "Cricket API Monitor",
      avatar_url: "https://static.cricbuzz.com/images/cb-logo.svg",
      embeds: [embed],
    });
    console.log(`📨 [${scraperName}] Discord alert sent`);
  } catch (err) {
    console.error(`Failed to send Discord alert: ${err.message}`);
  }
}

/**
 * Classify error type for better reporting
 */
function classifyErrorType(error) {
  const message = error.message?.toLowerCase() || "";
  const code = error.code?.toUpperCase() || "";
  const status = error.response?.status;

  if (
    code === "ECONNABORTED" ||
    code === "ETIMEDOUT" ||
    message.includes("timeout")
  ) {
    return "TIMEOUT";
  }
  if (status === 403) return "BLOCKED (403 Forbidden)";
  if (status === 429) return "RATE LIMITED (429)";
  if (status === 503) return "SERVICE UNAVAILABLE (503)";
  if (status === 502) return "BAD GATEWAY (502)";
  if (status >= 500) return `SERVER ERROR (${status})`;
  if (status === 404) return "NOT FOUND (404)";
  if (code === "ENOTFOUND" || code === "ECONNREFUSED") return "NETWORK ERROR";
  if (message.includes("parse") || message.includes("json"))
    return "PARSE ERROR";
  if (message.includes("selector") || message.includes("element"))
    return "SCRAPING ERROR";
  return "UNKNOWN ERROR";
}

/**
 * Get color based on error type
 */
function getErrorColor(errorType) {
  if (errorType.includes("TIMEOUT")) return 0xffa500; // Orange
  if (errorType.includes("BLOCKED")) return 0xff0000; // Red
  if (errorType.includes("RATE LIMITED")) return 0xffd700; // Gold
  if (errorType.includes("SERVER ERROR")) return 0xdc143c; // Crimson
  if (errorType.includes("NETWORK")) return 0x8b0000; // Dark Red
  if (errorType.includes("PARSE")) return 0x9932cc; // Purple
  return 0xff4444; // Default Red
}

/**
 * Get status emoji
 */
function getStatusEmoji(status) {
  switch (status) {
    case "critical":
      return "🚨";
    case "degraded":
      return "⚠️";
    case "healthy":
      return "✅";
    default:
      return "❓";
  }
}

/**
 * Build detailed error info
 */
function buildErrorDetails(error) {
  const details = [];
  if (error.code) details.push(`Code: ${error.code}`);
  if (error.response?.status) details.push(`Status: ${error.response.status}`);
  if (error.response?.statusText)
    details.push(`StatusText: ${error.response.statusText}`);
  if (error.config?.url) details.push(`URL: ${error.config.url}`);
  return details.join(" | ") || "No additional details";
}

/**
 * Get troubleshooting tips based on error type
 */
function getTroubleshootingTips(errorType) {
  const tips = {
    TIMEOUT:
      "• Increase timeout settings\n• Check if target site is slow\n• Verify network connectivity",
    "BLOCKED (403 Forbidden)":
      "• Rotate User-Agent\n• Add delay between requests\n• Check if IP is blocked",
    "RATE LIMITED (429)":
      "• Reduce request frequency\n• Implement exponential backoff\n• Consider using proxies",
    "NETWORK ERROR":
      "• Check DNS resolution\n• Verify network connectivity\n• Check firewall rules",
    "PARSE ERROR":
      "• Validate HTML structure\n• Check if site layout changed\n• Update selectors",
    "SCRAPING ERROR":
      "• Verify CSS selectors\n• Check if page structure changed\n• Update scraping logic",
    "SERVICE UNAVAILABLE (503)":
      "• Target site may be down\n• Wait and retry later\n• Check site status page",
  };
  return (
    tips[errorType] ||
    "• Check logs for more details\n• Verify scraper configuration\n• Monitor site for changes"
  );
}

/**
 * Send recovery notification to Discord - Premium styled
 * @param {string} scraperName - Name of the scraper
 */
async function sendRecoveryAlert(scraperName) {
  if (!DISCORD_WEBHOOK_URL) return;

  const m = metrics[scraperName];
  if (!m || m.status !== "healthy") return;

  // Calculate uptime stats
  const successRate =
    m.requestCount > 0
      ? ((m.successCount / m.requestCount) * 100).toFixed(1)
      : 100;
  const avgResponseTime =
    m.requestCount > 0 ? Math.round(m.totalResponseTime / m.requestCount) : 0;

  const embed = {
    title: `✅ Scraper Recovered: ${scraperName}`,
    description: `Scraper has recovered and is now operating normally.`,
    color: 0x00ff00, // Green
    fields: [
      {
        name: "� Status",
        value: "**HEALTHY**",
        inline: true,
      },
      {
        name: "📈 Success Rate",
        value: `\`${successRate}%\``,
        inline: true,
      },
      {
        name: "⏱️ Avg Response",
        value: `\`${avgResponseTime}ms\``,
        inline: true,
      },
      {
        name: "━━━━ 📊 Session Stats ━━━━",
        value: "\u200B",
        inline: false,
      },
      {
        name: "✅ Total Success",
        value: `\`${m.successCount}\``,
        inline: true,
      },
      {
        name: "❌ Total Failures",
        value: `\`${m.failureCount}\``,
        inline: true,
      },
      {
        name: "📊 Total Requests",
        value: `\`${m.requestCount}\``,
        inline: true,
      },
      {
        name: "━━━━ ⏰ Timeline ━━━━",
        value: "\u200B",
        inline: false,
      },
      {
        name: "� Recovery Time",
        value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
        inline: true,
      },
      {
        name: "🕐 Last Success",
        value: m.lastSuccess
          ? `<t:${Math.floor(new Date(m.lastSuccess).getTime() / 1000)}:R>`
          : "`Just now`",
        inline: true,
      },
      {
        name: "❌ Last Failure",
        value: m.lastFailure
          ? `<t:${Math.floor(new Date(m.lastFailure).getTime() / 1000)}:R>`
          : "`None`",
        inline: true,
      },
    ],
    timestamp: new Date().toISOString(),
    footer: {
      text: "🏏 Cricket API • Scraper Health Monitor",
      icon_url: "https://static.cricbuzz.com/images/cb-logo.svg",
    },
    thumbnail: {
      url: "https://cdn-icons-png.flaticon.com/512/190/190411.png", // Green checkmark
    },
  };

  try {
    await axios.post(DISCORD_WEBHOOK_URL, {
      username: "Cricket API Monitor",
      avatar_url: "https://static.cricbuzz.com/images/cb-logo.svg",
      embeds: [embed],
    });
    console.log(`📨 [${scraperName}] Recovery alert sent`);
  } catch (err) {
    console.error(`Failed to send recovery alert: ${err.message}`);
  }
}

/**
 * Get health summary
 * @returns {Object} Health summary
 */
function getHealthSummary() {
  const summary = {
    overall: "healthy",
    scrapers: {},
    timestamp: new Date().toISOString(),
  };

  let hasCritical = false;
  let hasDegraded = false;

  for (const [name, m] of Object.entries(metrics)) {
    summary.scrapers[name] = {
      status: m.status,
      consecutiveFailures: m.consecutiveFailures,
      successRate:
        m.requestCount > 0
          ? ((m.successCount / m.requestCount) * 100).toFixed(2) + "%"
          : "N/A",
      avgResponseTime:
        m.requestCount > 0
          ? Math.round(m.totalResponseTime / m.requestCount) + "ms"
          : "N/A",
      lastSuccess: m.lastSuccess,
      lastFailure: m.lastFailure,
    };

    if (m.status === "critical") hasCritical = true;
    if (m.status === "degraded") hasDegraded = true;
  }

  if (hasCritical) summary.overall = "critical";
  else if (hasDegraded) summary.overall = "degraded";

  return summary;
}

/**
 * Create a wrapper that tracks health for async functions
 * @param {string} scraperName - Name of the scraper
 * @param {Function} fn - Async function to wrap
 * @returns {Function} Wrapped function
 */
function withHealthTracking(scraperName, fn) {
  return async (...args) => {
    const startTime = Date.now();
    const m = initMetrics(scraperName);
    const wasUnhealthy = m.status !== "healthy";

    try {
      const result = await fn(...args);
      const responseTime = Date.now() - startTime;
      recordSuccess(scraperName, responseTime);

      // Send recovery alert if was unhealthy
      if (wasUnhealthy && m.status === "healthy") {
        await sendRecoveryAlert(scraperName);
      }

      return result;
    } catch (error) {
      const responseTime = Date.now() - startTime;
      await recordFailure(scraperName, error, responseTime);
      throw error;
    }
  };
}

module.exports = {
  initMetrics,
  getMetrics,
  getAllMetrics,
  recordSuccess,
  recordFailure,
  getHealthSummary,
  withHealthTracking,
  sendDiscordAlert,
  sendRecoveryAlert,
  CONFIG,
};
