// /api/shorten - Base32 URL shortener (90-day TTL)
// Methods: POST (JSON { url }), GET (?u=)

const SHORT_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days
const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

export async function onRequest(context: any) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: JSON_HEADERS });
  }

  if (request.method !== 'POST' && request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: JSON_HEADERS });
  }

  let longUrl: string | null = null;
  if (request.method === 'POST') {
    try {
      const ct = request.headers.get('Content-Type') || '';
      if (ct.includes('application/json')) {
        const body = await request.json();
        longUrl = body?.url || null;
      } else if (ct.includes('application/x-www-form-urlencoded')) {
        const form = await request.formData();
        longUrl = form.get('url') as string;
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

  // Generate a unique code - start with 4 chars, scale to 5 then 6 if needed
  let code: string | null = null;
  const maxAttempts = 10;
  
  // Try 4 characters first (3 bytes -> 4-5 Base32 chars)
  for (let i = 0; i < maxAttempts; i++) {
    code = await genBase32Code(3, 4);
    const exists = await getKV(env, shortKey(code));
    if (!exists) break; else code = null;
  }
  
  // If 4 chars exhausted, try 5 characters (4 bytes -> 6-7 Base32 chars)
  if (!code) {
    for (let i = 0; i < maxAttempts; i++) {
      code = await genBase32Code(4, 5);
      const exists = await getKV(env, shortKey(code));
      if (!exists) break; else code = null;
    }
  }
  
  // If 5 chars exhausted, try 6 characters (4 bytes -> 6 Base32 chars)
  if (!code) {
    for (let i = 0; i < maxAttempts; i++) {
      code = await genBase32Code(4, 6);
      const exists = await getKV(env, shortKey(code));
      if (!exists) break; else code = null;
    }
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

function shortKey(code: string) {
  return `short:code:${code}`;
}

// Prefer env.F1_CACHE KV if available; fallback to in-memory map (dev only)
async function getKV(env: any, key: string) {
  if (env && env.F1_CACHE) return env.F1_CACHE.get(key);
  (globalThis as any).__SHORT_MEM__ = (globalThis as any).__SHORT_MEM__ || new Map();
  const rec = (globalThis as any).__SHORT_MEM__.get(key);
  if (!rec) return null;
  if (rec.exp && rec.exp < Date.now()) { (globalThis as any).__SHORT_MEM__.delete(key); return null; }
  return rec.val;
}

async function putKV(env: any, key: string, value: string, { expirationTtl }: { expirationTtl?: number } = {}) {
  if (env && env.F1_CACHE) return env.F1_CACHE.put(key, value, { expirationTtl });
  (globalThis as any).__SHORT_MEM__ = (globalThis as any).__SHORT_MEM__ || new Map();
  const exp = expirationTtl ? Date.now() + expirationTtl * 1000 : undefined;
  (globalThis as any).__SHORT_MEM__.set(key, { val: value, exp });
}

async function genBase32Code(nBytes: number = 5, targetLength?: number): Promise<string> {
  const bytes = new Uint8Array(nBytes);
  crypto.getRandomValues(bytes);
  const encoded = base32Encode(bytes);
  return targetLength ? encoded.substring(0, targetLength) : encoded;
}

function base32Encode(bytes: Uint8Array): string {
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
