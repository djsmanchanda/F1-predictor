/**
 * Share utilities for encoding/decoding scenarios to URL parameters
 * Supports:
 * - Parameterized format (editable from URL)
 * - Base64 compressed format
 * - URL shortening via /api/shorten
 */

export type ScenarioItem = {
  type: 'position' | 'above';
  driver1: number;
  value: string;
};

export type SimulationType = 'standard' | 'realistic' | 'recent-form' | 'custom1' | 'custom2';

/**
 * Encode scenarios to compressed base64 format
 * Format: sim|race1:sc1,sc2;race2:sc3|sprint1:sc4
 * Each scenario: type,d1,val (e.g., "p,1,3" = position driver 1 at 3rd)
 */
export function encodeCompressedScenarios(
  scenarios: Record<number, ScenarioItem[]>,
  remainingRaces: Array<{ round: number }>,
  remainingSprints: Array<{ round: number }>,
  simulationType: SimulationType = 'standard'
): string {
  const simCode = simulationType === 'realistic' ? 'r' : simulationType === 'recent-form' ? 'rf' : simulationType === 'custom1' ? 'c1' : simulationType === 'custom2' ? 'c2' : 's';
  
  const raceData: string[] = [];
  const sprintData: string[] = [];

  // Check if all races have identical scenarios (for compression)
  const allScenarios = Object.values(scenarios);
  const firstScenario = allScenarios[0] || [];
  const allIdentical = allScenarios.every(sc => 
    JSON.stringify(sc) === JSON.stringify(firstScenario)
  );

  if (allIdentical && firstScenario.length > 0) {
    // Special encoding: "*" means "all races same"
    const encoded = firstScenario.map(encodeScenarioItem).join(',');
    return btoa(`${simCode}|*:${encoded}`);
  }

  // Encode each race
  remainingRaces.forEach((race, idx) => {
    const scList = scenarios[idx] || [];
    if (scList.length === 0) return;
    const encoded = scList.map(encodeScenarioItem).join(',');
    raceData.push(`${race.round}:${encoded}`);
  });

  // Encode each sprint
  remainingSprints.forEach((sprint, idx) => {
    const scList = scenarios[remainingRaces.length + idx] || [];
    if (scList.length === 0) return;
    const encoded = scList.map(encodeScenarioItem).join(',');
    sprintData.push(`${sprint.round}:${encoded}`);
  });

  const racePart = raceData.join(';');
  const sprintPart = sprintData.length > 0 ? `|sp:${sprintData.join(';')}` : '';
  
  return btoa(`${simCode}|${racePart}${sprintPart}`);
}

/**
 * Encode a single scenario item to compact string
 * position: "p,driver,position" e.g., "p,1,5"
 * above: "a,driver1,driver2" e.g., "a,1,4"
 */
function encodeScenarioItem(item: ScenarioItem): string {
  const typeCode = item.type === 'position' ? 'p' : item.type === 'above' ? 'a' : 'x';
  return `${typeCode},${item.driver1},${item.value}`;
}

/**
 * Decode compressed base64 scenarios
 */
export function decodeCompressedScenarios(
  encoded: string,
  remainingRaces: Array<{ round: number }>,
  remainingSprints: Array<{ round: number }>
): { scenarios: Record<number, ScenarioItem[]>; simulationType: SimulationType } {
  try {
    const decoded = atob(encoded);
    const [simPart, ...rest] = decoded.split('|');
    
    const simType: SimulationType = 
      simPart === 'r' ? 'realistic' : 
      simPart === 'rf' ? 'recent-form' :
      simPart === 'c1' ? 'custom1' : 
      simPart === 'c2' ? 'custom2' : 'standard';

    const scenarios: Record<number, ScenarioItem[]> = {};

    // Check for "all same" encoding
    if (rest[0]?.startsWith('*:')) {
      const scenarioStr = rest[0].substring(2);
      const items = scenarioStr.split(',').reduce<ScenarioItem[]>((acc, _chunk, idx, arr) => {
        if (idx % 3 === 0 && idx + 2 < arr.length) {
          acc.push(decodeScenarioItem([arr[idx], arr[idx + 1], arr[idx + 2]]));
        }
        return acc;
      }, []);
      
      // Apply to all events
      remainingRaces.forEach((_, idx) => {
        scenarios[idx] = JSON.parse(JSON.stringify(items));
      });
      remainingSprints.forEach((_, idx) => {
        scenarios[remainingRaces.length + idx] = JSON.parse(JSON.stringify(items));
      });
      
      return { scenarios, simulationType: simType };
    }

    // Parse races and sprints
    rest.forEach(part => {
      if (part.startsWith('sp:')) {
        // Sprint data
        const sprintPart = part.substring(3);
        sprintPart.split(';').forEach(entry => {
          const [roundStr, scStr] = entry.split(':');
          const round = parseInt(roundStr);
          const sprintIdx = remainingSprints.findIndex(s => s.round === round);
          if (sprintIdx >= 0) {
            const eventIdx = remainingRaces.length + sprintIdx;
            scenarios[eventIdx] = parseScenarioString(scStr);
          }
        });
      } else {
        // Race data
        part.split(';').forEach(entry => {
          const [roundStr, scStr] = entry.split(':');
          const round = parseInt(roundStr);
          const raceIdx = remainingRaces.findIndex(r => r.round === round);
          if (raceIdx >= 0) {
            scenarios[raceIdx] = parseScenarioString(scStr);
          }
        });
      }
    });

    return { scenarios, simulationType: simType };
  } catch (e) {
    console.error('Failed to decode scenarios:', e);
    return { scenarios: {}, simulationType: 'standard' };
  }
}

/**
 * Parse scenario string like "p,1,5,a,2,4" into scenario items
 */
function parseScenarioString(str: string): ScenarioItem[] {
  const parts = str.split(',');
  const items: ScenarioItem[] = [];
  
  for (let i = 0; i + 2 < parts.length; i += 3) {
    items.push(decodeScenarioItem([parts[i], parts[i + 1], parts[i + 2]]));
  }
  
  return items;
}

/**
 * Decode a scenario item from [type, driver1, value]
 */
function decodeScenarioItem(parts: string[]): ScenarioItem {
  const typeCode = parts[0];
  const type = typeCode === 'p' ? 'position' : typeCode === 'a' ? 'above' : 'position';
  return {
    type,
    driver1: parseInt(parts[1]),
    value: parts[2]
  };
}

/**
 * Build parameterized URL (long format, editable)
 */
export function buildParameterizedURL(
  scenarios: Record<number, ScenarioItem[]>,
  remainingRaces: Array<{ round: number }>,
  remainingSprints: Array<{ round: number }>,
  simulationType: SimulationType = 'standard'
): string {
  const url = new URL(window.location.href);
  url.searchParams.delete('sc');
  url.searchParams.delete('sc2');
  url.searchParams.delete('sim');

  // Add simulation type
  url.searchParams.set('sim', simulationType);

  // Add each race scenario
  remainingRaces.forEach((race, idx) => {
    const scList = scenarios[idx];
    if (scList && scList.length > 0) {
      scList.forEach((sc, scIdx) => {
        url.searchParams.set(`r${race.round}_${scIdx}_t`, sc.type);
        url.searchParams.set(`r${race.round}_${scIdx}_d1`, String(sc.driver1));
        url.searchParams.set(`r${race.round}_${scIdx}_v`, sc.value);
      });
    }
  });

  // Add each sprint scenario
  remainingSprints.forEach((sprint, idx) => {
    const scList = scenarios[remainingRaces.length + idx];
    if (scList && scList.length > 0) {
      scList.forEach((sc, scIdx) => {
        url.searchParams.set(`s${sprint.round}_${scIdx}_t`, sc.type);
        url.searchParams.set(`s${sprint.round}_${scIdx}_d1`, String(sc.driver1));
        url.searchParams.set(`s${sprint.round}_${scIdx}_v`, sc.value);
      });
    }
  });

  return url.toString();
}

/**
 * Build shareable URL (compressed by default)
 */
export function buildShareURL(
  scenarios: Record<number, ScenarioItem[]>,
  remainingRaces: Array<{ round: number }>,
  remainingSprints: Array<{ round: number }>,
  simulationType: SimulationType = 'standard'
): string {
  const url = new URL(window.location.href);
  url.searchParams.delete('sc');
  url.searchParams.delete('sc2');
  url.searchParams.delete('sim');

  // Use compressed format (sim type is included in the base64 string)
  const compressed = encodeCompressedScenarios(scenarios, remainingRaces, remainingSprints, simulationType);
  url.searchParams.set('sc2', compressed);

  return url.toString();
}

/**
 * Apply scenarios from URL parameters
 */
export function applyScenariosFromURL(
  remainingRaces: Array<{ round: number }>,
  remainingSprints: Array<{ round: number }>
): { scenarios: Record<number, ScenarioItem[]>; simulationType: SimulationType; shouldRun: boolean } {
  const url = new URL(window.location.href);
  const sc2 = url.searchParams.get('sc2');
  const sim = url.searchParams.get('sim') as SimulationType | null;
  
  let scenarios: Record<number, ScenarioItem[]> = {};
  let simulationType: SimulationType = sim || 'standard';
  let shouldRun = false;

  if (sc2) {
    // Compressed format
    const decoded = decodeCompressedScenarios(sc2, remainingRaces, remainingSprints);
    scenarios = decoded.scenarios;
    simulationType = decoded.simulationType;
    shouldRun = Object.keys(scenarios).length > 0;
  } else {
    // Try parameterized format
    const result = parseParameterizedURL(url, remainingRaces, remainingSprints);
    scenarios = result.scenarios;
    shouldRun = Object.keys(scenarios).length > 0;
  }

  return { scenarios, simulationType, shouldRun };
}

/**
 * Parse parameterized URL format
 */
function parseParameterizedURL(
  url: URL,
  remainingRaces: Array<{ round: number }>,
  remainingSprints: Array<{ round: number }>
): { scenarios: Record<number, ScenarioItem[]> } {
  const scenarios: Record<number, ScenarioItem[]> = {};

  // Parse races
  remainingRaces.forEach((race, idx) => {
    const list: ScenarioItem[] = [];
    let scIdx = 0;
    while (true) {
      const type = url.searchParams.get(`r${race.round}_${scIdx}_t`);
      const d1 = url.searchParams.get(`r${race.round}_${scIdx}_d1`);
      const val = url.searchParams.get(`r${race.round}_${scIdx}_v`);
      if (!type || !d1 || !val) break;
      list.push({
        type: type as 'position' | 'above',
        driver1: parseInt(d1),
        value: val
      });
      scIdx++;
    }
    if (list.length > 0) scenarios[idx] = list;
  });

  // Parse sprints
  remainingSprints.forEach((sprint, idx) => {
    const list: ScenarioItem[] = [];
    let scIdx = 0;
    while (true) {
      const type = url.searchParams.get(`s${sprint.round}_${scIdx}_t`);
      const d1 = url.searchParams.get(`s${sprint.round}_${scIdx}_d1`);
      const val = url.searchParams.get(`s${sprint.round}_${scIdx}_v`);
      if (!type || !d1 || !val) break;
      list.push({
        type: type as 'position' | 'above',
        driver1: parseInt(d1),
        value: val
      });
      scIdx++;
    }
    if (list.length > 0) scenarios[remainingRaces.length + idx] = list;
  });

  return { scenarios };
}

/**
 * Shorten a URL via /api/shorten
 */
export async function shortenURL(longUrl: string): Promise<string> {
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
    console.warn('Shorten failed, using long URL:', e);
    return longUrl;
  }
}

/**
 * Copy text to clipboard
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

/**
 * Extract short code or sc2 parameter from URL or code string
 * Supports:
 * - Short URL: /s/ABC123 or https://domain.com/s/ABC123 or localhost:5173/s/ABC123
 * - Parameterized URL: ?sc2=base64string
 * - Just the code: ABC123 or base64string
 */
export function extractSimulationCode(input: string): { type: 'short' | 'compressed' | null; code: string | null } {
  if (!input || typeof input !== 'string') return { type: null, code: null };
  
  const trimmed = input.trim();
  
  // Try to parse as URL first (add protocol if missing)
  let urlToParse = trimmed;
  if (!trimmed.match(/^https?:\/\//i)) {
    // Check if it looks like a URL without protocol (contains domain/localhost)
    if (trimmed.includes('/') || trimmed.includes('localhost') || trimmed.match(/^[\w.-]+\.\w+/)) {
      urlToParse = 'http://' + trimmed;
    }
  }
  
  try {
    const url = new URL(urlToParse);
    
    // Check for /s/[code] short URL
    const match = url.pathname.match(/\/s\/([a-zA-Z0-9]+)/);
    if (match && match[1]) {
      return { type: 'short', code: match[1] };
    }
    
    // Check for sc2 parameter (compressed format)
    const sc2 = url.searchParams.get('sc2');
    if (sc2) {
      return { type: 'compressed', code: sc2 };
    }
  } catch {
    // Not a valid URL, treat as raw code
  }
  
  // Check if it's just a short code (alphanumeric, typically 6-8 chars)
  if (/^[a-zA-Z0-9]{6,10}$/.test(trimmed)) {
    return { type: 'short', code: trimmed };
  }
  
  // Check if it's a base64 string (compressed scenario)
  if (/^[A-Za-z0-9+/]+=*$/.test(trimmed) && trimmed.length > 10) {
    return { type: 'compressed', code: trimmed };
  }
  
  return { type: null, code: null };
}

/**
 * Resolve short code to full URL
 */
export async function resolveShortCode(code: string): Promise<string | null> {
  try {
    const res = await fetch(`/s/${code}`, { redirect: 'manual' });
    if (res.status === 302 || res.status === 301) {
      const location = res.headers.get('Location');
      return location;
    }
    return null;
  } catch (err) {
    console.error('Failed to resolve short code:', err);
    return null;
  }
}

/**
 * Clean URL for display (shorten for UI)
 */
export function cleanUrlForDisplay(url: string): string {
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
