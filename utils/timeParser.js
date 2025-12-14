/**
 * Parse Cricbuzz time format to ISO 8601
 * Input: "Sun, Dec 14, 2025 • 12:05 PM"
 * Output: "2025-12-14T12:05:00+05:30" (ISO 8601 with timezone)
 */
function parsePublishTime(cricbuzzTime) {
  if (!cricbuzzTime || typeof cricbuzzTime !== 'string') {
    return null;
  }

  try {
    // Remove day of week: "Sun, Dec 14, 2025 • 12:05 PM" -> "Dec 14, 2025 • 12:05 PM"
    const withoutDay = cricbuzzTime.replace(/^\w+,\s*/, '');
    
    // Split by bullet point: ["Dec 14, 2025", "12:05 PM"]
    const parts = withoutDay.split('•').map(p => p.trim());
    
    if (parts.length !== 2) {
      console.warn('Unexpected time format:', cricbuzzTime);
      return cricbuzzTime; // Return original if format unexpected
    }
    
    const [datePart, timePart] = parts;
    
    // Parse date: "Dec 14, 2025"
    const dateObj = new Date(datePart + ' ' + timePart);
    
    if (isNaN(dateObj.getTime())) {
      console.warn('Invalid date:', cricbuzzTime);
      return cricbuzzTime;
    }
    
    // Convert to ISO 8601 format
    return dateObj.toISOString();
    
  } catch (error) {
    console.error('Error parsing time:', cricbuzzTime, error);
    return cricbuzzTime; // Return original on error
  }
}

// Test the function
const testCases = [
  "Sun, Dec 14, 2025 • 12:05 PM",
  "Sat, Dec 13, 2025 • 7:10 PM",
  "Mon, Dec 15, 2025 • 9:30 AM"
];

console.log('Testing time parser:\n');
testCases.forEach(test => {
  const result = parsePublishTime(test);
  console.log('Input:  ', test);
  console.log('Output: ', result);
  console.log('');
});

module.exports = { parsePublishTime };
