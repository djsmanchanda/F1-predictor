const JOLPI = "https://api.jolpi.ca/ergast/f1";

const HEAD_FIXED = ["Driver Number", "Driver Name"]; // dynamic round columns get inserted between + "Final Points"

const JSON_KEY = (y) => `f1:${y}:json`;
const CSV_KEY  = (y) => `f1:${y}:csv`;
const META_KEY = (y) => `f1:${y}:meta`;
const LAST_KEY = (y) => `f1:${y}:last-round`;

const toUTCDate = (dateStr, timeStr) => new Date(`${dateStr}T${(timeStr || "00:00:00Z").replace("Z","")}Z`);
const nowUTC = () => new Date();

const escCSV = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const fullName = (d) => {
  const g = d?.givenName || "";
  const f = d?.familyName || "";
  return [g, f].filter(Boolean).join(" ").trim() || d?.code || d?.driverId || "Unknown";
};

async function jget(url) {
  const res = await fetch(url, { cf: { cacheTtl: 300 }});
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
  return res.json();
}

async function getRaces(year) {
  const data = await jget(`${JOLPI}/${year}/races/`);
  return data?.MRData?.RaceTable?.Races ?? [];
}

async function getDrivers(year) {
  const data = await jget(`${JOLPI}/${year}/drivers/`);
  const list = data?.MRData?.DriverTable?.Drivers ?? [];
  return list.map(d => ({
    key: (d.code || d.driverId || fullName(d)).toLowerCase(),
    number: String(d.permanentNumber ?? "").trim(),
    name: fullName(d),
    code: d.code || "",
    id: d.driverId || ""
  }));
}

async function getRaceResults(year, round) {
  const data = await jget(`${JOLPI}/${year}/${round}/results/`);
  const races = data?.MRData?.RaceTable?.Races ?? [];
  return races[0]?.Results ?? [];
}

async function getSprintResults(year, round) {
  try {
    const data = await jget(`${JOLPI}/${year}/${round}/sprint/`);
    const races = data?.MRData?.RaceTable?.Races ?? [];
    return races[0]?.SprintResults ?? [];
  } catch {
    return []; // no sprint or not available
  }
}

function buildCompletedRounds(races) {
  const now = nowUTC();
  const SIX_H = 6 * 60 * 60 * 1000;

  // A round is "completed" if Race scheduled time exists and now >= raceTime + 6h
  // (Sprint points will be included if available; otherwise next cron after publish)
  const rounds = races
    .map(r => ({
      round: Number(r.round),
      raceName: r.raceName,
      raceTime: toUTCDate(r.date, r.time)
    }))
    .filter(x => Number.isFinite(x.round))
    .sort((a,b) => a.round - b.round);

  const completed = rounds.filter(x => now.getTime() >= (x.raceTime.getTime() + SIX_H));
  const upcoming  = rounds.filter(x => now.getTime() <  (x.raceTime.getTime() + SIX_H));

  return { rounds, completed, upcoming };
}

function accumulate(drivers, perRoundPoints) {
  // perRoundPoints: Array<{ round, raceName, pointsByKey: Map<driverKey, number> }>
  // Return rows + dynamic headers
  const driverMap = new Map(drivers.map(d => [d.key, { number: d.number || "", name: d.name, cum: 0 }]));
  // Include drivers who appear only in results but not lineup
  for (const r of perRoundPoints) {
    for (const [k, pts] of r.pointsByKey) {
      if (!driverMap.has(k)) driverMap.set(k, { number: "", name: k, cum: 0 });
    }
  }

  const headers = [...HEAD_FIXED, ...perRoundPoints.map(r => r.raceName), "Final Points"];

  const rows = [];
  for (const [key, base] of driverMap) {
    const line = {
      number: base.number,
      name: base.name,
      per: [],
      final: 0
    };
    let running = 0;
    for (const r of perRoundPoints) {
      const add = Number(r.pointsByKey.get(key) || 0);
      running += add;
      line.per.push(running);
    }
    line.final = running;
    rows.push(line);
  }

  rows.sort((a,b) => b.final - a.final || a.name.localeCompare(b.name));
  return { headers, rows };
}

function rowsToCSV(headers, rows) {
  const out = [headers.join(",")];
  for (const r of rows) {
    const cols = [r.number, r.name, ...r.per.map(n => String(n)), String(r.final)].map(escCSV);
    out.push(cols.join(","));
  }
  return out.join("\n");
}

function rowsToJSON(headers, rows) {
  // Turn headers into object keys per row
  const jsonRows = [];
  for (const r of rows) {
    const obj = {
      [headers[0]]: r.number,
      [headers[1]]: r.name
    };
    for (let i = 2; i < headers.length - 1; i++) {
      obj[headers[i]] = r.per[i - 2];
    }
    obj[headers[headers.length - 1]] = r.final;
    jsonRows.push(obj);
  }
  return jsonRows;
}

async function computeAndSave(env, year) {
  const [races, drivers] = await Promise.all([getRaces(year), getDrivers(year)]);
  const { rounds, completed, upcoming } = buildCompletedRounds(races);

  const completedRounds = completed.map(r => r.round);
  const perRoundPoints = [];

  for (const r of completed) {
    const [sprintRes, raceRes] = await Promise.all([
      getSprintResults(year, r.round),
      getRaceResults(year, r.round)
    ]);

    const pointsByKey = new Map();

    // Sprint points
    for (const s of sprintRes) {
      const d = s.Driver || {};
      const key = (d.code || d.driverId || fullName(d)).toLowerCase();
      const pts = Number(s.points ?? "0") || 0;
      pointsByKey.set(key, (pointsByKey.get(key) || 0) + pts);
    }
    // Race points
    for (const s of raceRes) {
      const d = s.Driver || {};
      const key = (d.code || d.driverId || fullName(d)).toLowerCase();
      const pts = Number(s.points ?? "0") || 0;
      pointsByKey.set(key, (pointsByKey.get(key) || 0) + pts);
    }

    // Fill any missing driver permanentNumber (first time we see them)
    for (const [key] of pointsByKey) {
      const drv = drivers.find(x => x.key === key);
      if (!drv) continue;
      // keep as-is; number is already stored in drivers map
    }

    const raceName = rounds.find(x => x.round === r.round)?.raceName || `Round ${r.round}`;
    perRoundPoints.push({ round: r.round, raceName, pointsByKey });
  }

  // Ensure order by round
  perRoundPoints.sort((a,b) => a.round - b.round);

  const { headers, rows } = accumulate(drivers, perRoundPoints);

  const csv = rowsToCSV(headers, rows);
  const json = JSON.stringify(rowsToJSON(headers, rows));
  const meta = JSON.stringify({
    year,
    lastUpdated: new Date().toISOString(),
    roundsCompleted: completed.length,
    roundsTotal: rounds.length,
    rounds: rounds.map(r => ({
      round: r.round,
      raceName: r.raceName,
      status: completedRounds.includes(r.round) ? "completed" : "upcoming",
      dateTimeUTC: r.raceTime.toISOString?.() || toUTCDate(r.date, r.time).toISOString()
    }))
  });

  await env.F1_KV.put(JSON_KEY(year), json);
  await env.F1_KV.put(CSV_KEY(year), csv);
  await env.F1_KV.put(META_KEY(year), meta);
  await env.F1_KV.put(LAST_KEY(year), String(Math.max(0, ...completedRounds)));

  return { csv, json, meta };
}

async function maybeUpdate(env, year) {
  // Decide if there is a newly completed round since last update
  const races = await getRaces(year);
  const { completed } = buildCompletedRounds(races);
  const last = Number(await env.F1_KV.get(LAST_KEY(year))) || 0;
  const maxCompleted = Math.max(0, ...completed.map(r => r.round));
  if (maxCompleted > last) {
    return computeAndSave(env, year);
  }
  // Also refresh if nothing in KV yet
  const hasCSV = await env.F1_KV.get(CSV_KEY(year));
  if (!hasCSV && completed.length) {
    return computeAndSave(env, year);
  }
  return null;
}

export default {
  async fetch(req, env) {
    try {
      const url = new URL(req.url);
      const year = Number(url.searchParams.get("year")) || new Date().getUTCFullYear();

      if (url.pathname === "/api/f1/standings.csv") {
        const csv = await env.F1_KV.get(CSV_KEY(year));
        if (!csv) return new Response(JSON.stringify({ error: "No data yet" }), { status: 404, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }});
        return new Response(csv, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Cache-Control": "public, max-age=300",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }

      if (url.pathname === "/api/f1/standings.json") {
        const json = await env.F1_KV.get(JSON_KEY(year));
        if (!json) return new Response(JSON.stringify({ error: "No data yet" }), { status: 404, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }});
        return new Response(json, {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=300",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }

      if (url.pathname === "/api/f1/meta") {
        const meta = await env.F1_KV.get(META_KEY(year));
        if (!meta) return new Response(JSON.stringify({ error: "No data yet" }), { status: 404, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }});
        return new Response(meta, {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=300",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }

      if (url.pathname === "/api/f1/update" && req.method === "POST") {
        const token = env.API_TOKEN;
        if (token) {
          const auth = req.headers.get("Authorization") || "";
          if (!auth.startsWith("Bearer ") || auth.slice(7) !== token) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }});
          }
        }
        const res = await computeAndSave(env, year);
        return new Response(JSON.stringify({ ok: true, lastUpdated: JSON.parse(res.meta).lastUpdated }), {
          headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
        });
      }

      return new Response("Not Found", { status: 404 });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err.message || err) }), {
        status: 503,
        headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
      });
    }
  },

  async scheduled(event, env, ctx) {
    const year = new Date().getUTCFullYear();
    ctx.waitUntil(maybeUpdate(env, year));
  }
};