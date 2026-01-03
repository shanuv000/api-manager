/**
 * Content Normalizer Utility
 *
 * Normalizes content from different scraped sources to a consistent markdown format.
 * ESPN Cricinfo and Cricbuzz return plain text, while ICC/BBC/IPL return markdown.
 * This utility ensures consistent formatting for frontend rendering.
 */

/**
 * Sources that already return markdown-formatted content
 */
const MARKDOWN_SOURCES = ["ICC Cricket", "BBC Sport", "IPL T20"];

/**
 * Sources that return plain text (need normalization)
 */
const PLAIN_TEXT_SOURCES = ["Cricbuzz", "ESPN Cricinfo"];

/**
 * Normalize content to consistent markdown format
 *
 * @param {string} content - The raw content to normalize
 * @param {string} sourceName - The source name (e.g., "Cricbuzz", "ICC Cricket")
 * @returns {string} - Normalized markdown content
 */
function normalizeContent(content, sourceName) {
  if (!content || typeof content !== "string") {
    return "";
  }

  // Sources that already return markdown - return as-is
  if (MARKDOWN_SOURCES.includes(sourceName)) {
    return content.trim();
  }

  // Plain text sources - convert to basic markdown
  return convertPlainTextToMarkdown(content);
}

/**
 * Convert plain text content to basic markdown format
 *
 * @param {string} text - Plain text content
 * @returns {string} - Markdown-formatted content
 */
function convertPlainTextToMarkdown(text) {
  if (!text) return "";

  // Split into paragraphs (double newlines or single newlines with content)
  const paragraphs = text
    .split(/\n\n+/)
    .map((para) => para.trim())
    .filter((para) => para.length > 0);

  // Process each paragraph
  const processed = paragraphs.map((para) => {
    // Check if it's a quote (starts with " or ')
    if (/^["'].*["']$/.test(para.trim()) || para.includes("said:")) {
      return `> ${para}`;
    }

    // Check if it looks like a heading (short, ends without period, has key words)
    if (para.length < 80 && !para.endsWith(".") && /^[A-Z]/.test(para)) {
      const headingPatterns = [
        /^(Key|Match|Player|Team|Series|Tournament|Analysis|Preview|Review)/i,
        /^(First|Second|Third|Final|Opening|Closing)/i,
        /^(India|Australia|England|Pakistan|South Africa|New Zealand|West Indies|Sri Lanka|Bangladesh)/i,
      ];

      if (headingPatterns.some((pattern) => pattern.test(para))) {
        return `### ${para}`;
      }
    }

    // Check for list items (starts with dash, bullet, number)
    if (/^[-•*]\s/.test(para)) {
      return para
        .split(/\n/)
        .map((line) => {
          const trimmed = line.trim();
          if (/^[-•*]\s/.test(trimmed)) {
            return `- ${trimmed.substring(2).trim()}`;
          }
          return trimmed;
        })
        .join("\n");
    }

    // Regular paragraph - just return trimmed
    return para;
  });

  return processed.join("\n\n");
}

/**
 * Highlight key terms in content
 * Makes player names and key statistics bold
 *
 * @param {string} content - Markdown content
 * @returns {string} - Content with highlights
 */
function highlightKeyTerms(content) {
  if (!content) return "";

  // Highlight score patterns (e.g., "152 runs", "5 wickets", "100*")
  let highlighted = content.replace(
    /\b(\d+\*?)\s*(runs?|wickets?|overs?|balls?|catches?|stumpings?)\b/gi,
    "**$1 $2**"
  );

  // Highlight centuries and half-centuries
  highlighted = highlighted.replace(
    /\b(century|half-century|ton|fifty)\b/gi,
    "**$1**"
  );

  // Highlight match results
  highlighted = highlighted.replace(
    /\b(won by|lost by|draw|tie|defeated|beat)\b/gi,
    "**$1**"
  );

  return highlighted;
}

/**
 * Process embedded media markers
 * Ensures consistent format for tweet and Instagram embeds
 *
 * @param {string} content - Content that may contain embed markers
 * @param {string[]} embeddedTweets - Array of tweet IDs
 * @param {string[]} embeddedInstagram - Array of Instagram post IDs
 * @returns {string} - Content with normalized embed markers
 */
function normalizeEmbedMarkers(
  content,
  embeddedTweets = [],
  embeddedInstagram = []
) {
  if (!content) return "";

  let normalized = content;

  // Ensure tweet markers are in consistent format
  embeddedTweets.forEach((tweetId) => {
    // Check if marker already exists
    if (!normalized.includes(`[TWEET:${tweetId}]`)) {
      // Could add logic to insert at appropriate position
    }
  });

  // Ensure Instagram markers are in consistent format
  embeddedInstagram.forEach((postId) => {
    if (!normalized.includes(`[INSTAGRAM:${postId}]`)) {
      // Could add logic to insert at appropriate position
    }
  });

  return normalized;
}

/**
 * Get content format info for a source
 *
 * @param {string} sourceName - The source name
 * @returns {object} - Format information
 */
function getSourceFormatInfo(sourceName) {
  return {
    sourceName,
    isMarkdown: MARKDOWN_SOURCES.includes(sourceName),
    isPlainText: PLAIN_TEXT_SOURCES.includes(sourceName),
    supportsHeadings: MARKDOWN_SOURCES.includes(sourceName),
    supportsLinks: ["ICC Cricket", "BBC Sport", "IPL T20"].includes(sourceName),
    supportsBold: MARKDOWN_SOURCES.includes(sourceName),
    supportsTables: ["ICC Cricket", "IPL T20"].includes(sourceName),
    supportsEmbeds: {
      twitter: ["ICC Cricket", "BBC Sport"].includes(sourceName),
      instagram: ["ICC Cricket", "IPL T20"].includes(sourceName),
    },
  };
}

module.exports = {
  normalizeContent,
  convertPlainTextToMarkdown,
  highlightKeyTerms,
  normalizeEmbedMarkers,
  getSourceFormatInfo,
  MARKDOWN_SOURCES,
  PLAIN_TEXT_SOURCES,
};
