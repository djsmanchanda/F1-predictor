// Global state
let appData = null;
let scenarios = {};
let currentPoints = {};
let driverNames = {};
let drivers = [];
let remainingRaces = [];
let remainingSprints = [];

// Constants
const RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

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

// Simulation logic
function runSimulation() {
    const button = document.getElementById('run-simulation');
    button.disabled = true;
    button.textContent = '⏳ Simulating...';
    
    setTimeout(() => {
        try {
            const scenarioData = collectScenarios();
            const results = simulate(scenarioData, 1000);
            displayResults(results);
        } catch (error) {
            console.error('Simulation error:', error);
            alert('Simulation failed. Please check your scenarios.');
        } finally {
            button.disabled = false;
            button.textContent = '🚀 Run Simulation (1000 iterations)';
        }
    }, 100);
}

function simulate(scenarioData, iterations) {
    const sortedDrivers = Object.entries(currentPoints)
        .sort(([, a], [, b]) => b - a);
    const top5 = sortedDrivers.slice(0, 5).map(([d]) => parseInt(d));
    const winCounts = {};
    top5.forEach(d => winCounts[d] = 0);
    
    for (let sim = 0; sim < iterations; sim++) {
        const simPoints = {};
        drivers.forEach(d => simPoints[d] = currentPoints[d] || 0);
        
        // Simulate races
        for (let r = 0; r < remainingRaces.length; r++) {
            const order = generateOrder(drivers, scenarioData[r] || [], top5);
            order.forEach((driver, pos) => {
                simPoints[driver] += RACE_POINTS[pos];
            });
        }
        
        // Simulate sprints
        for (let s = 0; s < remainingSprints.length; s++) {
            const scenarioIndex = remainingRaces.length + s;
            const order = generateOrder(drivers, scenarioData[scenarioIndex] || [], top5);
            order.slice(0, 8).forEach((driver, pos) => {
                simPoints[driver] += SPRINT_POINTS[pos];
            });
        }
        
        const winner = Object.entries(simPoints).reduce((a, b) => simPoints[a[0]] > simPoints[b[0]] ? a : b)[0];
        if (winCounts[parseInt(winner)] !== undefined) {
            winCounts[parseInt(winner)]++;
        }
    }
    
    return Object.entries(winCounts)
        .map(([driver, wins]) => ({
            driver: parseInt(driver),
            percentage: (wins / iterations) * 100
        }))
        .sort((a, b) => b.percentage - a.percentage);
}

function generateOrder(driverList, scenarioList, top5Bias) {
    for (let attempt = 0; attempt < 100; attempt++) {
        let order = [...driverList].sort(() => Math.random() - 0.5).slice(0, 20);
        
        // Apply bias to top 5 (50% chance they appear in top 5)
        if (Math.random() < 0.5 && top5Bias.length > 0) {
            const top5InRace = top5Bias.filter(d => driverList.includes(d));
            const others = order.filter(d => !top5InRace.includes(d));
            top5InRace.sort(() => Math.random() - 0.5);
            others.sort(() => Math.random() - 0.5);
            order = [...top5InRace.slice(0, 5), ...others].slice(0, 20);
        }
        
        // Apply scenarios
        let valid = true;
        for (const scenario of scenarioList) {
            if (scenario.type === 'position') {
                const pos = parseInt(scenario.value) - 1;
                const driverIndex = order.indexOf(scenario.driver1);
                if (driverIndex !== -1 && pos < 20) {
                    [order[driverIndex], order[pos]] = [order[pos], order[driverIndex]];
                }
            } else if (scenario.type === 'above') {
                const driver1Idx = order.indexOf(scenario.driver1);
                const driver2Idx = order.indexOf(parseInt(scenario.value));
                if (driver1Idx !== -1 && driver2Idx !== -1 && driver1Idx > driver2Idx) {
                    valid = false;
                    break;
                }
            }
        }
        
        if (valid) return order;
    }
    
    return [...driverList].sort(() => Math.random() - 0.5).slice(0, 20);
}

function displayResults(results) {
    const resultsSection = document.getElementById('results-section');
    const resultsDiv = document.getElementById('results');
    
    resultsDiv.innerHTML = results.map(result => {
        const name = driverNames[result.driver] || `Driver #${result.driver}`;
        return `
            <div class="result-card">
                <span class="result-driver">${name}</span>
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
    const top5 = sortedDrivers.slice(0, 5).map(([d]) => parseInt(d));
    
    // Calculate maximum possible points
    const totalRemainingRaces = remainingRaces.length;
    const totalRemainingSprints = remainingSprints.length;
    const maxPossiblePoints = (totalRemainingRaces * 25) + (totalRemainingSprints * 8);
    const targetMaxPoints = targetCurrentPoints + maxPossiblePoints;
    
    // Analyze each rival in top 5
    const rivalAnalysis = [];
    
    for (const [rivalNum, rivalPoints] of sortedDrivers.slice(0, 5)) {
        const rival = parseInt(rivalNum);
        if (rival === targetDriver) continue;
        
        const pointsGap = rivalPoints - targetCurrentPoints;
        
        // Calculate how many points rival can drop
        const maxRivalCanScore = maxPossiblePoints;
        const minPointsRivalNeeds = targetMaxPoints - rivalPoints + 1; // Points needed to beat target's max
        const maxPointsRivalCanHave = targetMaxPoints - 1; // Max rival can have while target wins
        const pointsRivalMustDrop = (rivalPoints + maxRivalCanScore) - maxPointsRivalCanHave;
        
        if (pointsRivalMustDrop <= 0) {
            // Target can win even if rival gets max points
            rivalAnalysis.push({
                driver: rival,
                name: driverNames[rival] || `Driver #${rival}`,
                currentPoints: rivalPoints,
                gap: pointsGap,
                mustDrop: 0,
                severity: 'easy',
                conditions: ['No specific restrictions needed']
            });
        } else {
            // Calculate restrictions
            const conditions = calculateRestrictions(pointsRivalMustDrop, totalRemainingRaces, totalRemainingSprints);
            rivalAnalysis.push({
                driver: rival,
                name: driverNames[rival] || `Driver #${rival}`,
                currentPoints: rivalPoints,
                gap: pointsGap,
                mustDrop: pointsRivalMustDrop,
                severity: conditions.severity,
                conditions: conditions.restrictions
            });
        }
    }
    
    // Check if mathematically possible
    const leadingDriver = sortedDrivers[0];
    const leaderPoints = parseInt(leadingDriver[1]);
    const leaderMaxPoints = leaderPoints + maxPossiblePoints;
    const impossible = targetMaxPoints < leaderPoints;
    
    return {
        targetCurrentPoints,
        targetPosition,
        maxPossiblePoints,
        targetMaxPoints,
        totalRemainingRaces,
        totalRemainingSprints,
        impossible,
        rivalAnalysis: rivalAnalysis.filter(r => r.driver !== targetDriver)
    };
}

function calculateRestrictions(pointsToPrevent, races, sprints) {
    const restrictions = [];
    let severity = 'hard';
    
    // Calculate how many wins rival needs to prevent
    const maxWinPoints = 25;
    const maxSprintPoints = 8;
    const totalEvents = races + sprints;
    
    // Simple restriction: max podiums or wins
    const maxPodiums = Math.floor((pointsToPrevent) / 15); // Avg podium = 15pts
    const maxWins = Math.floor(pointsToPrevent / 25);
    const maxTop5 = Math.floor(pointsToPrevent / 10);
    
    if (pointsToPrevent >= maxPossiblePoints) {
        restrictions.push('❌ Must not score ANY points in remaining events');
        severity = 'impossible';
    } else if (maxWins === 0) {
        restrictions.push('🚫 Cannot win any races');
        const maxTopFinishes = Math.floor((pointsToPrevent) / 18); // P2 = 18pts
        if (maxTopFinishes <= races / 2) {
            restrictions.push(`🚫 Can finish P2 in at most ${maxTopFinishes} race${maxTopFinishes !== 1 ? 's' : ''}`);
        }
        restrictions.push(`⚠️ Must finish outside top 3 in ${races - maxPodiums} or more races`);
        severity = 'very-hard';
    } else if (maxWins < races / 3) {
        restrictions.push(`🏆 Can win at most ${maxWins} race${maxWins !== 1 ? 's' : ''}`);
        restrictions.push(`🥉 Can finish on podium in at most ${maxPodiums} event${maxPodiums !== 1 ? 's' : ''}`);
        severity = 'hard';
    } else {
        const avgFinishNeeded = Math.floor(pointsToPrevent / totalEvents);
        if (avgFinishNeeded < 10) {
            restrictions.push(`📊 Must average P${getPositionFromPoints(avgFinishNeeded)} or worse`);
        }
        restrictions.push(`⚠️ Must drop at least ${pointsToPrevent} points vs maximum possible`);
        severity = 'moderate';
    }
    
    // Sprint specific
    if (sprints > 0 && pointsToPrevent > 20) {
        const sprintPointsToLose = Math.min(pointsToPrevent / 2, sprints * 8);
        const maxSprintWins = Math.floor((sprints * 8 - sprintPointsToLose) / 8);
        if (maxSprintWins < sprints / 2) {
            restrictions.push(`⚡ Can win at most ${maxSprintWins} sprint${maxSprintWins !== 1 ? 's' : ''}`);
        }
    }
    
    return { restrictions, severity };
}

function getPositionFromPoints(points) {
    const positions = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
    for (let i = 0; i < positions.length; i++) {
        if (points >= positions[i]) return i + 1;
    }
    return 10;
}

function displayVictoryPath(targetDriver, analysis) {
    const resultsDiv = document.getElementById('victory-results');
    const name = driverNames[targetDriver] || `Driver #${targetDriver}`;
    
    if (analysis.impossible) {
        resultsDiv.innerHTML = `
            <div class="victory-header">
                <h3>Path to Victory: ${name}</h3>
            </div>
            <div class="condition-card condition-impossible">
                <h4>❌ Mathematically Eliminated</h4>
                <p>${name} cannot win the championship even with maximum points in all remaining events.</p>
                <p style="margin-top: 15px;">
                    <strong>Current:</strong> ${analysis.targetCurrentPoints} pts (P${analysis.targetPosition})<br>
                    <strong>Max Possible:</strong> ${analysis.targetMaxPoints} pts<br>
                    <strong>Gap:</strong> ${analysis.rivalAnalysis[0].currentPoints - analysis.targetCurrentPoints} points behind leader
                </p>
            </div>
        `;
    } else {
        const targetIsInTop5 = analysis.targetPosition <= 5;
        const difficultRivals = analysis.rivalAnalysis.filter(r => r.severity === 'hard' || r.severity === 'very-hard').length;
        
        let summaryHTML = `
            <div class="victory-summary">
                <p><strong>Current Position:</strong> P${analysis.targetPosition} with ${analysis.targetCurrentPoints} points</p>
                <p><strong>Maximum Possible:</strong> ${analysis.targetMaxPoints} points</p>
                <p><strong>Remaining Events:</strong> ${analysis.totalRemainingRaces} races, ${analysis.totalRemainingSprints} sprints</p>
                <p><strong>Difficulty:</strong> ${getDifficultyRating(analysis.rivalAnalysis)}</p>
            </div>
        `;
        
        // Target driver requirements
        const targetNeeds = `
            <div class="condition-card">
                <h4>✅ ${name} Must:</h4>
                <ul class="condition-list">
                    <li><span class="condition-icon">🏆</span> Win most remaining races to maximize points</li>
                    <li><span class="condition-icon">🥇</span> Aim for P1 or P2 in every event</li>
                    <li><span class="condition-icon">⚡</span> Score maximum points in sprint races</li>
                    <li><span class="condition-icon">📈</span> Gain ${analysis.rivalAnalysis[0].gap > 0 ? analysis.rivalAnalysis[0].gap + ' points on leader' : 'maintain lead'}</li>
                </ul>
            </div>
        `;
        
        // Rival requirements
        let rivalsHTML = analysis.rivalAnalysis.slice(0, 4).map(rival => `
            <div class="condition-card ${rival.severity === 'impossible' ? 'condition-impossible' : ''}">
                <h4>🎯 ${rival.name} (${rival.currentPoints} pts, ${rival.gap > 0 ? '+' + rival.gap : rival.gap})</h4>
                <ul class="condition-list">
                    ${rival.conditions.map(cond => `<li><span class="condition-icon">${getConditionIcon(cond)}</span> ${cond}</li>`).join('')}
                </ul>
            </div>
        `).join('');
        
        resultsDiv.innerHTML = `
            <div class="victory-header">
                <h3>🎯 Path to Victory: ${name}</h3>
            </div>
            ${summaryHTML}
            <div class="victory-conditions">
                ${targetNeeds}
                ${rivalsHTML}
            </div>
        `;
    }
    
    resultsDiv.style.display = 'block';
    resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function getDifficultyRating(rivalAnalysis) {
    const severities = rivalAnalysis.map(r => r.severity);
    if (severities.includes('impossible')) return '🔴 Impossible';
    if (severities.filter(s => s === 'very-hard').length >= 2) return '🔴 Extremely Difficult';
    if (severities.includes('very-hard')) return '🟠 Very Difficult';
    if (severities.filter(s => s === 'hard').length >= 2) return '🟡 Difficult';
    if (severities.includes('hard')) return '🟡 Challenging';
    return '🟢 Possible';
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
