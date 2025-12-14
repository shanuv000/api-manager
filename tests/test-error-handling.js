/**
 * Error Handling Test Script
 * 
 * Tests all error scenarios for the Cricket API endpoints.
 * Run with: node tests/test-error-handling.js
 * Or: API_URL=https://api.urtechy.com node tests/test-error-handling.js
 */

const http = require('http');
const https = require('https');

const BASE_URL = process.env.API_URL || 'http://localhost:5003';

// Test cases
const testCases = [
  // Valid requests
  {
    name: 'Valid live-scores request',
    url: '/api/cricket/live-scores?limit=2',
    expectedStatus: 200,
    check: (data) => data.success === true
  },
  {
    name: 'Valid recent-scores request',
    url: '/api/cricket/recent-scores?limit=2',
    expectedStatus: 200,
    check: (data) => data.success === true
  },
  
  // Validation errors
  {
    name: 'Invalid limit (non-numeric)',
    url: '/api/cricket/live-scores?limit=abc',
    expectedStatus: 400,
    check: (data) => data.error?.code === 'VALIDATION_ERROR'
  },
  {
    name: 'Negative offset',
    url: '/api/cricket/recent-scores?offset=-5',
    expectedStatus: 400,
    check: (data) => data.error?.code === 'VALIDATION_ERROR'
  },
  {
    name: 'Invalid slug format',
    url: '/api/cricket/news/test@invalid!slug',
    expectedStatus: 400,
    check: (data) => data.error?.code === 'VALIDATION_ERROR'
  },
  
  // Not found
  {
    name: 'Article not found',
    url: '/api/cricket/news/nonexistent-article-12345',
    expectedStatus: 404,
    check: (data) => data.error?.code === 'NOT_FOUND'
  },
  
  // Limit capping (should succeed, not error)
  {
    name: 'Limit above max (should cap, not error)',
    url: '/api/cricket/live-scores?limit=1000',
    expectedStatus: 200,
    check: (data) => data.success === true && (data.limit <= 50 || data.limit === data.count)
  }
];

async function makeRequest(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const client = url.protocol === 'https:' ? https : http;
    
    client.get(url.toString(), (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: JSON.parse(data)
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            data: data
          });
        }
      });
    }).on('error', reject);
  });
}

async function runTests() {
  console.log('🧪 Error Handling Tests\n');
  console.log(`Testing against: ${BASE_URL}\n`);
  console.log('='.repeat(60) + '\n');
  
  let passed = 0;
  let failed = 0;
  
  for (const test of testCases) {
    process.stdout.write(`Testing: ${test.name}... `);
    
    try {
      const result = await makeRequest(test.url);
      
      const statusMatch = result.status === test.expectedStatus;
      const checkMatch = test.check(result.data);
      
      if (statusMatch && checkMatch) {
        console.log('✅ PASS');
        passed++;
      } else {
        console.log('❌ FAIL');
        console.log(`   Expected status: ${test.expectedStatus}, got: ${result.status}`);
        console.log(`   Check passed: ${checkMatch}`);
        console.log(`   Response: ${JSON.stringify(result.data).substring(0, 200)}`);
        failed++;
      }
    } catch (error) {
      console.log('❌ ERROR');
      console.log(`   ${error.message}`);
      failed++;
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(console.error);
