// Cloudflare Pages Function with new F1 Worker integration
const CACHE_KEY = 'f1_data_cache';
const CACHE_TIMESTAMP_KEY = 'f1_cache_timestamp';

// New F1 Worker endpoint (update this URL after deploying your worker)
const F1_WORKER_BASE_URL = 'https://f1-autocache.djsmanchanda.workers.dev'; // Updated with your actual worker URL
// Fallback to original API if worker is unavailable
const FALLBACK_API_URL = 'https://youtrition.djsmanchanda.com/api/f1-standings?format=json'; // hardcoded data till Azerbaijan GP 2025   

// F1 Calendar 2025
const ALL_RACES = [
  { country: "Australia", date: "2025-03-16" },
  { country: "China", date: "2025-03-23" },
  { country: "Japan", date: "2025-04-06" },
  { country: "Bahrain", date: "2025-04-13" },
  { country: "Saudi Arabia", date: "2025-04-20" },
  { country: "Miami", date: "2025-05-04" },
  { country: "Emilia Romagna", date: "2025-05-18" },
  { country: "Monaco", date: "2025-05-25" },
  { country: "Spain", date: "2025-06-01" },
  { country: "Canada", date: "2025-06-15" },
  { country: "Austria", date: "2025-06-29" },
  { country: "Britain", date: "2025-07-06" },
  { country: "Belgium", date: "2025-07-27" },
  { country: "Hungary", date: "2025-08-03" },
  { country: "Netherlands", date: "2025-08-31" },
  { country: "Italy", date: "2025-09-07" },
  { country: "Azerbaijan", date: "2025-09-21" },
  { country: "Singapore", date: "2025-10-05" },
  { country: "United States", date: "2025-10-19" },
  { country: "Mexico City", date: "2025-10-26" },
  { country: "São Paulo", date: "2025-11-09" },
  { country: "Las Vegas", date: "2025-11-22" },
  { country: "Qatar", date: "2025-11-30" },
  { country: "Abu Dhabi", date: "2025-12-07" }
];

const ALL_SPRINTS = [
  { country: "China", date: "2025-03-22" },
  { country: "Miami", date: "2025-05-03" },
  { country: "Belgium", date: "2025-07-26" },
  { country: "United States", date: "2025-10-18" },
  { country: "São Paulo", date: "2025-11-08" },
  { country: "Qatar", date: "2025-11-29" }
];

// In-memory cache for development
let memoryCache = null;
let memoryCacheTimestamp = null;
const MEMORY_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in dev

// Function to check if we need to refresh cache
function shouldRefreshCache(currentDate, cachedTimestamp) {
  if (!cachedTimestamp) return true;
  
  const lastCacheDate = new Date(cachedTimestamp);
  const today = new Date(currentDate);
  
  // Use shorter cache duration for development
  const timeDiff = today.getTime() - lastCacheDate.getTime();
  return timeDiff > MEMORY_CACHE_DURATION;
}

async function fetchFromWorker(year = new Date().getUTCFullYear()) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  
  try {
    // Fetch standings data from the new Worker
    const standingsResponse = await fetch(`${F1_WORKER_BASE_URL}/api/f1/standings.json?year=${year}`, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'F1-Simulator/2.0'
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!standingsResponse.ok) {
      throw new Error(`Worker API returned ${standingsResponse.status}`);
    }
    
    const standingsData = await standingsResponse.json();
    
    // Transform the new format to the old format expected by the frontend
    return transformWorkerData(standingsData, year);
    
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('Worker API error:', error);
    throw error;
  }
}

async function fetchFromFallback() {
  console.log('Falling back to original API...');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  
  try {
    const response = await fetch(FALLBACK_API_URL, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'F1-Simulator/2.0'
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`Fallback API returned ${response.status}`);
    }
    
    const apiData = await response.json();
    
    if (!apiData.success || !apiData.data) {
      throw new Error('Invalid fallback API response structure');
    }
    
    // Transform fallback data to expected format
    const drivers = apiData.data;
    const driverNames = {};
    const currentPoints = {};
    const driverNumbers = [];
    
    for (const driver of drivers) {
      const driverNum = driver.driverNumber;
      driverNames[driverNum] = driver.driverName;
      currentPoints[driverNum] = driver.finalPoints;
      driverNumbers.push(driverNum);
    }
    
    return {
      driverNames,
      currentPoints,
      allRaces: ALL_RACES,
      allSprints: ALL_SPRINTS,
      drivers: driverNumbers,
      source: 'fallback'
    };
    
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

function transformWorkerData(standingsData, year) {
  // Transform the new Worker's JSON format to match the existing frontend expectations
  const driverNames = {};
  const currentPoints = {};
  const driverNumbers = [];
  
  // Extract data from the new format
  for (const driverRow of standingsData) {
    const driverNumber = parseInt(driverRow["Driver Number"]) || 0;
    const driverName = driverRow["Driver Name"] || `Driver #${driverNumber}`;
    const finalPoints = driverRow["Final Points"] || 0;
    
    if (driverNumber > 0) {
      driverNames[driverNumber] = driverName;
      currentPoints[driverNumber] = finalPoints;
      driverNumbers.push(driverNumber);
    }
  }
  
  return {
    driverNames,
    currentPoints,
    allRaces: ALL_RACES,
    allSprints: ALL_SPRINTS,
    drivers: driverNumbers,
    source: 'worker'
  };
}

async function fetchAllData() {
  const currentYear = new Date().getUTCFullYear();
  
  try {
    // Try the new Worker first
    const workerData = await fetchFromWorker(currentYear);
    console.log('Successfully fetched from F1 Worker');
    return workerData;
    
  } catch (workerError) {
    console.error('F1 Worker failed:', workerError);
    
    try {
      // Fall back to original API
      const fallbackData = await fetchFromFallback();
      console.log('Successfully fetched from fallback API');
      return fallbackData;
      
    } catch (fallbackError) {
      console.error('Fallback API also failed:', fallbackError);
      throw new Error(`Both APIs failed. Worker: ${workerError.message}, Fallback: ${fallbackError.message}`);
    }
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  
  // Enable CORS with caching headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300, s-maxage=300' // 5 min cache
  };
  
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    const currentDate = new Date().toISOString();
    
    // Check memory cache first (local development)
    if (memoryCache && memoryCacheTimestamp) {
      const needsRefresh = shouldRefreshCache(currentDate, memoryCacheTimestamp);
      if (!needsRefresh) {
        return new Response(JSON.stringify(memoryCache), {
          headers: {
            ...corsHeaders,
            'X-Cache-Status': 'MEMORY-HIT',
            'X-Cache-Date': memoryCacheTimestamp,
            'X-Data-Source': memoryCache.source || 'unknown'
          }
        });
      }
    }
    
    // Try to get cached data from KV (production)
    let cachedData = null;
    let cachedTimestamp = null;
    
    if (env && env.F1_CACHE) {
      try {
        const [kvData, kvTimestamp] = await Promise.all([
          env.F1_CACHE.get(CACHE_KEY, { type: 'json' }),
          env.F1_CACHE.get(CACHE_TIMESTAMP_KEY)
        ]);
        cachedData = kvData;
        cachedTimestamp = kvTimestamp;
      } catch (kvError) {
        console.log('KV access failed, proceeding without cache:', kvError.message);
      }
    }
    
    // Check if we need to refresh
    const needsRefresh = shouldRefreshCache(currentDate, cachedTimestamp);
    
    if (cachedData && !needsRefresh) {
      return new Response(JSON.stringify(cachedData), {
        headers: {
          ...corsHeaders,
          'X-Cache-Status': 'KV-HIT',
          'X-Cache-Date': cachedTimestamp,
          'X-Data-Source': cachedData.source || 'legacy'
        }
      });
    }
    
    // Fetch fresh data
    const freshData = await fetchAllData();
    const responseData = {
      ...freshData,
      cacheTimestamp: currentDate
    };
    
    // Cache the data in memory (for local dev)
    memoryCache = responseData;
    memoryCacheTimestamp = currentDate;
    
    // Cache in KV for production (don't await to speed up response)
    if (env && env.F1_CACHE) {
      try {
        env.F1_CACHE.put(CACHE_KEY, JSON.stringify(responseData));
        env.F1_CACHE.put(CACHE_TIMESTAMP_KEY, currentDate);
      } catch (kvError) {
        console.log('KV storage failed:', kvError.message);
      }
    }
    
    return new Response(JSON.stringify(responseData), {
      headers: {
        ...corsHeaders,
        'X-Cache-Status': 'MISS',
        'X-Cache-Date': currentDate,
        'X-Data-Source': freshData.source || 'unknown'
      }
    });
    
  } catch (error) {
    console.error('API Error:', error);
    return new Response(JSON.stringify({ 
      error: 'Failed to fetch data', 
      message: error.message 
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
}
