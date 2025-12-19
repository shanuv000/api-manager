/**
 * Scraper Retry Utility
 * Provides retry wrapper with exponential backoff for scraping operations
 */

const CONFIG = {
  MAX_RETRIES: 3,
  BASE_DELAY_MS: 2000,
  BACKOFF_MULTIPLIER: 1.5,
};

/**
 * Error types for classification
 */
const ErrorTypes = {
  TIMEOUT: "TIMEOUT",
  BLOCKED: "BLOCKED",
  RATE_LIMITED: "RATE_LIMITED",
  NETWORK: "NETWORK",
  PARSE_ERROR: "PARSE_ERROR",
  UNKNOWN: "UNKNOWN",
};

/**
 * Classify error into specific type for better handling
 * @param {Error} error - The error to classify
 * @returns {string} Error type from ErrorTypes
 */
function classifyError(error) {
  const message = error.message?.toLowerCase() || "";
  const code = error.code?.toUpperCase() || "";
  const status = error.response?.status;

  // Timeout errors
  if (
    code === "ECONNABORTED" ||
    code === "ETIMEDOUT" ||
    message.includes("timeout")
  ) {
    return ErrorTypes.TIMEOUT;
  }

  // Blocked/Forbidden
  if (status === 403) {
    return ErrorTypes.BLOCKED;
  }

  // Rate limited
  if (status === 429) {
    return ErrorTypes.RATE_LIMITED;
  }

  // Network errors
  if (
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED" ||
    code === "ENETUNREACH" ||
    message.includes("network") ||
    message.includes("socket")
  ) {
    return ErrorTypes.NETWORK;
  }

  // Parse errors
  if (
    message.includes("parse") ||
    message.includes("json") ||
    message.includes("unexpected token")
  ) {
    return ErrorTypes.PARSE_ERROR;
  }

  return ErrorTypes.UNKNOWN;
}

/**
 * Check if error is retryable
 * @param {Error} error - The error to check
 * @returns {boolean} Whether the error is retryable
 */
function isRetryable(error) {
  const errorType = classifyError(error);
  // Don't retry parse errors or blocked errors
  return (
    errorType !== ErrorTypes.PARSE_ERROR && errorType !== ErrorTypes.BLOCKED
  );
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry wrapper with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Configuration options
 * @param {number} options.maxRetries - Max retry attempts (default: 3)
 * @param {number} options.baseDelay - Base delay in ms (default: 2000)
 * @param {number} options.backoffMultiplier - Delay multiplier per retry (default: 1.5)
 * @param {string} options.operationName - Name for logging (default: 'operation')
 * @param {Function} options.onRetry - Callback on each retry (attempt, error, delay)
 * @returns {Promise<any>} Result of the function
 */
async function withRetry(fn, options = {}) {
  const {
    maxRetries = CONFIG.MAX_RETRIES,
    baseDelay = CONFIG.BASE_DELAY_MS,
    backoffMultiplier = CONFIG.BACKOFF_MULTIPLIER,
    operationName = "operation",
    onRetry = null,
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const errorType = classifyError(error);

      // Check if we should retry
      if (attempt > maxRetries || !isRetryable(error)) {
        console.error(
          `❌ ${operationName} failed after ${attempt} attempt(s): [${errorType}] ${error.message}`
        );
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = Math.round(
        baseDelay * Math.pow(backoffMultiplier, attempt - 1)
      );

      console.log(
        `⚠️ ${operationName} attempt ${attempt}/${
          maxRetries + 1
        } failed [${errorType}]. Retrying in ${delay}ms...`
      );

      // Call retry callback if provided
      if (onRetry) {
        await onRetry(attempt, error, delay);
      }

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Retry wrapper specifically for axios requests
 * Handles axios-specific error patterns
 * @param {Function} axiosCall - Axios request function
 * @param {Object} options - Retry options
 */
async function withAxiosRetry(axiosCall, options = {}) {
  return withRetry(axiosCall, {
    operationName: "HTTP request",
    ...options,
  });
}

module.exports = {
  withRetry,
  withAxiosRetry,
  classifyError,
  isRetryable,
  ErrorTypes,
  CONFIG,
};
