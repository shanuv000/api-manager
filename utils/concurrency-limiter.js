/**
 * Simple Concurrency Limiter
 * Limits concurrent async operations without needing ESM-only p-limit
 */

/**
 * Create a concurrency limiter
 * @param {number} concurrency - Maximum concurrent operations
 * @returns {Function} Limiter function
 */
function createLimiter(concurrency) {
  let activeCount = 0;
  const queue = [];

  const next = () => {
    if (queue.length > 0 && activeCount < concurrency) {
      const { fn, resolve, reject } = queue.shift();
      activeCount++;
      fn()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          activeCount--;
          next();
        });
    }
  };

  return (fn) => {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
  };
}

module.exports = { createLimiter };
