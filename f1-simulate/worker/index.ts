export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/data") {
      try {
        const year = Number(url.searchParams.get("year")) || new Date().getUTCFullYear();
        const base = "https://f1-autocache.djsmanchanda.workers.dev";
        const [metaRes, standingsRes] = await Promise.all([
          fetch(`${base}/api/f1/meta?year=${year}`, { headers: { Accept: "application/json" } }),
          fetch(`${base}/api/f1/standings.json?year=${year}`, { headers: { Accept: "application/json" } }),
        ]);
        if (!metaRes.ok || !standingsRes.ok) return new Response("Upstream error", { status: 502 });
        const meta = await metaRes.json();
        const standings = await standingsRes.json();
        const payload = buildAppDataFromEndpoints(year, meta, standings);
        return Response.json(payload, { headers: { "Cache-Control": "public, s-maxage=300" } });
      } catch (e) {
        return new Response("Failed to load data", { status: 500 });
      }
    }

    if (url.pathname === "/api/shorten") {
      return handleShorten(request, (globalThis as any).env);
    }

    if (url.pathname.startsWith("/s/")) {
      const code = url.pathname.substring(3);
      return handleRedirect(code, (globalThis as any).env);
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json({ status: "ok" });
    }
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;

function buildAppDataFromEndpoints(year: number, meta: any, standings: any) {
  // Build full-season schedule from meta.rounds
  const roundsMeta = Array.isArray(meta?.rounds) ? meta.rounds : [];
  const allRaces = roundsMeta.map((r: any) => ({
    round: r.round,
    raceName: r.raceName,
    status: r.status,
    hasSprint: Boolean(r.sprintDateTimeUTC),
    dateTimeUTC: r.dateTimeUTC,
    sprintDateTimeUTC: r.sprintDateTimeUTC,
  }));
  const allSprints = allRaces.filter((r: any) => r.hasSprint);

  // Build standings
  const driverNames: Record<number, string> = {};
  const currentPoints: Record<number, number> = {};
  const drivers: number[] = [];
  for (const row of (Array.isArray(standings) ? standings : [])) {
    const num = parseInt(row["Driver Number"]) || 0;
    if (!num) continue;
    const name = row["Driver Name"] || `Driver #${num}`;
    driverNames[num] = name;
    currentPoints[num] = Number(row["Final Points"] ?? 0);
    drivers.push(num);
  }
  return { year, driverNames, currentPoints, drivers, allRaces, allSprints };
}

const SHORT_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

async function handleShorten(request: Request, env: any) {
  const url = new URL(request.url);
  
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }

  let longUrl: string | null = null;
  if (request.method === 'POST') {
    try {
      const body: any = await request.json();
      longUrl = body?.url || null;
    } catch {}
  } else if (request.method === 'GET') {
    longUrl = url.searchParams.get('u');
  }

  let parsed;
  try {
    parsed = new URL(String(longUrl || ''));
  } catch {
    return Response.json({ error: 'Invalid or missing url' }, { status: 400 });
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    return Response.json({ error: 'Only http(s) URLs are allowed' }, { status: 400 });
  }

  // Generate unique code with progressive length
  let code: string | null = null;
  const maxAttempts = 10;
  
  // Try 4 characters first
  for (let i = 0; i < maxAttempts; i++) {
    code = await genBase32Code(3, 4);
    const exists = await getKV(env, `short:code:${code}`);
    if (!exists) break; else code = null;
  }
  
  // Try 5 characters if 4-char space full
  if (!code) {
    for (let i = 0; i < maxAttempts; i++) {
      code = await genBase32Code(4, 5);
      const exists = await getKV(env, `short:code:${code}`);
      if (!exists) break; else code = null;
    }
  }
  
  // Try 6 characters if 5-char space full
  if (!code) {
    for (let i = 0; i < maxAttempts; i++) {
      code = await genBase32Code(4, 6);
      const exists = await getKV(env, `short:code:${code}`);
      if (!exists) break; else code = null;
    }
  }
  
  if (!code) {
    return Response.json({ error: 'Unable to allocate code' }, { status: 503 });
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + SHORT_TTL_SECONDS * 1000).toISOString();
  const record = { url: parsed.toString(), createdAt: now.toISOString(), expiresAt };
  await putKV(env, `short:code:${code}`, JSON.stringify(record), { expirationTtl: SHORT_TTL_SECONDS });

  const base = `${url.protocol}//${url.host}`;
  const shortUrl = `${base}/s/${code}`;
  return Response.json({ code, url: record.url, shortUrl, expiresAt }, { status: 201, headers: { 'Access-Control-Allow-Origin': '*' } });
}

async function handleRedirect(code: string, env: any) {
  const record = await getKV(env, `short:code:${code}`);
  if (!record) {
    return new Response('Not found', { status: 404 });
  }
  try {
    const data = JSON.parse(record);
    return Response.redirect(data.url, 302);
  } catch {
    return new Response('Invalid record', { status: 500 });
  }
}

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

async function genBase32Code(nBytes: number, targetLength: number): Promise<string> {
  const bytes = new Uint8Array(nBytes);
  crypto.getRandomValues(bytes);
  const encoded = base32Encode(bytes);
  return encoded.substring(0, targetLength);
}

function base32Encode(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
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
