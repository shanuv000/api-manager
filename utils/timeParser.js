/**
 * Parse time format to ISO 8601
 * Handles multiple formats:
 * - Cricbuzz: "Sun, Dec 14, 2025 • 12:05 PM"
 * - ESPN ISO: "2025-12-15T10:37:12Z" or "2025-12-15T10:37:12.000Z"
 * - ESPN relative: "5 hrs ago", "30 mins ago"
 * Output: ISO 8601 format
 */
function parsePublishTime(timeString) {
  if (!timeString || typeof timeString !== 'string') {
    return null;
  }

  const trimmed = timeString.trim();

  try {
    // Check if already ISO format
    if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
      const dateObj = new Date(trimmed);
      if (!isNaN(dateObj.getTime())) {
        return dateObj.toISOString();
      }
    }

    // Check for relative time format: "5 hrs ago", "30 mins ago"
    const relativeMatch = trimmed.match(/^(\d+)\s*(hr|hrs|hour|hours|min|mins|minute|minutes)\s*ago$/i);
    if (relativeMatch) {
      const value = parseInt(relativeMatch[1], 10);
      const unit = relativeMatch[2].toLowerCase();
      const now = new Date();
      
      if (unit.startsWith('hr') || unit.startsWith('hour')) {
        now.setHours(now.getHours() - value);
      } else {
        now.setMinutes(now.getMinutes() - value);
      }
      return now.toISOString();
    }

    // Cricbuzz format: "Sun, Dec 14, 2025 • 12:05 PM"
    if (trimmed.includes('•')) {
      // Remove day of week: "Sun, Dec 14, 2025 • 12:05 PM" -> "Dec 14, 2025 • 12:05 PM"
      const withoutDay = trimmed.replace(/^\w+,\s*/, '');
      
      // Split by bullet point: ["Dec 14, 2025", "12:05 PM"]
      const parts = withoutDay.split('•').map(p => p.trim());
      
      if (parts.length === 2) {
        const [datePart, timePart] = parts;
        const dateObj = new Date(datePart + ' ' + timePart);
        
        if (!isNaN(dateObj.getTime())) {
          return dateObj.toISOString();
        }
      }
    }

    // Try generic date parsing as fallback
    const dateObj = new Date(trimmed);
    if (!isNaN(dateObj.getTime())) {
      return dateObj.toISOString();
    }
    
    console.warn('Could not parse time format:', timeString);
    return null;
    
  } catch (error) {
    console.error('Error parsing time:', timeString, error);
    return null;
  }
}


// Test the function
const testCases = [
  // Cricbuzz format
  "Sun, Dec 14, 2025 • 12:05 PM",
  "Sat, Dec 13, 2025 • 7:10 PM",
  "Mon, Dec 15, 2025 • 9:30 AM",
  // ESPN ISO format
  "2025-12-15T10:37:12Z",
  "2025-12-15T10:37:12.000Z",
  // ESPN relative format
  "5 hrs ago",
  "30 mins ago",
];

console.log('Testing time parser:\n');
testCases.forEach(test => {
  const result = parsePublishTime(test);
  console.log('Input:  ', test);
  console.log('Output: ', result);
  console.log('');
});

module.exports = { parsePublishTime };
