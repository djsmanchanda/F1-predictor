const JOLPI = "https://api.jolpi.ca/ergast/f1";

const HEAD_FIXED = ["Driver Number", "Driver Name"]; // dynamic round columns get inserted between + "Final Points"

const JSON_KEY = (y) => `f1:${y}:json`;
const CSV_KEY  = (y) => `f1:${y}:csv`;
const META_KEY = (y) => `f1:${y}:meta`;
const ROUNDS_KEY = (y) => `f1:${y}:rounds`;
const BREAKDOWN_KEY = (y) => `f1:${y}:breakdown`;
// Historical behavior (kept for compatibility): last fully completed race round
const LAST_KEY = (y) => `f1:${y}:last-round`;
// New: track last processed stage (round*10 + stage), where stage: 1=sprint done, 2=race done
const LAST_STAGE_KEY = (y) => `f1:${y}:last-stage`;
// Manual override keys
const OV_KEY = (y, r, stage) => `f1:${y}:override:${r}:${stage}`; // stage in {"sprint","race"}
const OV_IDX_KEY = (y) => `f1:${y}:override:index`;

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

// ---------- Manual override helpers ----------
function normalizeEntryKey(entry, drivers) {
  const e = entry || {};
  const raw = (e.key || e.code || e.id || e.name || "").toString().toLowerCase().trim();
  if (!raw) return "";
  const dByKey = new Map(drivers.map(d => [d.key, d]));
  if (dByKey.has(raw)) return raw;
  const dByCode = new Map(drivers.filter(d => d.code).map(d => [d.code.toLowerCase(), d]));
  if (dByCode.has(raw)) return dByCode.get(raw).key;
  const dById = new Map(drivers.filter(d => d.id).map(d => [d.id.toLowerCase(), d]));
  if (dById.has(raw)) return dById.get(raw).key;
  const dByName = new Map(drivers.map(d => [d.name.toLowerCase(), d]));
  if (dByName.has(raw)) return dByName.get(raw).key;
  return raw; // fallback
}

async function getOverride(env, year, round, stage) {
  const raw = await env.F1_KV.get(OV_KEY(year, round, stage));
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

async function setOverride(env, year, round, stage, entries) {
  const clean = (entries || []).map(e => ({ key: String(e.key ?? e.code ?? e.id ?? e.name ?? "").trim(), points: Number(e.points) || 0 }));
  await env.F1_KV.put(OV_KEY(year, round, stage), JSON.stringify(clean));
  const idxRaw = await env.F1_KV.get(OV_IDX_KEY(year));
  const idx = idxRaw ? JSON.parse(idxRaw) : [];
  const tag = `${round}:${stage}`;
  if (!idx.includes(tag)) idx.push(tag);
  await env.F1_KV.put(OV_IDX_KEY(year), JSON.stringify(idx));
}

async function clearOverride(env, year, round, stage) {
  await env.F1_KV.delete(OV_KEY(year, round, stage));
  const idxRaw = await env.F1_KV.get(OV_IDX_KEY(year));
  const idx = idxRaw ? JSON.parse(idxRaw) : [];
  const tag = `${round}:${stage}`;
  const next = idx.filter(x => x !== tag);
  if (next.length !== idx.length) await env.F1_KV.put(OV_IDX_KEY(year), JSON.stringify(next));
}

function buildCompletedRounds(races) {
  const now = nowUTC();
  const SIX_H = 6 * 60 * 60 * 1000;
  const ONE_H = 1 * 60 * 60 * 1000;

  // A round is "completed" if Race scheduled time exists and now >= raceTime + 6h
  // (Sprint points will be included if available; otherwise next cron after publish)
  const rounds = races
    .map(r => ({
      round: Number(r.round),
      raceName: r.raceName,
      raceTime: toUTCDate(r.date, r.time),
      sprintTime: r?.Sprint?.date && r?.Sprint?.time ? toUTCDate(r.Sprint.date, r.Sprint.time) : null
    }))
    .filter(x => Number.isFinite(x.round))
    .sort((a,b) => a.round - b.round);

  const raceCompleted = rounds.filter(x => now.getTime() >= (x.raceTime.getTime() + SIX_H));
  const sprintCompleted = rounds.filter(x => x.sprintTime && now.getTime() >= (x.sprintTime.getTime() + ONE_H));
  // A round becomes "eligible" for accumulation if either sprint or race is completed
  const eligibleSet = new Set([...sprintCompleted.map(x => x.round), ...raceCompleted.map(x => x.round)]);
  const eligible = rounds.filter(x => eligibleSet.has(x.round));
  const upcoming  = rounds.filter(x => !eligibleSet.has(x.round));

  return { rounds, raceCompleted, sprintCompleted, eligible, upcoming };
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
  const { rounds, raceCompleted, sprintCompleted, eligible } = buildCompletedRounds(races);

  const completedRounds = raceCompleted.map(r => r.round);
  const perRoundPoints = [];

  // Also build breakdown data in same pass (driver map with separate race/sprint points)
  const drvMap = new Map(drivers.map(d => [d.key, { number: d.number || "", name: d.name, team: "", racePoints: {}, sprintPoints: {} }]));
  const ensureDriver = (key, displayName) => {
    if (!drvMap.has(key)) {
      drvMap.set(key, { number: "", name: displayName || key, team: "", racePoints: {}, sprintPoints: {} });
    }
    return drvMap.get(key);
  };

  for (const r of eligible) {
    const [sprintRes, raceRes] = await Promise.all([
      getSprintResults(year, r.round),
      getRaceResults(year, r.round)
    ]);

    const pointsByKey = new Map();

    // Load overrides if needed
    const [ovSprint, ovRace] = await Promise.all([
      getOverride(env, year, r.round, "sprint"),
      getOverride(env, year, r.round, "race")
    ]);

    // Sprint points: prefer API, otherwise override
    if (Array.isArray(sprintRes) && sprintRes.length) {
      for (const s of sprintRes) {
        const d = s.Driver || {};
        const key = (d.code || d.driverId || fullName(d)).toLowerCase();
        const pts = Number(s.points ?? "0") || 0;
        pointsByKey.set(key, (pointsByKey.get(key) || 0) + pts);
        // Also update breakdown
        const rec = ensureDriver(key, fullName(d));
        const team = s.Constructor?.name || s.constructor?.name || "";
        if (team && !rec.team) rec.team = team;
        rec.sprintPoints[r.round] = (rec.sprintPoints[r.round] || 0) + pts;
      }
      if (ovSprint && ovSprint.length) {
        await clearOverride(env, year, r.round, "sprint");
      }
    } else if (ovSprint && ovSprint.length) {
      for (const e of ovSprint) {
        const key = normalizeEntryKey(e, drivers);
        if (!key) continue;
        const pts = Number(e.points) || 0;
        pointsByKey.set(key, (pointsByKey.get(key) || 0) + pts);
        // Also update breakdown
        const rec = ensureDriver(key);
        rec.sprintPoints[r.round] = (rec.sprintPoints[r.round] || 0) + pts;
      }
    }

    // Race points: prefer API, otherwise override
    if (Array.isArray(raceRes) && raceRes.length) {
      for (const s of raceRes) {
        const d = s.Driver || {};
        const key = (d.code || d.driverId || fullName(d)).toLowerCase();
        const pts = Number(s.points ?? "0") || 0;
        pointsByKey.set(key, (pointsByKey.get(key) || 0) + pts);
        // Also update breakdown
        const rec = ensureDriver(key, fullName(d));
        const team = s.Constructor?.name || s.constructor?.name || "";
        if (team && !rec.team) rec.team = team;
        rec.racePoints[r.round] = (rec.racePoints[r.round] || 0) + pts;
      }
      if (ovRace && ovRace.length) {
        await clearOverride(env, year, r.round, "race");
      }
    } else if (ovRace && ovRace.length) {
      for (const e of ovRace) {
        const key = normalizeEntryKey(e, drivers);
        if (!key) continue;
        const pts = Number(e.points) || 0;
        pointsByKey.set(key, (pointsByKey.get(key) || 0) + pts);
        // Also update breakdown
        const rec = ensureDriver(key);
        rec.racePoints[r.round] = (rec.racePoints[r.round] || 0) + pts;
      }
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
  // Build metadata with override flags
  const roundsMeta = [];
  for (const r of rounds) {
    const raceDone = completedRounds.includes(r.round);
    const sprintDone = sprintCompleted.some(x => x.round === r.round);
    const [oS, oR] = await Promise.all([
      getOverride(env, year, r.round, "sprint"),
      getOverride(env, year, r.round, "race")
    ]);
    roundsMeta.push({
      round: r.round,
      raceName: r.raceName,
      status: raceDone ? "completed" : (sprintDone ? "after-sprint" : "upcoming"),
      dateTimeUTC: r.raceTime.toISOString?.() || toUTCDate(r.date, r.time).toISOString(),
      sprintDateTimeUTC: r.sprintTime?.toISOString?.(),
      override: { sprint: !!(oS && oS.length), race: !!(oR && oR.length) }
    });
  }
  const meta = JSON.stringify({
    year,
    lastUpdated: new Date().toISOString(),
    roundsCompleted: raceCompleted.length,
    roundsTotal: rounds.length,
    rounds: roundsMeta
  });

  await env.F1_KV.put(JSON_KEY(year), json);
  await env.F1_KV.put(CSV_KEY(year), csv);
  await env.F1_KV.put(META_KEY(year), meta);

  // Also cache rounds and breakdown docs (breakdown already built in same pass above)
  const occurred = eligible.map(x => ({
    round: x.round,
    raceName: x.raceName,
    status: (raceCompleted.some(a => a.round === x.round)) ? "completed" : "after-sprint",
    hasSprint: !!x.sprintTime
  }));
  const sprints = sprintCompleted.sort((a,b) => a.round - b.round).map((x, i) => ({ index: i + 1, round: x.round, raceName: x.raceName }));
  const roundsDoc = JSON.stringify({ year, rounds: occurred, sprints });
  await env.F1_KV.put(ROUNDS_KEY(year), roundsDoc);

  // Build breakdown payload from drvMap
  const driversArr = Array.from(drvMap.values()).map(rec => {
    const totalRace = Object.values(rec.racePoints).reduce((a,b) => a + b, 0);
    const totalSprint = Object.values(rec.sprintPoints).reduce((a,b) => a + b, 0);
    return { ...rec, totalRacePoints: totalRace, totalSprintPoints: totalSprint, totalPoints: totalRace + totalSprint };
  }).sort((a,b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name));
  const breakdownDoc = JSON.stringify({ year, rounds: occurred, sprints, drivers: driversArr });
  await env.F1_KV.put(BREAKDOWN_KEY(year), breakdownDoc);

  // Maintain legacy last-round (last fully completed race)
  await env.F1_KV.put(LAST_KEY(year), String(Math.max(0, ...completedRounds)));
  // And update last-stage (round*10 + stage) where stage: 2 if race done, else 1 if sprint done, else 0
  const lastStageOrdinal = Math.max(
    0,
    ...rounds.map(r => {
      const raceDone = completedRounds.includes(r.round);
      const sprintDone = sprintCompleted.some(x => x.round === r.round);
      const stage = raceDone ? 2 : (sprintDone ? 1 : 0);
      return r.round * 10 + stage;
    })
  );
  await env.F1_KV.put(LAST_STAGE_KEY(year), String(lastStageOrdinal));

  return { csv, json, meta };
}

async function maybeUpdate(env, year) {
  // Decide if there is a newly eligible stage since last update (sprint or race)
  const races = await getRaces(year);
  const { raceCompleted, sprintCompleted, eligible } = buildCompletedRounds(races);

  // Legacy check: fully completed race round increased
  const lastRound = Number(await env.F1_KV.get(LAST_KEY(year))) || 0;
  const maxCompletedRound = Math.max(0, ...raceCompleted.map(r => r.round));
  if (maxCompletedRound > lastRound) {
    return computeAndSave(env, year);
  }

  // New check: stage advanced (e.g., sprint finished for a round before race)
  const lastStage = Number(await env.F1_KV.get(LAST_STAGE_KEY(year))) || 0;
  const currentStage = Math.max(
    0,
    ...eligible.map(r => {
      const raceDone = raceCompleted.some(x => x.round === r.round);
      const sprintDone = sprintCompleted.some(x => x.round === r.round);
      const stage = raceDone ? 2 : (sprintDone ? 1 : 0);
      return r.round * 10 + stage;
    })
  );
  if (currentStage > lastStage) {
    return computeAndSave(env, year);
  }

  // Also refresh if nothing in KV yet but there's at least some eligible data
  const hasCSV = await env.F1_KV.get(CSV_KEY(year));
  if (!hasCSV && eligible.length) {
    return computeAndSave(env, year);
  }
  return null;
}

export default {
  async fetch(req, env) {
    try {
      const url = new URL(req.url);
      const year = Number(url.searchParams.get("year")) || new Date().getUTCFullYear();
      const method = req.method.toUpperCase();

      // Simple HTML escape
      const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const h = (strings, ...vals) => strings.map((str, i) => str + (i < vals.length ? String(vals[i]) : "")).join("");

      // API Documentation homepage
      if (url.pathname === "/" || url.pathname === "/api/f1" || url.pathname === "/api/f1/docs") {
        const base = url.origin;
        const withYear = (p) => `${p}${p.includes("?") ? "&" : "?"}year=${year}`;

        // Try to get sample payloads from KV; otherwise fall back to defaults
        const [csvRaw, jsonRaw, metaRaw] = await Promise.all([
          env.F1_KV.get(CSV_KEY(year)),
          env.F1_KV.get(JSON_KEY(year)),
          env.F1_KV.get(META_KEY(year))
        ]);

        const sampleCsv = csvRaw ? csvRaw.split("\n").slice(0, 4).join("\n") + (csvRaw.includes("\n") ? "\n..." : "") : [
          'Driver Number,Driver Name,Bahrain Grand Prix,Saudi Arabian Grand Prix,Final Points',
          '81,Oscar Piastri,25,45,45',
          '4,Lando Norris,18,36,36',
          '1,Max Verstappen,15,31,31',
          '...'
        ].join("\n");

        let sampleJson;
        try {
          if (jsonRaw) {
            const arr = JSON.parse(jsonRaw);
            sampleJson = JSON.stringify(arr.slice(0, 3), null, 2) + (arr.length > 3 ? "\n..." : "");
          }
        } catch {}
        if (!sampleJson) {
          sampleJson = JSON.stringify([
            {
              "Driver Number": "81",
              "Driver Name": "Oscar Piastri",
              "Bahrain Grand Prix": 25,
              "Saudi Arabian Grand Prix": 45,
              "Final Points": 45
            },
            {
              "Driver Number": "4",
              "Driver Name": "Lando Norris",
              "Bahrain Grand Prix": 18,
              "Saudi Arabian Grand Prix": 36,
              "Final Points": 36
            }
          ], null, 2);
        }

        let sampleMeta;
        try {
          if (metaRaw) {
            const m = JSON.parse(metaRaw);
            sampleMeta = JSON.stringify({
              year: m.year,
              lastUpdated: m.lastUpdated,
              roundsCompleted: m.roundsCompleted,
              roundsTotal: m.roundsTotal,
              sampleRound: m.rounds?.[0]
            }, null, 2) + (m.rounds && m.rounds.length > 1 ? "\n..." : "");
          }
        } catch {}
        if (!sampleMeta) {
          sampleMeta = JSON.stringify({
            year,
            lastUpdated: new Date().toISOString(),
            roundsCompleted: 0,
            roundsTotal: 24,
            rounds: [
              {
                round: 1,
                raceName: "Bahrain Grand Prix",
                status: "completed",
                dateTimeUTC: "2025-03-01T17:00:00Z",
                sprintDateTimeUTC: null,
                override: { sprint: false, race: false }
              }
            ]
          }, null, 2);
        }

        const html = h`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>F1 Autocache API • Docs</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 0; padding: 24px; line-height: 1.45; }
    header { margin-bottom: 16px; }
    h1 { font-size: 1.6rem; margin: 0 0 8px; }
    .muted { color: #888; }
    section { margin: 20px 0; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    pre { background: rgba(127,127,127,.12); padding: 12px; border-radius: 8px; overflow: auto; }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
    .card { border: 1px solid rgba(127,127,127,.25); border-radius: 10px; padding: 16px; }
    a { color: inherit; }
    .pill { font-size: .8rem; border: 1px solid rgba(127,127,127,.4); padding: 2px 8px; border-radius: 999px; }
  </style>
</head>
<body>
  <header>
    <h1>F1 Autocache API</h1>
    <div class="muted">Base URL: <code>${escHtml(base)}</code> • Year: <code>${year}</code></div>
  </header>

  <section>
    <h2>Endpoints</h2>
    <div class="grid">
      <div class="card">
        <div><span class="pill">GET</span> <code>/api/f1/standings.csv</code></div>
        <div class="muted">Query: <code>?year=${year}</code> (optional)</div>
        <div>Response: <code>text/csv</code></div>
        <div><a href="${withYear(base + "/api/f1/standings.csv")}">Open</a></div>
      <div class="card">
        <div><span class="pill">GET</span> <code>/api/f1/rounds.json</code></div>
        <div class="muted">Query: <code>?year=${year}</code> (optional)</div>
        <div>Response: <code>application/json</code></div>
        <div><a href="${withYear(base + "/api/f1/rounds.json")}">Open</a></div>
      </div>
      <div class="card">
        <div><span class="pill">GET</span> <code>/api/f1/breakdown.json</code></div>
        <div class="muted">Query: <code>?year=${year}</code> (optional)</div>
        <div>Response: <code>application/json</code></div>
        <div><a href="${withYear(base + "/api/f1/breakdown.json")}">Open</a></div>
      </div>
      </div>
      <div class="card">
        <div><span class="pill">GET</span> <code>/api/f1/standings.json</code></div>
        <div class="muted">Query: <code>?year=${year}</code> (optional)</div>
        <div>Response: <code>application/json</code></div>
        <div><a href="${withYear(base + "/api/f1/standings.json")}">Open</a></div>
      </div>
      <div class="card">
        <div><span class="pill">GET</span> <code>/api/f1/meta</code></div>
        <div class="muted">Query: <code>?year=${year}</code> (optional)</div>
        <div>Response: <code>application/json</code></div>
        <div><a href="${withYear(base + "/api/f1/meta")}">Open</a></div>
      </div>

    </div>
  </section>

  <section>
    <h2>Default Outputs</h2>
    <h3>standings.csv</h3>
    <pre><code>${escHtml(sampleCsv)}</code></pre>

    <h3>standings.json</h3>
    <pre><code>${escHtml(sampleJson)}</code></pre>

    <h3>meta</h3>
    <pre><code>${escHtml(sampleMeta)}</code></pre>
  </section>

  <section>
    <h2>Notes</h2>
    <ul>
      <li>All JSON endpoints include <code>Access-Control-Allow-Origin: *</code>.</li>
      <li>CSV/JSON/meta GET endpoints set <code>Cache-Control: public, max-age=300</code>.</li>
      <li>If data isn't available yet, the read endpoints return <code>404</code> with <code>{"error":"No data yet"}</code>.</li>
    </ul>
  </section>

  <footer class="muted">&copy; ${new Date().getUTCFullYear()} F1 Autocache</footer>
</body>
</html>`;

        return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*" } });
      }

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

      if (url.pathname === "/api/f1/rounds.json") {
        const body = await env.F1_KV.get(ROUNDS_KEY(year));
        if (!body) return new Response(JSON.stringify({ error: "No data yet" }), { status: 404, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
        return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
      }

      if (url.pathname === "/api/f1/breakdown.json") {
        const body = await env.F1_KV.get(BREAKDOWN_KEY(year));
        if (!body) return new Response(JSON.stringify({ error: "No data yet" }), { status: 404, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
        return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
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

      // Manual overrides management
      if (url.pathname === "/api/f1/override") {
        if (method === "GET") {
          const idxRaw = await env.F1_KV.get(OV_IDX_KEY(year));
          const idx = idxRaw ? JSON.parse(idxRaw) : [];
          const items = [];
          for (const tag of idx) {
            const [roundStr, stage] = tag.split(":");
            const round = Number(roundStr);
            const dataRaw = await env.F1_KV.get(OV_KEY(year, round, stage));
            items.push({ round, stage, entries: dataRaw ? JSON.parse(dataRaw) : [] });
          }
          return new Response(JSON.stringify({ year, overrides: items }), {
            headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
          });
        }

        // Token required for mutating
        const token = env.API_TOKEN;
        if (token) {
          const auth = req.headers.get("Authorization") || "";
          if (!auth.startsWith("Bearer ") || auth.slice(7) !== token) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }});
          }
        }

        if (method === "POST") {
          const body = await req.json().catch(() => ({}));
          const round = Number(body.round);
          const stage = String(body.stage || "").toLowerCase(); // 'sprint' | 'race'
          const entries = Array.isArray(body.entries) ? body.entries : (Array.isArray(body.drivers) ? body.drivers : []);
          if (!Number.isFinite(round) || !(stage === "sprint" || stage === "race") || entries.length === 0) {
            return new Response(JSON.stringify({ error: "Invalid payload. Expect { round, stage: 'sprint'|'race', entries: [{ key|code|id|name, points }] }" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }});
          }
          await setOverride(env, year, round, stage, entries);
          const res = await computeAndSave(env, year);
          return new Response(JSON.stringify({ ok: true, lastUpdated: JSON.parse(res.meta).lastUpdated }), {
            headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
          });
        }

        if (method === "DELETE") {
          const round = Number(url.searchParams.get("round"));
          const stage = String(url.searchParams.get("stage") || "").toLowerCase();
          if (!Number.isFinite(round) || !(stage === "sprint" || stage === "race")) {
            return new Response(JSON.stringify({ error: "Provide round and stage=sprint|race" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }});
          }
          await clearOverride(env, year, round, stage);
          const res = await computeAndSave(env, year);
          return new Response(JSON.stringify({ ok: true, lastUpdated: JSON.parse(res.meta).lastUpdated }), {
            headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
          });
        }

        return new Response(JSON.stringify({ error: "Method Not Allowed" }), { status: 405, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }});
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