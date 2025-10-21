//public/app.js
// Global state
let appData = null;
let scenarios = {};
let currentPoints = {};
let driverNames = {};
let drivers = [];
let remainingRaces = [];
let remainingSprints = [];
let lastResults = null; // most recent simulation results for sharing
let lastSimulationType = 'std';

// Constants
const RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1].concat(Array(10).fill(0)); // 20 positions
const SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1].concat(Array(12).fill(0)); // 20 positions, but only top 8 score
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// Initialize app
async function init() {
    try {
        showLoading(true);
        await loadData();
        processData();
        renderUI();
        // Apply scenarios from URL (if present) before wiring events
        const autoRun = applyScenariosFromURL();
        attachEventListeners();
        showLoading(false);
        document.getElementById('app').style.display = 'block';
        // If URL had scenarios, auto-run the requested simulation mode
        if (autoRun && autoRun.shouldRun) {
            if (autoRun.sim === 'real') {
                runRealisticSimulation();
            } else {
                runSimulation();
            }
        }
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
    const sortedAll = Object.entries(currentPoints)
        .sort(([, a], [, b]) => b - a);
    const sortedDrivers = sortedAll.slice(0, 10);

    // Determine leader and mathematical contenders
    const leaderPoints = sortedAll.length ? sortedAll[0][1] : 0;
    const leaderDriver = sortedAll.length ? parseInt(sortedAll[0][0]) : null;
    const maxRacePoints = remainingRaces.length * 25;
    const maxSprintPoints = remainingSprints.length * 8;
    const maxFastestLaps = remainingRaces.length * 1;
    const maxPossiblePoints = maxRacePoints + maxSprintPoints + maxFastestLaps;

    standingsDiv.innerHTML = sortedDrivers.map(([driverNum, points], index) => {
        const name = driverNames[driverNum] || `Driver #${driverNum}`;
        const driverId = parseInt(driverNum);
        const isLeader = driverId === leaderDriver;
        const canStillWin = (points + maxPossiblePoints) >= leaderPoints;
        const cardClass = isLeader ? 'driver-card leader' : (canStillWin ? 'driver-card contender' : 'driver-card');
        return `
            <div class="${cardClass}">
                <span class="driver-position">${index + 1}</span>
                <img class="driver-number-badge" src="driver-numbers/${driverId}.png" alt="#${driverId} badge" loading="lazy" onerror="this.style.display='none'" />
                <span class="driver-name">${name}</span>
            </div>
        `;
    }).join('');
}

// ===== Compressed URL encoding/decoding =====
// Bit layout:
// header: version(3) simType(1: 0=std,1=real) eventCount(6: 0..32)
// per event: eventType(1:0=race,1=sprint) round(5: 0-based) scenarioCount(4: 0..8)
// per scenario: type(1: 0=position,1=above) driver1(7: direct driver number 1..127) value(7: pos-1 for position, or driver2 number 1..127)

function encodeCompressedScenarios(simulationType = 'std') {
    const collected = collectScenarios();
    // Build event blocks with non-empty scenarios
    const blocks = [];
    const total = remainingRaces.length + remainingSprints.length;
    for (let i = 0; i < total; i++) {
        const list = collected[i] || [];
        if (!list.length) continue;
        const isRace = i < remainingRaces.length;
        const remIdx = isRace ? i : (i - remainingRaces.length);
        const round = getEventRoundFromRemaining(isRace ? 'race' : 'sprint', remIdx);
        if (!round) continue;
        // Convert scenarios using direct driver numbers (1..127)
        const converted = [];
        for (const s of list.slice(0, 8)) {
            const d1 = parseInt(s.driver1, 10);
            if (!Number.isFinite(d1) || d1 < 1 || d1 > 127) continue;
            if (s.type === 'position') {
                const pos = Math.max(1, Math.min(20, parseInt(s.value, 10) || 1));
                converted.push({ t: 0, d1, v: (pos - 1) & 127 });
            } else if (s.type === 'above') {
                const d2 = parseInt(s.value, 10);
                if (!Number.isFinite(d2) || d2 < 1 || d2 > 127) continue;
                converted.push({ t: 1, d1, v: d2 & 127 });
            }
        }
        if (converted.length) {
            blocks.push({ et: isRace ? 0 : 1, round0: (round - 1) & 31, scenarios: converted });
        }
        if (blocks.length >= 32) break; // cap
    }

    // Bit writer
    const bits = [];
    const write = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push(((val >> i) & 1) ? 1 : 0); };
    // header
    const version = 0; // 3 bits - v0: direct driver numbers (7 bits each)
    write(version, 3);
    write(simulationType === 'real' ? 1 : 0, 1);
    write(Math.min(blocks.length, 32), 6);
    // events
    for (const b of blocks) {
        write(b.et, 1);
        write(b.round0 & 31, 5);
        write(Math.min(b.scenarios.length, 8), 4);
        for (const sc of b.scenarios) {
            write(sc.t, 1);
            write(sc.d1 & 127, 7);
            write(sc.v & 127, 7);
        }
    }
    // to base64-url
    // pad to 6-bit boundary
    while (bits.length % 6 !== 0) bits.push(0);
    let out = '';
    for (let i = 0; i < bits.length; i += 6) {
        let v = 0;
        for (let k = 0; k < 6; k++) v = (v << 1) | bits[i + k];
        out += B64_CHARS[v];
    }
    return out;
}

function applyCompressedFromURL(bstr) {
    // decode base64-url to bits
    const bits = [];
    for (const ch of bstr) {
        const v = B64_CHARS.indexOf(ch);
        if (v < 0) continue;
        for (let i = 5; i >= 0; i--) bits.push(((v >> i) & 1) ? 1 : 0);
    }
    let p = 0;
    const read = (n) => {
        if (p + n > bits.length) return null;
        let v = 0;
        for (let i = 0; i < n; i++) { v = (v << 1) | (bits[p++] || 0); }
        return v;
    };
    const version = read(3); // currently unused
    const simBit = read(1);
    const eventCount = read(6);
    if (version === null || simBit === null || eventCount === null || eventCount > 32) {
        showToast('Invalid or outdated link');
        return { shouldRun: false };
    }
    for (let e = 0; e < eventCount; e++) {
        const et = read(1);
        const round0 = read(5);
        const scCount = read(4);
        if (et === null || round0 === null || scCount === null || scCount > 8) {
            showToast('Invalid or outdated link');
            return { shouldRun: false };
        }
        const type = et === 0 ? 'race' : 'sprint';
        const round = round0 + 1;
        const remIdx = getRemainingIndexFromRound(type, round);
        if (remIdx == null) {
            // skip scenarios for this completed/invalid event
            p += scCount * (1 + 7 + 7);
            continue;
        }
        const scenarioIndex = type === 'race' ? remIdx : remainingRaces.length + remIdx;
        for (let i = 0; i < scCount; i++) {
            const t = read(1);
            const d1 = read(7);
            const v = read(7);
            if (t === null || d1 === null || v === null) {
                showToast('Invalid or outdated link');
                return { shouldRun: false };
            }
            if (d1 < 1 || d1 > 127) continue; // skip invalid driver
            if (t === 0) {
                // position: v = pos-1
                const pos = Math.min(20, Math.max(1, v + 1));
                addScenarioToTab(scenarioIndex, { type: 'position', driver1: d1, value: String(pos) });
            } else {
                // above: v = driver2 number
                const driver2 = v;
                if (driver2 < 1 || driver2 > 127) continue;
                addScenarioToTab(scenarioIndex, { type: 'above', driver1: d1, value: String(driver2) });
            }
        }
    }
    return { shouldRun: true, sim: simBit === 1 ? 'real' : 'std' };
}

function renderProgress() {
    const completedRaces = appData.allRaces.length - remainingRaces.length;
    document.getElementById('races-completed').textContent = completedRaces;
    document.getElementById('races-remaining').textContent = remainingRaces.length;
    document.getElementById('sprints-remaining').textContent = remainingSprints.length;

    // Calculate maximum possible points
    const maxRacePoints = remainingRaces.length * 25;
    const maxSprintPoints = remainingSprints.length * 8;
    const maxFastestLaps = remainingRaces.length * 1;
    const maxPossiblePoints = maxRacePoints + maxSprintPoints + maxFastestLaps;
    document.getElementById('max-points').textContent = maxPossiblePoints;

    // Calculate total races in season
    const totalRaces = appData.allRaces.length;
    document.getElementById('total-races').textContent = totalRaces;
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
            <div class="scenario-panel-header">
                <h3>${title}</h3>
                <div class="scenario-actions">
                    <button class="btn btn-copy" onclick="copyScenariosToAll(${scenarioIndex})">📋 Copy to All Races</button>
                    <button class="btn btn-add" onclick="addScenarioRow(${scenarioIndex})">+ Add Scenario</button>
                </div>
            </div>
            <div class="scenario-list" id="scenarios-${scenarioIndex}">
                <!-- Scenario rows will be added here -->
            </div>
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
            ${drivers.map(d => `<option value="${d}">#${d} — ${driverNames[d] || `Driver #${d}`}</option>`).join('')}
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
            drivers.map(d => `<option value="${d}">#${d} — ${driverNames[d] || `Driver #${d}`}</option>`).join('');
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
    
    // Share scenarios button
    const shareBtn = document.getElementById('share-scenarios');
    if (shareBtn) {
        shareBtn.addEventListener('click', async (ev) => {
            const button = shareBtn;
            const originalText = button.textContent;
            const simType = window.__lastSimType === 'real' ? 'real' : 'std';
            const longUrl = buildShareURL(simType);
            const createShort = async () => {
                try {
                    const res = await fetch('/api/shorten', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: longUrl })
                    });
                    if (!res.ok) throw new Error(`shorten failed: ${res.status}`);
                    const data = await res.json();
                    return data?.shortUrl || longUrl;
                } catch (e) {
                    console.warn('Shorten failed, using long URL:', e.message);
                    return longUrl;
                }
            };

            try {
                // Ctrl/Cmd + click: open in new tab (prefer short URL)
                if (ev && (ev.ctrlKey || ev.metaKey)) {
                    button.disabled = true;
                    button.textContent = '⏳ Creating link...';
                    const urlToOpen = await createShort();
                    window.open(urlToOpen, '_blank', 'noopener');
                    button.textContent = originalText;
                    button.disabled = false;
                    return;
                }

                button.disabled = true;
                button.textContent = '⏳ Creating link...';
                console.log('Share URL (pre-short):', longUrl.length, 'chars');
                const urlToCopy = await createShort();
                await copyTextToClipboard(urlToCopy);
                button.textContent = '✅ Copied!';
                showToast('🔗 Link copied to clipboard!');
                setTimeout(() => {
                    button.textContent = originalText;
                    button.disabled = false;
                }, 2000);
            } catch (err) {
                console.error('Share failed:', err);
                button.textContent = originalText;
                button.disabled = false;
                window.prompt('Copy this URL:', longUrl);
                showToast('📋 Copy the URL from the prompt');
            }
        });
    }
    // Share image buttons
    const shareXBtn = document.getElementById('share-image-x');
    const shareInstaBtn = document.getElementById('share-image-insta');
    if (shareXBtn) {
        shareXBtn.addEventListener('click', async () => {
            try {
                if (!lastResults || lastResults.length === 0) {
                    showToast('Run a simulation first');
                    return;
                }
                const dataUrl = await buildShareImage(1080);
                // Download for the user first
                downloadDataUrl(dataUrl, `f1-sim-${Date.now()}.png`);
                // Open X intent with URL (cannot auto-attach image from browser)
                const url = buildShareURL(lastSimulationType);
                const text = encodeURIComponent('F1 2025 Championship Simulator — my scenario results');
                const intent = `https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(url)}`;
                window.open(intent, '_blank', 'noopener');
            } catch (e) {
                console.error(e);
                showToast('Failed to build share image');
            }
        });
    }
    if (shareInstaBtn) {
        shareInstaBtn.addEventListener('click', async () => {
            try {
                if (!lastResults || lastResults.length === 0) {
                    showToast('Run a simulation first');
                    return;
                }
                const dataUrl = await buildShareImage(1080);
                downloadDataUrl(dataUrl, `f1-sim-instagram-${Date.now()}.png`);
                showToast('📷 Image downloaded. Open Instagram and attach it to your post.');
            } catch (e) {
                console.error(e);
                showToast('Failed to build share image');
            }
        });
    }

    
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

function copyScenariosToAll(sourceIndex = null) {
    let scenarioIndex = sourceIndex;

    if (scenarioIndex === null) {
        // Fallback: determine from currently active tab
        const activeTab = document.querySelector('.tab.active');
        if (!activeTab) {
            alert('Please select a race tab first!');
            return;
        }

        const activeTabId = activeTab.dataset.tab;
        scenarioIndex = getScenarioIndexFromTabId(activeTabId);
    }

    if (scenarioIndex === null) {
        alert('Unable to determine active scenario. Please try again.');
        return;
    }
    
    // Get scenarios from the active tab
    const sourceScenarios = collectScenariosFromTab(scenarioIndex);
    
    if (sourceScenarios.length === 0) {
        alert('No scenarios to copy! Please add scenarios to the current race first.');
        return;
    }
    
    // Copy to all other races/sprints
    const totalScenarios = remainingRaces.length + remainingSprints.length;
    for (let i = 0; i < totalScenarios; i++) {
        if (i !== scenarioIndex) {
            // Clear existing scenarios for this race
            const container = document.getElementById(`scenarios-${i}`);
            if (container) {
                container.innerHTML = '';
            }
            scenarios[i] = [];
            
            // Add the copied scenarios
            sourceScenarios.forEach(scenario => {
                addScenarioToTab(i, scenario);
            });
        }
    }
    
    // Show success message
    const raceName = getRaceNameFromIndex(scenarioIndex);
    alert(`✅ Scenarios from ${raceName} copied to all other races!`);
}

function getScenarioIndexFromTabId(tabId) {
    // Extract scenario index from tab ID
    if (tabId.startsWith('race-')) {
        return parseInt(tabId.replace('race-', ''));
    } else if (tabId.startsWith('sprint-')) {
        const sprintIndex = parseInt(tabId.replace('sprint-', ''));
        return remainingRaces.length + sprintIndex;
    }
    return null;
}

function collectScenariosFromTab(scenarioIndex) {
    const container = document.getElementById(`scenarios-${scenarioIndex}`);
    if (!container) return [];
    
    const rows = container.querySelectorAll('.scenario-row');
    const collectedScenarios = [];
    
    rows.forEach(row => {
        const type = row.querySelector('.scenario-type').value;
        const driver1 = row.querySelector('.driver1').value;
        const value = row.querySelector('.driver2-or-position').value;
        
        if (type && driver1 && value) {
            collectedScenarios.push({ type, driver1: parseInt(driver1), value });
        }
    });
    
    return collectedScenarios;
}

function addScenarioToTab(scenarioIndex, scenario) {
    const container = document.getElementById(`scenarios-${scenarioIndex}`);
    if (!container) return;
    
    const rowIndex = scenarios[scenarioIndex].length;
    
    const row = document.createElement('div');
    row.className = 'scenario-row';
    row.id = `scenario-${scenarioIndex}-${rowIndex}`;
    
    row.innerHTML = `
        <select class="scenario-type" onchange="updateScenarioOptions(${scenarioIndex}, ${rowIndex})">
            <option value="">Select Type</option>
            <option value="position" ${scenario.type === 'position' ? 'selected' : ''}>Set Position</option>
            <option value="above" ${scenario.type === 'above' ? 'selected' : ''}>A Above B</option>
        </select>
        <select class="driver1">
            <option value="">Select Driver</option>
            ${drivers.map(d => `<option value="${d}" ${d == scenario.driver1 ? 'selected' : ''}>#${d} — ${driverNames[d] || `Driver #${d}`}</option>`).join('')}
        </select>
        <select class="driver2-or-position" disabled>
            <option value="">Select Option</option>
        </select>
        <button class="btn-remove" onclick="removeScenarioRow(${scenarioIndex}, ${rowIndex})">✕</button>
    `;
    
    container.appendChild(row);
    scenarios[scenarioIndex].push({ type: scenario.type, driver1: scenario.driver1, value: scenario.value });
    
    // Update the value select based on the scenario type
    updateScenarioOptions(scenarioIndex, rowIndex);
    
    // Set the value
    setTimeout(() => {
        const valueSelect = row.querySelector('.driver2-or-position');
        if (scenario.type === 'position') {
            valueSelect.value = scenario.value;
        } else if (scenario.type === 'above') {
            valueSelect.value = scenario.value;
        }
    }, 10);
}

function getRaceNameFromIndex(scenarioIndex) {
    if (scenarioIndex < remainingRaces.length) {
        return remainingRaces[scenarioIndex].country;
    } else {
        const sprintIndex = scenarioIndex - remainingRaces.length;
        return `Sprint: ${remainingSprints[sprintIndex].country}`;
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
            window.__lastSimType = 'std';
            lastSimulationType = 'std';
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
            window.__lastSimType = 'real';
            lastSimulationType = 'real';
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
    // Try up to 10000 times to satisfy all constraints
    for (let attempt = 0; attempt < 10000; attempt++) {
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
    // Keep a copy for sharing
    lastResults = results;
    
    resultsSection.style.display = 'block';
    
    // Always show winner banner for the current top candidate
    if (results && results.length > 0) {
        showWinnerAnimation(results[0].driver);
    }
    
    // Scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth' });
}

function showWinnerAnimation(driverNum) {
    const animDiv = document.getElementById('winner-animation');
    const name = driverNames[driverNum] || `Driver #${driverNum}`;
    document.getElementById('winner-text').textContent = `🏆 ${name} is the likely champion! 🏆`;
    if (animDiv) {
        animDiv.style.display = 'block';
    }
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
            return `<option value="${driverNum}">#${driverNum} — ${name} (${points} pts)</option>`;
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

// Approximate finishing position from points per event
function getPositionFromPoints(points) {
    if (points >= 25) return 1;
    if (points >= 18) return 2;
    if (points >= 15) return 3;
    if (points >= 12) return 4;
    if (points >= 10) return 5;
    if (points >= 8) return 6;
    if (points >= 6) return 7;
    if (points >= 4) return 8;
    if (points >= 2) return 9;
    if (points >= 1) return 10;
    return 15;
}

// Start the app
init();

// ===== Utilities: toast + clipboard =====
function showToast(message) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.style.display = 'block';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
        el.style.display = 'none';
    }, 2200);
}

async function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
    }
    // Fallback for non-secure contexts
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
        document.execCommand('copy');
    } finally {
        document.body.removeChild(textarea);
    }
}
// ===== Helpers used by the polished share image =====
async function loadImageAsync(src, timeout = 8000) {
    return new Promise((resolve) => {
        const img = new Image();
        let done = false;
        const t = setTimeout(() => {
            if (done) return;
            done = true;
            img.src = '';
            resolve(null);
        }, timeout);
        img.onload = () => {
            if (done) return;
            done = true;
            clearTimeout(t);
            resolve(img);
        };
        img.onerror = () => {
            if (done) return;
            done = true;
            clearTimeout(t);
            resolve(null);
        };
        img.crossOrigin = 'anonymous';
        img.src = src;
    });
}

function drawRoundedProgressBar(ctx, x, y, w, h, pct) {
    ctx.save();
    ctx.beginPath();
    const r = h / 2;
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();

    // track
    ctx.fillStyle = '#2f2f2f';
    ctx.fill();

    const fillW = Math.max(0.001, Math.min(1, pct / 100)) * w;
    if (fillW > 0.5) {
        const grd = ctx.createLinearGradient(x, y, x + fillW, y);
        grd.addColorStop(0, '#ff9a1f');
        grd.addColorStop(1, '#e10600');
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + Math.max(r, fillW - r), y);
        if (fillW < r) {
            const smallR = fillW / 2;
            ctx.arc(x + smallR, y + h / 2, smallR, Math.PI * 1.5, Math.PI * 0.5);
            ctx.closePath();
        } else {
            ctx.quadraticCurveTo(x + fillW, y, x + fillW, y + r);
            ctx.lineTo(x + fillW, y + h - r);
            ctx.quadraticCurveTo(x + fillW, y + h, x + Math.max(r, fillW - r), y + h);
            ctx.lineTo(x + r, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - r);
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.closePath();
        }
        ctx.fillStyle = grd;
        ctx.fill();

        // sheen
        ctx.beginPath();
        ctx.rect(x, y, fillW, h * 0.5);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fill();
    }

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke();
    ctx.restore();
}


function downloadDataUrl(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
    if (typeof radius === 'undefined') radius = 5;
    if (typeof radius === 'number') {
        radius = {tl: radius, tr: radius, br: radius, bl: radius};
    } else {
        const defaultRadius = {tl: 0, tr: 0, br: 0, bl: 0};
        for (let side in defaultRadius) radius[side] = radius[side] || defaultRadius[side];
    }
    ctx.beginPath();
    ctx.moveTo(x + radius.tl, y);
    ctx.lineTo(x + width - radius.tr, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
    ctx.lineTo(x + width, y + height - radius.br);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
    ctx.lineTo(x + radius.bl, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bl);
    ctx.lineTo(x, y + radius.tl);
    ctx.quadraticCurveTo(x, y, x + radius.tl, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
}

function drawCenteredText(ctx, text, cx, cy) {
    const metrics = ctx.measureText(text);
    const x = cx - metrics.width / 2;
    ctx.fillText(text, x, cy);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    let lineCount = 0;
    
    for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        const metrics = ctx.measureText(testLine);
        
        if (metrics.width > maxWidth && n > 0) {
            ctx.fillText(line.trimEnd(), x, y);
            line = words[n] + ' ';
            y += lineHeight;
            lineCount++;
            if (lineCount >= 3) break; // Max 3 lines
        } else {
            line = testLine;
        }
    }
    if (lineCount < 3) {
        ctx.fillText(line.trimEnd(), x, y);
    }
}

function cleanUrlForDisplay(url) {
    try {
        const u = new URL(url);
        const host = u.host.replace('www.', '');
        
        // For localhost/development
        if (host.includes('localhost') || host.includes('127.0.0.1') || host.includes('0.0.0.0')) {
            return 'yourdomain.com/share/xyz123';
        }
        
        // Remove protocol
        let display = url.replace(/^https?:\/\//, '');
        
        // Limit length
        if (display.length > 50) {
            display = display.slice(0, 50) + '...';
        }
        
        return display;
    } catch {
        // Fallback for invalid URLs
        if (url.includes('localhost') || url.includes('127.0.0.1')) {
            return 'yourdomain.com/share/xyz123';
        }
        return url.length > 50 ? url.slice(0, 50) + '...' : url;
    }
}

// Map from remaining index to actual championship round
function getEventRoundFromRemaining(type, remainingIndex) {
    // type: 'race' or 'sprint'
    const source = type === 'race' ? appData.allRaces : appData.allSprints;
    const currentDate = new Date();
    const remaining = source.filter(e => new Date(e.date) > currentDate);
    const event = remaining[remainingIndex];
    return event?.round || null;
}

// Find remaining index given a type and round number
function getRemainingIndexFromRound(type, round) {
    const source = type === 'race' ? appData.allRaces : appData.allSprints;
    const currentDate = new Date();
    let idx = -1;
    let remainingIdx = -1;
    for (const e of source) {
        const isRemaining = new Date(e.date) > currentDate;
        if (isRemaining) {
            remainingIdx++;
        }
        if (e.round === round && isRemaining) {
            idx = remainingIdx;
            break;
        }
    }
    return idx >= 0 ? idx : null;
}

// Build a shareable URL encoding scenarios using compressed format, with fallback legacy params
function buildShareURL(simulationType = 'std') {
    const url = new URL(window.location.href);
    // Clean slate
    url.searchParams.delete('sc');
    url.searchParams.delete('sc2');
    url.searchParams.delete('sim');
    // Use compressed format
    const compressed = encodeCompressedScenarios(simulationType);
    url.searchParams.set('sc2', compressed);
    url.searchParams.set('sim', simulationType === 'real' ? 'real' : 'std');
    return url.toString();
}

// Read scenarios from URL (compressed preferred)
function applyScenariosFromURL() {
    const url = new URL(window.location.href);
    const sc2 = url.searchParams.get('sc2');
    const sc = url.searchParams.get('sc');
    const sim = url.searchParams.get('sim');
    let shouldRun = false;
    let simMode = sim === 'real' ? 'real' : 'std';
    if (sc2) {
        const res = applyCompressedFromURL(sc2);
        shouldRun = res.shouldRun;
        if (res.sim) simMode = res.sim;
    } else if (sc) {
        // Legacy simple format: one event index and scenario list; keep as no-op if not supported
        try {
            const parsed = JSON.parse(atob(sc));
            if (parsed && typeof parsed === 'object') {
                // Best-effort: populate first event
                const firstIdx = 0;
                scenarios[firstIdx] = Array.isArray(parsed) ? parsed : [];
                shouldRun = true;
            }
        } catch {}
    }
    return { shouldRun, sim: simMode };
}

// ===== Polished Share Image (Canvas) =====
async function buildShareImage(size = 1080) {
    if (!lastResults || lastResults.length === 0) {
        throw new Error('No results to share. Run a simulation first.');
    }

    // Shorten URL best-effort
    const simType = lastSimulationType === 'real' ? 'real' : 'std';
    const longUrl = buildShareURL(simType);
    let displayUrl = longUrl;
    try {
        const res = await fetch('/api/shorten', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: longUrl })
        });
        if (res.ok) {
            const data = await res.json();
            if (data && data.shortUrl) displayUrl = data.shortUrl;
        }
    } catch (e) {
        console.log('Shorten failed — using full URL', e && e.message);
    }

    const px = size; // width
    const stripeW = Math.floor(px * 0.037);
    const pad = Math.floor(px * 0.06);
    const contentX = pad + stripeW;
    const contentW = px - contentX - pad;
    const headerH = Math.floor(px * 0.11);
    const titleSize = Math.floor(px * 0.048);

    // Rows and dynamic height
    const results = lastResults.slice(0, 5);
    const rowH = Math.floor(px * 0.12);
    const rowGap = Math.floor(px * 0.018);
    const spacing = Math.floor(px * 0.035);
    const bannerH = Math.floor(px * 0.11);
    const footerH = Math.floor(px * 0.18);
    const totalHeight = pad + headerH + spacing + titleSize + spacing + (results.length * (rowH + rowGap)) - rowGap + spacing + bannerH + spacing + footerH + pad;

    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = Math.ceil(totalHeight);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Background gradient + left stripe
    const bg = ctx.createLinearGradient(0, 0, px, canvas.height);
    bg.addColorStop(0, '#0b0b0b');
    bg.addColorStop(1, '#151515');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, px, canvas.height);
    ctx.fillStyle = '#e10600';
    ctx.fillRect(0, 0, stripeW, canvas.height);

    let y = pad;

    // Header banner pill with gradient (#e10600 -> #111198)
    const hdrX = contentX;
    const hdrW = contentW;
    const hdrY = y;
    const hdrGrad = ctx.createLinearGradient(hdrX, hdrY, hdrX + hdrW, hdrY + headerH);
    hdrGrad.addColorStop(0, '#e10600');
    hdrGrad.addColorStop(1, '#111198');
    ctx.fillStyle = hdrGrad;
    roundRect(ctx, hdrX, hdrY, hdrW, headerH, Math.floor(px * 0.02), true, false);
    // Header text
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.floor(px * 0.052)}px Segoe UI, Arial, sans-serif`;
    ctx.fillText('🏁 F1 2025 Championship Simulator', hdrX + Math.floor(px * 0.03), hdrY + Math.floor(headerH * 0.63));
    y += headerH + spacing;

    // Section title
    ctx.fillStyle = '#ff8700';
    ctx.font = `600 ${titleSize}px Segoe UI, Arial, sans-serif`;
    ctx.fillText('🏆 Championship Win Probability', contentX, y);
    y += spacing;

    // Preload images for rows (logos preferred)
    const imagePromises = results.map(r => (async () => {
        const id = r.driver;
        let img = await loadImageAsync(`driver-logos/${id}.png`);
        if (!img) img = await loadImageAsync(`driver-numbers/${id}.png`);
        return img;
    })());
    const rowImages = await Promise.all(imagePromises);

    // Draw rows as soft cards
    const badgeR = Math.floor(rowH * 0.32);
    const textLeft = contentX + badgeR * 2 + Math.floor(px * 0.035);
    const pctWidth = Math.floor(px * 0.13);
    const barH = Math.floor(rowH * 0.18);
    const cardRadius = Math.floor(px * 0.018);

    results.forEach((r, idx) => {
        const rowY = y + idx * (rowH + rowGap);
        const cardX = contentX;
        const cardW = contentW;

        // card background with subtle shadow
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = Math.floor(px * 0.01);
        ctx.shadowOffsetY = Math.floor(px * 0.004);
        ctx.fillStyle = '#1e1e1e';
        roundRect(ctx, cardX, rowY, cardW, rowH, cardRadius, true, false);
        ctx.restore();

        // separator line (top) except first
        if (idx > 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.04)';
            ctx.fillRect(cardX + Math.floor(px * 0.02), rowY - Math.floor(rowGap * 0.6), cardW - Math.floor(px * 0.04), 1);
        }

        // circular badge
        const cx = contentX + badgeR;
        const cy = rowY + Math.floor(rowH * 0.44);
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, badgeR, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        const img = rowImages[idx];
        if (img) {
            // draw image cover
            const s = Math.min(img.width, img.height);
            const sx = (img.width - s) / 2;
            const sy = (img.height - s) / 2;
            ctx.drawImage(img, sx, sy, s, s, cx - badgeR, cy - badgeR, badgeR * 2, badgeR * 2);
        } else {
            // fallback circle with number
            const grad = ctx.createLinearGradient(cx - badgeR, cy - badgeR, cx + badgeR, cy + badgeR);
            grad.addColorStop(0, '#333');
            grad.addColorStop(1, '#222');
            ctx.fillStyle = grad;
            ctx.fillRect(cx - badgeR, cy - badgeR, badgeR * 2, badgeR * 2);
            ctx.fillStyle = '#fff';
            ctx.font = `700 ${Math.floor(badgeR * 0.95)}px Segoe UI, Arial`;
            const txt = String(r.driver);
            const tw = ctx.measureText(txt).width;
            ctx.fillText(txt, cx - tw / 2, cy + Math.floor(badgeR * 0.35));
        }
        ctx.restore();
        // circle outline
        ctx.lineWidth = Math.max(2, Math.floor(px * 0.003));
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.arc(cx, cy, badgeR, 0, Math.PI * 2);
        ctx.stroke();

        // name and number
        const name = driverNames[r.driver] || `Driver #${r.driver}`;
        ctx.fillStyle = '#ffffff';
        ctx.font = `600 ${Math.floor(px * 0.036)}px Segoe UI, Arial`;
        ctx.fillText(name, textLeft, rowY + Math.floor(rowH * 0.48));
        ctx.fillStyle = '#b0b0b0';
        ctx.font = `${Math.floor(px * 0.026)}px Segoe UI, Arial`;
        ctx.fillText(`(#${r.driver})`, textLeft, rowY + Math.floor(rowH * 0.75));

        // percentage (right)
        ctx.fillStyle = '#00d448';
        ctx.font = `700 ${Math.floor(px * 0.038)}px Segoe UI, Arial`;
        const pctText = `${r.percentage.toFixed(1)}%`;
        const pctTw = ctx.measureText(pctText).width;
        ctx.fillText(pctText, cardX + cardW - Math.floor(px * 0.02) - pctTw, rowY + Math.floor(rowH * 0.48));

        // progress bar below name
        const barX = textLeft;
        const barY = rowY + Math.floor(rowH * 0.70);
        const barW = cardW - (barX - cardX) - pctWidth;
        drawRoundedProgressBar(ctx, barX, barY, barW, barH, r.percentage);
    });

    // After rows: winner banner
    const winner = results[0];
    y += titleSize + (results.length * (rowH + rowGap)) - rowGap + spacing;
    const bannerX = contentX;
    const bannerW = contentW;
    const bannerY = y;
    const grd = ctx.createLinearGradient(bannerX, bannerY, bannerX + bannerW, bannerY + bannerH);
    grd.addColorStop(0, 'rgba(225,6,0,0.85)');
    grd.addColorStop(1, 'rgba(255,135,0,0.85)');
    ctx.fillStyle = grd;
    roundRect(ctx, bannerX, bannerY, bannerW, bannerH, Math.floor(px * 0.02), true, false);
    ctx.fillStyle = '#1a1a1a';
    ctx.font = `bold ${Math.floor(px * 0.048)}px Segoe UI, Arial`;
    const winnerText = `🏆 ${driverNames[winner.driver] || 'Driver'} is the likely champion! 🏆`;
    drawCenteredText(ctx, winnerText, bannerX + bannerW / 2, bannerY + Math.floor(bannerH * 0.63));

    // Footer with short link
    y += bannerH + spacing;
    const footX = contentX;
    const footW = contentW;
    const footH = footerH;
    ctx.save();
    ctx.fillStyle = '#222';
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = Math.floor(px * 0.012);
    ctx.shadowOffsetY = Math.floor(px * 0.004);
    roundRect(ctx, footX, y, footW, footH, Math.floor(px * 0.02), true, false);
    ctx.restore();

    ctx.fillStyle = '#b0b0b0';
    ctx.font = `${Math.floor(px * 0.03)}px Segoe UI, Arial`;
    ctx.fillText('Share this scenario', footX + Math.floor(px * 0.03), y + Math.floor(px * 0.055));
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${Math.floor(px * 0.032)}px Segoe UI, Arial`;
    const disp = cleanUrlForDisplay(displayUrl);
    wrapText(ctx, disp, footX + Math.floor(px * 0.03), y + Math.floor(px * 0.10), footW - Math.floor(px * 0.06), Math.floor(px * 0.05));

    // signature
    ctx.fillStyle = '#8e8e8e';
    ctx.font = `${Math.floor(px * 0.024)}px Segoe UI, Arial`;
    ctx.fillText('Made with ❤️ by djsmanchanda.com', pad + stripeW, canvas.height - pad);

    return canvas.toDataURL('image/png');
}