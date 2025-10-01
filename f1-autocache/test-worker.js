#!/usr/bin/env node

/**
 * Test script for the F1 Worker API
 * Run this after deploying your worker to validate it's working correctly
 * 
 * Usage: node test-worker.js [WORKER_URL]
 * Example: node test-worker.js https://f1-autocache.your-username.workers.dev
 */

const WORKER_URL = process.argv[2] || 'https://f1-autocache.your-username.workers.dev';
const CURRENT_YEAR = new Date().getFullYear();

async function testEndpoint(url, expectedType = 'json') {
  console.log(`\n🧪 Testing: ${url}`);
  
  try {
    const response = await fetch(url);
    const status = response.status;
    const headers = Object.fromEntries(response.headers);
    
    console.log(`   Status: ${status}`);
    console.log(`   CORS: ${headers['access-control-allow-origin']}`);
    console.log(`   Cache: ${headers['cache-control']}`);
    
    if (status === 200) {
      const data = expectedType === 'csv' 
        ? await response.text()
        : await response.json();
      
      if (expectedType === 'csv') {
        const lines = data.split('\n');
        console.log(`   ✅ CSV: ${lines.length} lines, first: ${lines[0].substring(0, 50)}...`);
      } else {
        if (Array.isArray(data)) {
          console.log(`   ✅ JSON: ${data.length} drivers, leader: ${data[0]?.["Driver Name"]} (${data[0]?.["Final Points"]} pts)`);
        } else {
          console.log(`   ✅ JSON: ${JSON.stringify(data).substring(0, 100)}...`);
        }
      }
    } else if (status === 404) {
      console.log(`   ⚠️  404: No data yet (normal for new deployment)`);
    } else {
      const error = await response.text();
      console.log(`   ❌ Error: ${error}`);
    }
  } catch (error) {
    console.log(`   ❌ Failed: ${error.message}`);
  }
}

async function testWorker() {
  console.log(`🏎️  Testing F1 Worker: ${WORKER_URL}`);
  console.log(`📅 Year: ${CURRENT_YEAR}\n`);
  
  // Test all endpoints
  await testEndpoint(`${WORKER_URL}/api/f1/standings.json?year=${CURRENT_YEAR}`, 'json');
  await testEndpoint(`${WORKER_URL}/api/f1/standings.csv?year=${CURRENT_YEAR}`, 'csv');
  await testEndpoint(`${WORKER_URL}/api/f1/meta?year=${CURRENT_YEAR}`, 'json');
  
  // Test manual update (will fail without auth, but should return 401 not 404)
  console.log(`\n🔄 Testing manual update (expecting 401 or success):`);
  await testEndpoint(`${WORKER_URL}/api/f1/update?year=${CURRENT_YEAR}`, 'json');
  
  console.log(`\n📋 Next Steps:`);
  console.log(`   1. If you see 404s, trigger an initial update:`);
  console.log(`      curl -X POST "${WORKER_URL}/api/f1/update"`);
  console.log(`   2. Update your data.js file with this worker URL`);
  console.log(`   3. The worker will auto-update via cron every hour`);
  console.log(`\n🚀 Worker testing complete!`);
}

// Check if this is being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testWorker().catch(console.error);
}

export { testWorker };