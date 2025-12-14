/**
 * API Error Handling Utilities
 * 
 * Custom error classes and utilities for robust API error handling.
 * Includes retry logic, rate limit detection, and structured error responses.
 */

// ============================================================================
// CUSTOM ERROR CLASSES
// ============================================================================

/**
 * Base API Error class with status code and error code
 */
class ApiError extends Error {
  constructor(message, statusCode = 500, errorCode = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.errorCode,
        message: this.message,
        details: this.details,
        timestamp: this.timestamp
      }
    };
  }
}

/**
 * Validation error for invalid input parameters (400)
 */
class ValidationError extends ApiError {
  constructor(message, field = null) {
    super(message, 400, 'VALIDATION_ERROR', field ? { field } : null);
    this.name = 'ValidationError';
  }
}

/**
 * Not found error (404)
 */
class NotFoundError extends ApiError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

/**
 * Rate limit error - when source (Cricbuzz) blocks us (429)
 */
class RateLimitError extends ApiError {
  constructor(source = 'Source', retryAfter = 60) {
    super(`${source} rate limit exceeded. Try again in ${retryAfter} seconds.`, 429, 'RATE_LIMITED', { retryAfter });
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Scraping error - when page structure changes or parsing fails (502)
 */
class ScrapingError extends ApiError {
  constructor(message = 'Failed to scrape data from source', source = null) {
    super(message, 502, 'SCRAPING_FAILED', source ? { source } : null);
    this.name = 'ScrapingError';
  }
}

/**
 * Timeout error (504)
 */
class TimeoutError extends ApiError {
  constructor(operation = 'Request', timeoutMs = 10000) {
    super(`${operation} timed out after ${timeoutMs}ms`, 504, 'TIMEOUT', { timeoutMs });
    this.name = 'TimeoutError';
  }
}

/**
 * Service unavailable - source is down (503)
 */
class ServiceUnavailableError extends ApiError {
  constructor(service = 'Service') {
    super(`${service} is temporarily unavailable`, 503, 'SERVICE_UNAVAILABLE');
    this.name = 'ServiceUnavailableError';
  }
}

// ============================================================================
// ERROR HANDLING UTILITIES
// ============================================================================

/**
 * Detect rate limiting patterns in response
 * @param {Object} response - Axios response object
 * @param {string} html - Response HTML body
 * @returns {boolean}
 */
const isRateLimited = (response, html = '') => {
  // Check HTTP status codes that indicate rate limiting
  if (response?.status === 429 || response?.status === 403) {
    return true;
  }
  
  // Check for common rate limit headers
  const rateLimitHeaders = ['x-ratelimit-remaining', 'retry-after', 'x-rate-limit-remaining'];
  for (const header of rateLimitHeaders) {
    const value = response?.headers?.[header];
    if (value && (value === '0' || parseInt(value) === 0)) {
      return true;
    }
  }
  
  // Check for CAPTCHA or block page indicators
  const blockPatterns = [
    /captcha/i,
    /blocked/i,
    /rate.?limit/i,
    /too.?many.?requests/i,
    /access.?denied/i
  ];
  
  if (html && blockPatterns.some(pattern => pattern.test(html))) {
    return true;
  }
  
  return false;
};

/**
 * Convert Axios error to appropriate ApiError
 * @param {Error} error - Axios error
 * @param {string} operation - Description of what operation failed
 * @returns {ApiError}
 */
const handleAxiosError = (error, operation = 'Request') => {
  // Network errors (no response)
  if (!error.response) {
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      return new TimeoutError(operation, error.config?.timeout || 10000);
    }
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return new ServiceUnavailableError('Cricbuzz');
    }
    return new ApiError(`Network error: ${error.message}`, 503, 'NETWORK_ERROR');
  }
  
  const { status, data } = error.response;
  const html = typeof data === 'string' ? data : '';
  
  // Rate limiting
  if (isRateLimited(error.response, html)) {
    const retryAfter = parseInt(error.response.headers['retry-after']) || 60;
    return new RateLimitError('Cricbuzz', retryAfter);
  }
  
  // Client errors
  if (status === 400) {
    return new ValidationError('Invalid request to source');
  }
  if (status === 404) {
    return new NotFoundError('Resource on Cricbuzz');
  }
  
  // Server errors
  if (status >= 500) {
    return new ServiceUnavailableError('Cricbuzz');
  }
  
  // Default
  return new ApiError(`Request failed with status ${status}`, status, 'REQUEST_FAILED');
};

/**
 * Sleep utility for retry delays
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise}
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @returns {Promise}
 */
const retryWithBackoff = async (fn, options = {}) => {
  const {
    maxRetries = 2,
    initialDelay = 500,
    maxDelay = 5000,
    backoffFactor = 2,
    retryableErrors = ['NETWORK_ERROR', 'SERVICE_UNAVAILABLE', 'TIMEOUT']
  } = options;
  
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Don't retry non-retryable errors
      if (error instanceof ApiError && !retryableErrors.includes(error.errorCode)) {
        throw error;
      }
      
      // Don't retry if we've exhausted retries
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Calculate delay with exponential backoff
      const delay = Math.min(initialDelay * Math.pow(backoffFactor, attempt), maxDelay);
      console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms...`);
      await sleep(delay);
    }
  }
  
  throw lastError;
};

// ============================================================================
// INPUT VALIDATION UTILITIES
// ============================================================================

/**
 * Validate and parse pagination parameters
 * @param {Object} query - Request query object
 * @param {Object} options - Validation options
 * @returns {Object} - Validated { limit, offset }
 */
const validatePaginationParams = (query, options = {}) => {
  const {
    defaultLimit = 20,
    maxLimit = 50,
    allowNoLimit = true
  } = options;
  
  let limit = null;
  let offset = 0;
  
  // Validate limit
  if (query.limit !== undefined) {
    const parsedLimit = parseInt(query.limit);
    
    if (isNaN(parsedLimit)) {
      throw new ValidationError('Parameter "limit" must be a valid integer', 'limit');
    }
    
    if (parsedLimit < 1) {
      throw new ValidationError('Parameter "limit" must be at least 1', 'limit');
    }
    
    limit = Math.min(parsedLimit, maxLimit);
  } else if (!allowNoLimit) {
    limit = defaultLimit;
  }
  
  // Validate offset
  if (query.offset !== undefined) {
    const parsedOffset = parseInt(query.offset);
    
    if (isNaN(parsedOffset)) {
      throw new ValidationError('Parameter "offset" must be a valid integer', 'offset');
    }
    
    if (parsedOffset < 0) {
      throw new ValidationError('Parameter "offset" must be 0 or greater', 'offset');
    }
    
    offset = parsedOffset;
  }
  
  return { limit, offset };
};

/**
 * Validate slug parameter
 * @param {string} slug - Slug to validate
 * @returns {string} - Validated slug
 */
const validateSlug = (slug) => {
  if (!slug || typeof slug !== 'string') {
    throw new ValidationError('Slug is required', 'slug');
  }
  
  // Allow alphanumeric, hyphens, and underscores
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
    throw new ValidationError('Invalid slug format', 'slug');
  }
  
  return slug;
};

// ============================================================================
// RESPONSE UTILITIES
// ============================================================================

/**
 * Send success response with consistent structure
 * @param {Object} res - Express response
 * @param {Object} data - Response data
 * @param {Object} meta - Additional metadata
 */
const sendSuccess = (res, data, meta = {}) => {
  res.json({
    success: true,
    ...meta,
    data
  });
};

/**
 * Send error response with consistent structure
 * @param {Object} res - Express response
 * @param {Error} error - Error object
 */
const sendError = (res, error) => {
  if (error instanceof ApiError) {
    return res.status(error.statusCode).json(error.toJSON());
  }
  
  // Fallback for unexpected errors
  console.error('Unexpected error:', error);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      timestamp: new Date().toISOString()
    }
  });
};

// ============================================================================
// EXPRESS MIDDLEWARE
// ============================================================================

/**
 * Async handler wrapper to catch errors in route handlers
 * @param {Function} fn - Async route handler
 * @returns {Function} - Wrapped handler
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Error handling middleware
 */
const errorMiddleware = (err, req, res, next) => {
  // Log the error
  console.error(`[ERROR] ${err.name}: ${err.message}`);
  if (process.env.NODE_ENV !== 'production') {
    console.error(err.stack);
  }
  
  sendError(res, err);
};

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Error classes
  ApiError,
  ValidationError,
  NotFoundError,
  RateLimitError,
  ScrapingError,
  TimeoutError,
  ServiceUnavailableError,
  
  // Error utilities
  isRateLimited,
  handleAxiosError,
  retryWithBackoff,
  sleep,
  
  // Validation utilities
  validatePaginationParams,
  validateSlug,
  
  // Response utilities
  sendSuccess,
  sendError,
  
  // Middleware
  asyncHandler,
  errorMiddleware
};
