// Global state
let appData = null;
let scenarios = {};
let currentPoints = {};
let driverNames = {};
let drivers = [];
let remainingRaces = [];
let remainingSprints = [];

// Constants
const RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1].concat(Array(10).fill(0)); // 20 positions
const SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1].concat(Array(12).fill(0)); // 20 positions, but only top 8 score

// Initialize app
async function init() {
    try {
        showLoading(true);
        await loadData();
        processData();
        renderUI();
        attachEventListeners();
        showLoading(false);
        document.getElementById('app').style.display = 'block';
    } catch (error) {
        console.error('Initialization error:', error);
        showError();
    }
}

function showLoading(show) {
    document.getElementById('loading').style.display = show ? 'block' : 'none';
}

function showError() {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'block';
}

// Load data from API with optimization
async function loadData() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
    
    try {
        const response = await fetch('/api/data', {
            signal: controller.signal,
            headers: {
                'Accept': 'application/json'
            }
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: Failed to fetch data`);
        }
        
        appData = await response.json();
        
        // Log cache status for debugging
        const cacheStatus = response.headers.get('X-Cache-Status');
        if (cacheStatus) {
            console.log(`Data loaded from: ${cacheStatus}`);
        }
        
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error('Request timed out - please try again');
        }
        throw error;
    }
}

// Process loaded data
function processData() {
    driverNames = appData.driverNames;
    currentPoints = appData.currentPoints;
    
    // Get unique drivers
    drivers = appData.drivers || Object.keys(currentPoints).map(Number);
    
    // Calculate remaining races and sprints
    const currentDate = new Date();
    remainingRaces = appData.allRaces.filter(race => new Date(race.date) > currentDate);
    remainingSprints = appData.allSprints.filter(sprint => new Date(sprint.date) > currentDate);
    
    // Initialize scenarios
    scenarios = {};
    for (let i = 0; i < remainingRaces.length + remainingSprints.length; i++) {
        scenarios[i] = [];
    }
}

// Render UI
function renderUI() {
    renderStandings();
    renderProgress();
    renderScenarioTabs();
    populateVictoryDrivers();
}

function renderStandings() {
    const standingsDiv = document.getElementById('standings');
    const sortedDrivers = Object.entries(currentPoints)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10);
    
    standingsDiv.innerHTML = sortedDrivers.map(([driverNum, points], index) => {
        const name = driverNames[driverNum] || `Driver #${driverNum}`;
        return `
            <div class="driver-card">
                <span class="driver-position">${index + 1}</span>
                <span class="driver-name">${name}</span>
                <span class="driver-points">${points} pts</span>
            </div>
        `;
    }).join('');
}

function renderProgress() {
    const completedRaces = appData.allRaces.length - remainingRaces.length;
    document.getElementById('races-completed').textContent = completedRaces;
    document.getElementById('races-remaining').textContent = remainingRaces.length;
    document.getElementById('sprints-remaining').textContent = remainingSprints.length;
}

function renderScenarioTabs() {
    const tabsDiv = document.getElementById('race-tabs');
    const panelsDiv = document.getElementById('scenario-panels');
    
    let tabs = '';
    let panels = '';
    
    // Race tabs and panels
    remainingRaces.forEach((race, index) => {
        const tabId = `race-${index}`;
        tabs += `<div class="tab ${index === 0 ? 'active' : ''}" data-tab="${tabId}">
            🏁 ${race.country.substring(0, 3).toUpperCase()}
        </div>`;
        panels += createScenarioPanel(tabId, index, `Race: ${race.country}`, false);
    });
    
    // Sprint tabs and panels
    remainingSprints.forEach((sprint, index) => {
        const tabId = `sprint-${index}`;
        const scenarioIndex = remainingRaces.length + index;
        tabs += `<div class="tab" data-tab="${tabId}">
            ⚡ ${sprint.country.substring(0, 3).toUpperCase()}
        </div>`;
        panels += createScenarioPanel(tabId, scenarioIndex, `Sprint: ${sprint.country}`, true);
    });
    
    tabsDiv.innerHTML = tabs;
    panelsDiv.innerHTML = panels;
}

function createScenarioPanel(tabId, scenarioIndex, title, isSprint) {
    return `
        <div class="scenario-panel ${tabId === 'race-0' ? 'active' : ''}" id="${tabId}">
            <h3>${title}</h3>
            <div class="scenario-list" id="scenarios-${scenarioIndex}">
                <!-- Scenario rows will be added here -->
            </div>
            <button class="btn-add" onclick="addScenarioRow(${scenarioIndex})">+ Add Scenario</button>
        </div>
    `;
}

function addScenarioRow(scenarioIndex) {
    const container = document.getElementById(`scenarios-${scenarioIndex}`);
    const rowIndex = scenarios[scenarioIndex].length;
    
    const row = document.createElement('div');
    row.className = 'scenario-row';
    row.id = `scenario-${scenarioIndex}-${rowIndex}`;
    
    row.innerHTML = `
        <select class="scenario-type" onchange="updateScenarioOptions(${scenarioIndex}, ${rowIndex})">
            <option value="">Select Type</option>
            <option value="position">Set Position</option>
            <option value="above">A Above B</option>
        </select>
        <select class="driver1">
            <option value="">Select Driver</option>
            ${drivers.map(d => `<option value="${d}">${driverNames[d] || `Driver #${d}`}</option>`).join('')}
        </select>
        <select class="driver2-or-position" disabled>
            <option value="">Select Option</option>
        </select>
        <button class="btn-remove" onclick="removeScenarioRow(${scenarioIndex}, ${rowIndex})">✕</button>
    `;
    
    container.appendChild(row);
    scenarios[scenarioIndex].push({ type: '', driver1: '', value: '' });
}

function updateScenarioOptions(scenarioIndex, rowIndex) {
    const row = document.getElementById(`scenario-${scenarioIndex}-${rowIndex}`);
    const typeSelect = row.querySelector('.scenario-type');
    const valueSelect = row.querySelector('.driver2-or-position');
    
    valueSelect.disabled = false;
    
    if (typeSelect.value === 'position') {
        valueSelect.innerHTML = '<option value="">Select Position</option>' +
            Array.from({length: 20}, (_, i) => `<option value="${i+1}">Position ${i+1}</option>`).join('');
    } else if (typeSelect.value === 'above') {
        valueSelect.innerHTML = '<option value="">Select Driver</option>' +
            drivers.map(d => `<option value="${d}">${driverNames[d] || `Driver #${d}`}</option>`).join('');
    } else {
        valueSelect.innerHTML = '<option value="">Select Option</option>';
        valueSelect.disabled = true;
    }
}

function removeScenarioRow(scenarioIndex, rowIndex) {
    const row = document.getElementById(`scenario-${scenarioIndex}-${rowIndex}`);
    if (row) {
        row.remove();
        scenarios[scenarioIndex].splice(rowIndex, 1);
    }
}

function attachEventListeners() {
    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.scenario-panel').forEach(p => p.classList.remove('active'));
            
            tab.classList.add('active');
            document.getElementById(tab.dataset.tab).classList.add('active');
        });
    });
    
    // Simulation button
    document.getElementById('run-simulation').addEventListener('click', runSimulation);
    
    // Realistic simulation button
    document.getElementById('run-realistic-simulation').addEventListener('click', runRealisticSimulation);
    
    // Clear scenarios button
    document.getElementById('clear-scenarios').addEventListener('click', clearAllScenarios);
    
    // Path to Victory button
    document.getElementById('calculate-victory').addEventListener('click', calculatePathToVictory);
}

function clearAllScenarios() {
    for (let i = 0; i < remainingRaces.length + remainingSprints.length; i++) {
        const container = document.getElementById(`scenarios-${i}`);
        if (container) {
            container.innerHTML = '';
        }
        scenarios[i] = [];
    }
}

function collectScenarios() {
    const collected = {};
    
    for (let i = 0; i < remainingRaces.length + remainingSprints.length; i++) {
        const container = document.getElementById(`scenarios-${i}`);
        if (!container) continue;
        
        const rows = container.querySelectorAll('.scenario-row');
        collected[i] = [];
        
        rows.forEach(row => {
            const type = row.querySelector('.scenario-type').value;
            const driver1 = row.querySelector('.driver1').value;
            const value = row.querySelector('.driver2-or-position').value;
            
            if (type && driver1 && value) {
                collected[i].push({ type, driver1: parseInt(driver1), value });
            }
        });
    }
    
    return collected;
}

function runSimulation() {
    const button = document.getElementById('run-simulation');
    button.disabled = true;
    button.textContent = '⏳ Simulating...';
    
    setTimeout(() => {
        try {
            const scenarioData = collectScenarios();
            const results = simulate(scenarioData, 2000, 'standard');
            displayResults(results);
        } catch (error) {
            console.error('Simulation error:', error);
            alert('Simulation failed. Please check your scenarios.');
        } finally {
            button.disabled = false;
            button.textContent = '🎯 Standard Simulation';
        }
    }, 100);
}

function runRealisticSimulation() {
    const button = document.getElementById('run-realistic-simulation');
    button.disabled = true;
    button.textContent = '⏳ Simulating...';
    
    setTimeout(() => {
        try {
            const scenarioData = collectScenarios();
            const results = simulate(scenarioData, 2000, 'realistic');
            displayResults(results);
        } catch (error) {
            console.error('Realistic simulation error:', error);
            alert('Simulation failed. Please check your scenarios.');
        } finally {
            button.disabled = false;
            button.textContent = '🏎️ Realistic Simulation';
        }
    }, 100);
}

function simulate(scenarioData, iterations, simulationType = 'standard') {
    const sortedDrivers = Object.entries(currentPoints)
        .sort(([, a], [, b]) => b - a);
    const top5 = sortedDrivers.slice(0, 5).map(([d]) => parseInt(d));
    const winCounts = {};
    top5.forEach(d => winCounts[d] = 0);

    for (let sim = 0; sim < iterations; sim++) {
        // Start with current points for all drivers
        const simPoints = {};
        drivers.forEach(d => simPoints[d] = currentPoints[d] || 0);

        // Simulate remaining races
        for (let r = 0; r < remainingRaces.length; r++) {
            const order = generateOrder(drivers, scenarioData[r] || [], top5, simulationType);
            // Add race points to finishing positions
            order.forEach((driver, pos) => {
                simPoints[driver] += RACE_POINTS[pos];
            });
        }

        // Simulate remaining sprints
        for (let s = 0; s < remainingSprints.length; s++) {
            const scenarioIndex = remainingRaces.length + s;
            const order = generateOrder(drivers, scenarioData[scenarioIndex] || [], top5, simulationType);
            // Add sprint points (only top 8 score points)
            order.slice(0, 8).forEach((driver, pos) => {
                simPoints[driver] += SPRINT_POINTS[pos];
            });
        }

        // Find the driver with the most points (winner)
        let maxPoints = -1;
        let winner = null;
        for (const [driver, points] of Object.entries(simPoints)) {
            if (points > maxPoints) {
                maxPoints = points;
                winner = parseInt(driver);
            }
        }

        // Count win for this driver if they're in top 5
        if (winCounts[winner] !== undefined) {
            winCounts[winner]++;
        }
    }

    return Object.entries(winCounts)
        .map(([driver, wins]) => ({
            driver: parseInt(driver),
            percentage: (wins / iterations) * 100
        }))
        .sort((a, b) => b.percentage - a.percentage);
}

function generateOrder(driverList, scenarioList, top5Bias, simulationType = 'standard') {
    // Try up to 2000 times to satisfy all constraints
    for (let attempt = 0; attempt < 1000; attempt++) {
        // Start with random order
        let order = [...driverList].sort(() => Math.random() - 0.5);

        // Apply top 5 bias based on simulation type
        let biasChance = 0.5; // Default for standard simulation
        
        if (simulationType === 'realistic') {
            // For realistic simulation: 70% chance top 5 stay in top 5, 10% chance outside top 10
            const rand = Math.random();
            if (rand < 0.6) {
                // 70% chance: top 5 drivers in top 5 positions
                biasChance = 1.0; // Always apply bias
            } else if (rand < 0.8) {
                // 10% chance: top 5 drivers outside top 10
                // Put top 5 drivers in positions 10-19
                const top5InRace = top5Bias.filter(d => driverList.includes(d));
                const others = order.filter(d => !top5InRace.includes(d));
                
                // Shuffle both groups
                top5InRace.sort(() => Math.random() - 0.5);
                others.sort(() => Math.random() - 0.5);
                
                // Put others first (top 10), then top 5 drivers
                order = [...others.slice(0, 10), ...top5InRace, ...others.slice(10)];
                biasChance = 0; // Don't apply additional bias
            } else {
                // 20% chance: normal random (no bias)
                biasChance = 0;
            }
        }

        if (Math.random() < biasChance && top5Bias.length > 0) {
            const top5InRace = top5Bias.filter(d => driverList.includes(d));
            const others = order.filter(d => !top5InRace.includes(d));
            // Shuffle both groups
            top5InRace.sort(() => Math.random() - 0.5);
            others.sort(() => Math.random() - 0.5);
            // Put top 5 first, then others
            order = [...top5InRace, ...others];
        }

        // Apply scenarios
        let valid = true;
        for (const scenario of scenarioList) {
            if (scenario.type === 'position') {
                // Set specific position
                const pos = parseInt(scenario.value) - 1; // Convert to 0-based
                const driverIndex = order.indexOf(scenario.driver1);
                if (driverIndex !== -1 && pos < order.length) {
                    // Swap the driver to the desired position
                    [order[driverIndex], order[pos]] = [order[pos], order[driverIndex]];
                }
            } else if (scenario.type === 'above') {
                // Ensure driver1 finishes above driver2
                const driver1Idx = order.indexOf(scenario.driver1);
                const driver2Idx = order.indexOf(parseInt(scenario.value));
                if (driver1Idx !== -1 && driver2Idx !== -1) {
                    if (driver1Idx > driver2Idx) {
                        // Driver1 is below driver2, which violates the constraint
                        valid = false;
                        break;
                    }
                }
            }
        }

        if (valid) {
            return order;
        }
    }

    // Fallback: return random order if constraints can't be satisfied
    return [...driverList].sort(() => Math.random() - 0.5);
}

function displayResults(results) {
    const resultsSection = document.getElementById('results-section');
    const resultsDiv = document.getElementById('results');
    
    resultsDiv.innerHTML = results.map(result => {
        const name = driverNames[result.driver] || `Driver #${result.driver}`;
        const driverNumber = result.driver;
        return `
            <div class="result-card">
                <span class="result-driver">${name} <span class="driver-number">(#${driverNumber})</span></span>
                <div class="result-bar">
                    <div class="result-bar-fill" style="width: ${result.percentage}%"></div>
                </div>
                <span class="result-percentage">${result.percentage.toFixed(1)}%</span>
            </div>
        `;
    }).join('');
    
    resultsSection.style.display = 'block';
    
    // Show winner animation if someone has >50% chance
    if (results[0].percentage > 50) {
        showWinnerAnimation(results[0].driver);
    }
    
    // Scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth' });
}

function showWinnerAnimation(driverNum) {
    const animDiv = document.getElementById('winner-animation');
    const name = driverNames[driverNum] || `Driver #${driverNum}`;
    document.getElementById('winner-text').textContent = `🏆 ${name} is the likely champion! 🏆`;
    animDiv.style.display = 'block';
}

// Path to Victory Calculator
function populateVictoryDrivers() {
    const select = document.getElementById('victory-driver');
    const sortedDrivers = Object.entries(currentPoints)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10); // Top 10 drivers only
    
    select.innerHTML = '<option value="">Select a driver...</option>' +
        sortedDrivers.map(([driverNum, points]) => {
            const name = driverNames[driverNum] || `Driver #${driverNum}`;
            return `<option value="${driverNum}">${name} (${points} pts)</option>`;
        }).join('');
}

function calculatePathToVictory() {
    const driverSelect = document.getElementById('victory-driver');
    const targetDriver = parseInt(driverSelect.value);
    
    if (!targetDriver) {
        alert('Please select a driver first!');
        return;
    }
    
    const button = document.getElementById('calculate-victory');
    button.disabled = true;
    button.textContent = '⏳ Calculating...';
    
    setTimeout(() => {
        try {
            const analysis = analyzeVictoryPath(targetDriver);
            displayVictoryPath(targetDriver, analysis);
        } catch (error) {
            console.error('Victory calculation error:', error);
            alert('Calculation failed. Please try again.');
        } finally {
            button.disabled = false;
            button.textContent = '✨ Calculate Path to Victory';
        }
    }, 100);
}

function analyzeVictoryPath(targetDriver) {
    const sortedDrivers = Object.entries(currentPoints)
        .sort(([, a], [, b]) => b - a);
    
    const targetCurrentPoints = currentPoints[targetDriver] || 0;
    const targetPosition = sortedDrivers.findIndex(([d]) => parseInt(d) === targetDriver) + 1;
    
    // Calculate remaining points available
    const totalRemainingRaces = remainingRaces.length;
    const totalRemainingSprints = remainingSprints.length;
    const maxPossiblePoints = (totalRemainingRaces * 25) + (totalRemainingSprints * 8);
    const targetMaxPoints = targetCurrentPoints + maxPossiblePoints;
    
    // Get all drivers who could theoretically win (within 25*remainingRaces points)
    const maxReasonableGap = 25 * Math.min(totalRemainingRaces, 3); // Within 3 race wins
    const potentialChampions = sortedDrivers.filter(([driver, points]) => {
        const gap = targetCurrentPoints - points;
        return gap + maxPossiblePoints >= 0 || points - targetCurrentPoints <= maxReasonableGap;
    }).slice(0, 8); // Top 8 potential champions
    
    // Check mathematical possibility
    const leaderPoints = sortedDrivers[0][1];
    const mathematicalGap = leaderPoints - targetMaxPoints;
    const mathematicallyPossible = mathematicalGap < 0;
    
    if (!mathematicallyPossible) {
        return {
            targetCurrentPoints,
            targetPosition,
            mathematicallyPossible: false,
            eliminationGap: mathematicalGap,
            rivalAnalysis: []
        };
    }
    
    // Analyze each potential rival
    const rivalAnalysis = [];
    
    for (const [rivalNum, rivalPoints] of potentialChampions) {
        const rival = parseInt(rivalNum);
        if (rival === targetDriver) continue;
        
        const pointsGap = rivalPoints - targetCurrentPoints;
        const analysis = calculateDetailedRivalStrategy(
            targetDriver, rival, pointsGap, 
            totalRemainingRaces, totalRemainingSprints
        );
        
        rivalAnalysis.push({
            driver: rival,
            name: driverNames[rival] || `Driver #${rival}`,
            currentPoints: rivalPoints,
            gap: pointsGap,
            ...analysis
        });
    }
    
    // Calculate what target driver needs to do
    const targetRequirements = calculateTargetRequirements(
        targetDriver, rivalAnalysis, totalRemainingRaces, totalRemainingSprints
    );
    
    return {
        targetCurrentPoints,
        targetPosition,
        mathematicallyPossible: true,
        maxPossiblePoints,
        targetMaxPoints,
        totalRemainingRaces,
        totalRemainingSprints,
        rivalAnalysis,
        targetRequirements
    };
}

function calculateDetailedRivalStrategy(targetDriver, rivalDriver, pointsGap, races, sprints) {
    const maxRivalPoints = (races * 25) + (sprints * 8);
    const maxTargetPoints = (races * 25) + (sprints * 8);
    
    // Points rival can score while still losing to target
    const maxRivalPointsAllowed = currentPoints[targetDriver] + maxTargetPoints - currentPoints[rivalDriver] - 1;
    const pointsRivalMustDrop = maxRivalPoints - maxRivalPointsAllowed;
    
    if (pointsRivalMustDrop <= 0) {
        return {
            severity: 'easy',
            strategy: 'target_wins_easily',
            conditions: ['No specific restrictions needed - target wins even if rival maximizes points'],
            requiredFinishes: [],
            riskLevel: 'low'
        };
    }
    
    // Calculate realistic constraints
    const totalEvents = races + sprints;
    const avgPointsPerEvent = pointsRivalMustDrop / totalEvents;
    
    // Determine required performance level
    let requiredAvgFinish = 20; // Default: outside points
    let strategy = 'moderate_restrictions';
    let severity = 'moderate';
    let riskLevel = 'medium';
    
    const conditions = [];
    const requiredFinishes = [];
    
    if (pointsRivalMustDrop >= maxRivalPoints) {
        // Must score zero points
        strategy = 'elimination_needed';
        severity = 'impossible';
        riskLevel = 'elimination';
        conditions.push('❌ Must be eliminated from all remaining events (DNF/DSQ)');
        requiredFinishes.push({ type: 'elimination', count: totalEvents, description: 'DNF in all events' });
    } else if (avgPointsPerEvent >= 20) {
        // Must finish outside top 10 consistently
        const maxPointsFinishes = Math.floor((maxRivalPoints - pointsRivalMustDrop) / 2); // P9-P10 = 2pts each
        const outsidePointsRaces = Math.max(0, races - maxPointsFinishes);
        strategy = 'outside_points';
        severity = 'very_hard';
        riskLevel = 'high';
        conditions.push(`🚫 Must finish outside top 10 in ${outsidePointsRaces} race${outsidePointsRaces !== 1 ? 's' : ''}`);
        requiredFinishes.push({ 
            type: 'outside_top10', 
            count: outsidePointsRaces, 
            description: `P11+ in ${outsidePointsRaces} race${outsidePointsRaces !== 1 ? 's' : ''}` 
        });
    } else if (avgPointsPerEvent >= 15) {
        // Can't podium regularly
        const maxPodiums = Math.floor((maxRivalPoints - pointsRivalMustDrop) / 15); // P3 = 15pts
        const racesWithoutPodium = Math.max(0, races - maxPodiums);
        strategy = 'no_podiums';
        severity = 'hard';
        riskLevel = 'high';
        conditions.push(`🥉 Can podium in at most ${maxPodiums} race${maxPodiums !== 1 ? 's' : ''}`);
        conditions.push(`🚫 Must finish outside top 3 in ${racesWithoutPodium} race${racesWithoutPodium !== 1 ? 's' : ''}`);
        requiredFinishes.push({ 
            type: 'no_podium', 
            count: racesWithoutPodium, 
            description: `Outside top 3 in ${racesWithoutPodium} race${racesWithoutPodium !== 1 ? 's' : ''}` 
        });
    } else if (avgPointsPerEvent >= 10) {
        // Can't win regularly
        const maxWins = Math.floor((maxRivalPoints - pointsRivalMustDrop) / 25);
        const racesWithoutWin = Math.max(0, races - maxWins);
        strategy = 'limited_wins';
        severity = 'moderate';
        riskLevel = 'medium';
        conditions.push(`🏆 Can win at most ${maxWins} race${maxWins !== 1 ? 's' : ''}`);
        conditions.push(`🥈 Must finish P2 or worse in ${racesWithoutWin} race${racesWithoutWin !== 1 ? 's' : ''}`);
        requiredFinishes.push({ 
            type: 'limited_wins', 
            count: racesWithoutWin, 
            description: `P2+ in ${racesWithoutWin} race${racesWithoutWin !== 1 ? 's' : ''}` 
        });
    } else {
        // Can still score but must underperform
        const avgFinishNeeded = getPositionFromPoints(Math.floor(avgPointsPerEvent));
        strategy = 'underperform';
        severity = 'easy';
        riskLevel = 'low';
        conditions.push(`📊 Must average around P${avgFinishNeeded} or worse across events`);
        conditions.push(`⚠️ Must drop ${pointsRivalMustDrop} points vs maximum possible`);
    }
    
    // Sprint-specific constraints
    if (sprints > 0 && pointsRivalMustDrop > 10) {
        const sprintPointsToLose = Math.min(pointsRivalMustDrop * 0.4, sprints * 8);
        const maxSprintWins = Math.floor((sprints * 8 - sprintPointsToLose) / 8);
        if (maxSprintWins < sprints) {
            conditions.push(`⚡ Can win at most ${maxSprintWins} sprint${maxSprintWins !== 1 ? 's' : ''}`);
            requiredFinishes.push({ 
                type: 'sprint_limit', 
                count: sprints - maxSprintWins, 
                description: `P2+ in ${sprints - maxSprintWins} sprint${(sprints - maxSprintWins) !== 1 ? 's' : ''}` 
            });
        }
    }
    
    return {
        severity,
        strategy,
        conditions,
        requiredFinishes,
        riskLevel,
        pointsToDrop: pointsRivalMustDrop,
        maxPointsAllowed: maxRivalPointsAllowed
    };
}

function calculateTargetRequirements(targetDriver, rivalAnalysis, races, sprints) {
    // Find the most restrictive rival constraint
    const hardestRival = rivalAnalysis.reduce((hardest, current) => {
        const severityOrder = { 'impossible': 5, 'very_hard': 4, 'hard': 3, 'moderate': 2, 'easy': 1 };
        return severityOrder[current.severity] > severityOrder[hardest.severity] ? current : hardest;
    });
    
    const requirements = [];
    const totalEvents = races + sprints;
    
    // Target needs to maximize points while rivals are constrained
    if (hardestRival.severity === 'easy') {
        requirements.push({
            type: 'maximize',
            description: '🏆 Win as many races as possible to secure championship',
            priority: 'high'
        });
        requirements.push({
            type: 'consistent',
            description: '🥇 Finish in top 3 in most races to maintain pressure',
            priority: 'medium'
        });
    } else if (hardestRival.severity === 'moderate') {
        requirements.push({
            type: 'aggressive',
            description: `🏆 Win ${Math.ceil(races * 0.6)} races to create decisive gap`,
            priority: 'high'
        });
        requirements.push({
            type: 'pressure',
            description: '⚡ Maximize points in sprint races for extra cushion',
            priority: 'medium'
        });
    } else {
        requirements.push({
            type: 'dominant',
            description: `🏆 Win ${Math.ceil(races * 0.8)} races and podium in remaining`,
            priority: 'critical'
        });
        requirements.push({
            type: 'perfect',
            description: '🥇 P1 or P2 in every remaining event',
            priority: 'critical'
        });
        requirements.push({
            type: 'no_errors',
            description: '🛡️ Avoid DNFs and mechanical issues',
            priority: 'critical'
        });
    }
    
    // Calculate required win percentage
    const targetGap = hardestRival.gap;
    const pointsNeeded = Math.max(0, targetGap + 1);
    const avgPointsNeeded = pointsNeeded / totalEvents;
    
    if (avgPointsNeeded >= 20) {
        requirements.push({
            type: 'win_most',
            description: `🏆 Win ${Math.ceil(pointsNeeded / 25)} races minimum`,
            priority: 'critical'
        });
    } else if (avgPointsNeeded >= 15) {
        requirements.push({
            type: 'podium_most',
            description: `🥉 Podium in ${Math.ceil(pointsNeeded / 15)} events minimum`,
            priority: 'high'
        });
    }
    
    return requirements;
}



function displayVictoryPath(targetDriver, analysis) {
    const resultsDiv = document.getElementById('victory-results');
    const name = driverNames[targetDriver] || `Driver #${targetDriver}`;
    
    if (!analysis.mathematicallyPossible) {
        resultsDiv.innerHTML = `
            <div class="victory-header">
                <h3>🎯 Path to Victory: ${name}</h3>
            </div>
            <div class="condition-card condition-impossible">
                <h4>❌ Mathematically Eliminated</h4>
                <p>${name} cannot win the championship even with maximum points in all remaining events.</p>
                <p style="margin-top: 15px;">
                    <strong>Current:</strong> ${analysis.targetCurrentPoints} pts (P${analysis.targetPosition})<br>
                    <strong>Gap to leader:</strong> ${analysis.eliminationGap} points<br>
                    <strong>Max possible:</strong> ${analysis.targetCurrentPoints + analysis.maxPossiblePoints} pts
                </p>
            </div>
        `;
    } else {
        // Calculate overall difficulty
        const difficultyRating = getOverallDifficulty(analysis.rivalAnalysis);
        
        let summaryHTML = `
            <div class="victory-summary">
                <div class="summary-stats">
                    <div class="stat-item">
                        <span class="stat-label">Current Position</span>
                        <span class="stat-value">P${analysis.targetPosition}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Current Points</span>
                        <span class="stat-value">${analysis.targetCurrentPoints}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Max Possible</span>
                        <span class="stat-value">${analysis.targetMaxPoints}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Remaining Events</span>
                        <span class="stat-value">${analysis.totalRemainingRaces}R + ${analysis.totalRemainingSprints}S</span>
                    </div>
                </div>
                <div class="difficulty-indicator ${difficultyRating.class}">
                    <span class="difficulty-icon">${difficultyRating.icon}</span>
                    <span class="difficulty-text">${difficultyRating.text}</span>
                </div>
            </div>
        `;
        
        // Target driver requirements
        const targetNeedsHTML = `
            <div class="condition-card condition-target">
                <h4>✅ ${name} Must Deliver:</h4>
                <ul class="condition-list">
                    ${analysis.targetRequirements.map(req => `
                        <li class="priority-${req.priority}">
                            <span class="condition-icon">${getRequirementIcon(req.type)}</span>
                            <strong>${req.description}</strong>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
        
        // Rival constraints - show top 4 most challenging
        const sortedRivals = analysis.rivalAnalysis
            .sort((a, b) => {
                const severityOrder = { 'impossible': 5, 'very_hard': 4, 'hard': 3, 'moderate': 2, 'easy': 1 };
                return severityOrder[b.severity] - severityOrder[a.severity];
            })
            .slice(0, 4);
        
        let rivalsHTML = sortedRivals.map(rival => {
            const gapText = rival.gap > 0 ? `+${rival.gap}` : rival.gap;
            return `
                <div class="condition-card condition-${rival.severity}">
                    <h4>🎯 ${rival.name} (${rival.currentPoints} pts, ${gapText})</h4>
                    <div class="rival-strategy">
                        <p><strong>Strategy:</strong> ${getStrategyDescription(rival.strategy)}</p>
                        <p><strong>Risk Level:</strong> ${getRiskDescription(rival.riskLevel)}</p>
                        ${rival.pointsToDrop > 0 ? `<p><strong>Points to Drop:</strong> ${rival.pointsToDrop}</p>` : ''}
                    </div>
                    <ul class="condition-list">
                        ${rival.conditions.map(cond => `<li><span class="condition-icon">${getConditionIcon(cond)}</span> ${cond}</li>`).join('')}
                    </ul>
                    ${rival.requiredFinishes.length > 0 ? `
                        <div class="required-finishes">
                            <strong>Specific Requirements:</strong>
                            <ul>
                                ${rival.requiredFinishes.map(finish => `<li>${finish.description}</li>`).join('')}
                            </ul>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
        
        resultsDiv.innerHTML = `
            <div class="victory-header">
                <h3>🎯 Path to Victory: ${name}</h3>
                <p class="victory-subtitle">Detailed analysis of championship requirements</p>
            </div>
            ${summaryHTML}
            <div class="victory-conditions">
                ${targetNeedsHTML}
                <div class="rivals-section">
                    <h4>🎯 Rival Constraints:</h4>
                    ${rivalsHTML}
                </div>
            </div>
        `;
    }
    
    resultsDiv.style.display = 'block';
    resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function getOverallDifficulty(rivalAnalysis) {
    const severities = rivalAnalysis.map(r => r.severity);
    const riskLevels = rivalAnalysis.map(r => r.riskLevel);
    
    if (severities.includes('impossible')) {
        return { class: 'impossible', icon: '🔴', text: 'Mathematically Impossible' };
    }
    if (severities.filter(s => s === 'very_hard').length >= 2 || riskLevels.includes('elimination')) {
        return { class: 'very-hard', icon: '🔴', text: 'Extremely Difficult' };
    }
    if (severities.includes('very_hard') || riskLevels.filter(r => r === 'high').length >= 2) {
        return { class: 'hard', icon: '🟠', text: 'Very Difficult' };
    }
    if (severities.filter(s => s === 'hard').length >= 2 || riskLevels.includes('high')) {
        return { class: 'moderate', icon: '🟡', text: 'Challenging' };
    }
    if (severities.includes('hard') || severities.includes('moderate')) {
        return { class: 'moderate', icon: '🟢', text: 'Possible' };
    }
    return { class: 'easy', icon: '🟢', text: 'Favorable' };
}

function getStrategyDescription(strategy) {
    const descriptions = {
        'target_wins_easily': 'No restrictions needed',
        'moderate_restrictions': 'Some performance limitations',
        'underperform': 'Must underperform vs potential',
        'limited_wins': 'Cannot win regularly',
        'no_podiums': 'Cannot podium regularly',
        'outside_points': 'Must finish outside points regularly',
        'elimination_needed': 'Must be eliminated from events'
    };
    return descriptions[strategy] || strategy;
}

function getRiskDescription(riskLevel) {
    const descriptions = {
        'low': '🟢 Low - Favorable conditions',
        'medium': '🟡 Medium - Requires good performance',
        'high': '🟠 High - Demands exceptional performance',
        'elimination': '🔴 Critical - Requires rival elimination'
    };
    return descriptions[riskLevel] || riskLevel;
}

function getRequirementIcon(type) {
    const icons = {
        'maximize': '🏆',
        'aggressive': '🏆',
        'dominant': '👑',
        'perfect': '💎',
        'no_errors': '🛡️',
        'win_most': '🏆',
        'podium_most': '🥉',
        'consistent': '📈',
        'pressure': '⚡'
    };
    return icons[type] || '✅';
}


function getConditionIcon(condition) {
    if (condition.includes('Cannot win') || condition.includes('not score')) return '🚫';
    if (condition.includes('podium')) return '🥉';
    if (condition.includes('win')) return '🏆';
    if (condition.includes('sprint')) return '⚡';
    if (condition.includes('average')) return '📊';
    return '⚠️';
}

// Start the app
init();
