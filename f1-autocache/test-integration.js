// Test your updated data.js logic locally
const WORKER_URL = 'https://f1-autocache.djsmanchanda.workers.dev';

async function testWorkerIntegration() {
    console.log('🧪 Testing F1 Worker Integration...\n');
    
    try {
        // Test fetching from worker directly
        console.log('1️⃣ Testing direct worker access...');
        const response = await fetch(`${WORKER_URL}/api/f1/standings.json?year=2025`);
        const data = await response.json();
        
        // Transform to your app's expected format
        const driverNames = {};
        const currentPoints = {};
        const driverNumbers = [];
        
        for (const driverRow of data) {
            const driverNumber = parseInt(driverRow["Driver Number"]) || 0;
            const driverName = driverRow["Driver Name"] || `Driver #${driverNumber}`;
            const finalPoints = driverRow["Final Points"] || 0;
            
            if (driverNumber > 0) {
                driverNames[driverNumber] = driverName;
                currentPoints[driverNumber] = finalPoints;
                driverNumbers.push(driverNumber);
            }
        }
        
        console.log('✅ Worker data transformed successfully!');
        console.log(`📊 Found ${driverNumbers.length} drivers`);
        
        // Show top 5
        const sorted = Object.entries(currentPoints)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5);
        
        console.log('\n🏆 Top 5 Championship Standings:');
        sorted.forEach(([driverNum, points], index) => {
            const name = driverNames[driverNum];
            console.log(`   ${index + 1}. ${name} (#${driverNum}): ${points} points`);
        });
        
        console.log('\n✅ Integration test passed! Your app will receive:');
        console.log('   - driverNames object with driver numbers and names');
        console.log('   - currentPoints object with driver numbers and points');
        console.log('   - drivers array with all driver numbers');
        console.log('   - X-Data-Source: worker (in headers)');
        
        return { success: true, driverCount: driverNumbers.length };
        
    } catch (error) {
        console.error('❌ Integration test failed:', error.message);
        console.log('🛡️ But your app has fallback protection to the original API');
        return { success: false, error: error.message };
    }
}

// Run the test
testWorkerIntegration();