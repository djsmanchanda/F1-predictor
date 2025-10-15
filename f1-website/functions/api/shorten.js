// /api/shorten - Base32 URL shortener (90-day TTL)
// Methods: POST (JSON { url }), GET (?u=)

const SHORT_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days
const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: JSON_HEADERS });
  }

  if (request.method !== 'POST' && request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: JSON_HEADERS });
  }

  let longUrl = null;
  if (request.method === 'POST') {
    try {
      const ct = request.headers.get('Content-Type') || '';
      if (ct.includes('application/json')) {
        const body = await request.json();
        longUrl = body?.url || null;
      } else if (ct.includes('application/x-www-form-urlencoded')) {
        const form = await request.formData();
        longUrl = form.get('url');
      }
    } catch {
      // fall through to validation below
    }
  } else {
    longUrl = url.searchParams.get('u');
  }

  // Validate URL
  let parsed;
  try {
    parsed = new URL(String(longUrl || ''));
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid or missing url' }), { status: 400, headers: JSON_HEADERS });
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    return new Response(JSON.stringify({ error: 'Only http(s) URLs are allowed' }), { status: 400, headers: JSON_HEADERS });
  }

  // Generate a unique Base32 code (8 chars)
  let code = null;
  for (let i = 0; i < 5; i++) {
    code = await genBase32Code(5); // 5 bytes -> 40 bits -> 8 Base32 chars
    const exists = await getKV(env, shortKey(code));
    if (!exists) break; else code = null;
  }
  if (!code) {
    return new Response(JSON.stringify({ error: 'Unable to allocate code' }), { status: 503, headers: JSON_HEADERS });
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + SHORT_TTL_SECONDS * 1000).toISOString();
  const record = { url: parsed.toString(), createdAt: now.toISOString(), expiresAt };
  await putKV(env, shortKey(code), JSON.stringify(record), { expirationTtl: SHORT_TTL_SECONDS });

  const base = `${url.protocol}//${url.host}`;
  const shortUrl = `${base}/s/${code}`;
  return new Response(JSON.stringify({ code, url: record.url, shortUrl, expiresAt }), { status: 201, headers: JSON_HEADERS });
}

function shortKey(code) {
  return `short:code:${code}`;
}

// Prefer env.F1_CACHE KV if available; fallback to in-memory map (dev only)
async function getKV(env, key) {
  if (env && env.F1_CACHE) return env.F1_CACHE.get(key);
  globalThis.__SHORT_MEM__ = globalThis.__SHORT_MEM__ || new Map();
  const rec = globalThis.__SHORT_MEM__.get(key);
  if (!rec) return null;
  if (rec.exp && rec.exp < Date.now()) { globalThis.__SHORT_MEM__.delete(key); return null; }
  return rec.val;
}

async function putKV(env, key, value, { expirationTtl } = {}) {
  if (env && env.F1_CACHE) return env.F1_CACHE.put(key, value, { expirationTtl });
  globalThis.__SHORT_MEM__ = globalThis.__SHORT_MEM__ || new Map();
  const exp = expirationTtl ? Date.now() + expirationTtl * 1000 : undefined;
  globalThis.__SHORT_MEM__.set(key, { val: value, exp });
}

async function genBase32Code(nBytes = 5) {
  const bytes = new Uint8Array(nBytes);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

function base32Encode(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // RFC 4648
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
