const JOLPI = "https://api.jolpi.ca/ergast/f1";

const HEAD_FIXED = ["Driver Number", "Driver Name"]; // dynamic round columns get inserted between + "Final Points"

const JSON_KEY = (y) => `f1:${y}:json`;
const CSV_KEY  = (y) => `f1:${y}:csv`;
const META_KEY = (y) => `f1:${y}:meta`;
const ROUNDS_KEY = (y) => `f1:${y}:rounds`;
const BREAKDOWN_KEY = (y) => `f1:${y}:breakdown`;
const RACE_POSITIONS_KEY = (y) => `f1:${y}:race-positions`;
const POSITION_TALLY_KEY = (y) => `f1:${y}:position-tally`;
const WINS_KEY = (y) => `f1:${y}:wins`;
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

function compareFinishStats(tieMeta, keyA, keyB) {
  const finishMeta = tieMeta || {};
  const finishCounts = finishMeta.finishCounts || new Map();
  const statsA = finishCounts.get(keyA);
  const statsB = finishCounts.get(keyB);
  const highest = Math.max(finishMeta.maxFinishPosition || 0, statsA?.maxPosition || 0, statsB?.maxPosition || 0);
  if (highest === 0) return 0;
  for (let pos = 1; pos <= highest; pos++) {
    const countA = statsA?.counts?.[pos] || 0;
    const countB = statsB?.counts?.[pos] || 0;
    if (countA !== countB) return countB - countA;
  }
  return 0;
}

function accumulate(drivers, perRoundPoints, tieMeta = null) {
  // perRoundPoints: Array<{ round, raceName, pointsByKey: Map<driverKey, number> }>
  // Return rows + dynamic headers
  const driverMap = new Map(drivers.map(d => [d.key, { key: d.key, number: d.number || "", name: d.name, cum: 0 }]));
  // Include drivers who appear only in results but not lineup
  for (const r of perRoundPoints) {
    for (const [k] of r.pointsByKey) {
      if (!driverMap.has(k)) driverMap.set(k, { key: k, number: "", name: k, cum: 0 });
    }
  }

  const headers = [...HEAD_FIXED, ...perRoundPoints.map(r => r.raceName), "Final Points"];

  const rows = [];
  for (const [key, base] of driverMap) {
    const line = {
      key,
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

  rows.sort((a, b) => {
    if (b.final !== a.final) return b.final - a.final;
    const tie = compareFinishStats(tieMeta, a.key, b.key);
    if (tie !== 0) return tie;
    return a.name.localeCompare(b.name);
  });
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

const POSITION_BUCKETS = Array.from({ length: 22 }, (_, i) => i + 1);

function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const mod10 = n % 10;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

function classifyRaceResult(entry) {
  const position = Number(entry.position);
  const posText = String(entry.positionText || "").toUpperCase();
  const statusRaw = entry.status || entry.Status?.status || "";
  const status = statusRaw.toLowerCase();

  if (Number.isFinite(position) && position > 0 && posText !== "R" && !status.includes("did not start") && !status.includes("disqualified")) {
    return { type: "position", value: position };
  }
  if (status.includes("disqualified")) return { type: "dsq" };
  if (status.includes("did not start")) return { type: "dns" };
  return { type: "dnf" };
}

function parsePositionSelection(input) {
  if (!input) return null;
  const maxPos = POSITION_BUCKETS.length;
  const tokens = input.split(",").map(t => t.trim()).filter(Boolean);
  if (tokens.length === 0) return null;
  const selected = new Set();
  for (const token of tokens) {
    const rangeParts = token.split("-").map(x => x.trim()).filter(Boolean);
    if (rangeParts.length === 1) {
      const val = Number(rangeParts[0]);
      if (!Number.isFinite(val) || val < 1 || val > maxPos) return null;
      selected.add(val);
    } else if (rangeParts.length === 2) {
      const start = Number(rangeParts[0]);
      const end = Number(rangeParts[1]);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < 1 || start > maxPos || end > maxPos || end < start) return null;
      for (let n = start; n <= end; n++) selected.add(n);
    } else {
      return null;
    }
  }
  return Array.from(selected).sort((a, b) => a - b);
}

async function computeAndSave(env, year) {
  const [races, drivers] = await Promise.all([getRaces(year), getDrivers(year)]);
  const { rounds } = buildCompletedRounds(races);

  const perRoundPoints = [];
  const roundsMeta = [];
  const occurred = [];
  const sprints = [];
  const finishCounts = new Map();
  let maxFinishPosition = 0;
  const racePositionColumns = [];
  const racePositions = new Map();
  const positionTallies = new Map();
  const winStats = new Map();

  const recordFinish = (key, rawPosition) => {
    const position = Number(rawPosition);
    if (!Number.isFinite(position) || position <= 0) return;
    const current = finishCounts.get(key) || { counts: [], maxPosition: 0 };
    current.counts[position] = (current.counts[position] || 0) + 1;
    if (position > current.maxPosition) current.maxPosition = position;
    finishCounts.set(key, current);
    if (position > maxFinishPosition) maxFinishPosition = position;
  };

  const ensureRacePositionRec = (key, rec) => {
    if (!racePositions.has(key)) {
      racePositions.set(key, { key, number: rec?.number || "", name: rec?.name || key, positions: [] });
    }
    return racePositions.get(key);
  };

  const ensurePositionTally = (key, rec) => {
    if (!positionTallies.has(key)) {
      positionTallies.set(key, {
        key,
        number: rec?.number || "",
        name: rec?.name || key,
        counts: Array(23).fill(0), // 0 unused, 1-22 valid
        dns: 0,
        dnf: 0,
        dsq: 0
      });
    }
    return positionTallies.get(key);
  };

  const ensureWinStat = (key, rec) => {
    if (!winStats.has(key)) {
      winStats.set(key, { key, number: rec?.number || "", name: rec?.name || key, raceWins: 0, podiums: 0 });
    }
    return winStats.get(key);
  };

  const drvMap = new Map(drivers.map(d => [d.key, { key: d.key, number: d.number || "", name: d.name, team: "", racePoints: {}, sprintPoints: {} }]));
  const ensureDriver = (key, displayName) => {
    if (!drvMap.has(key)) {
      drvMap.set(key, { key, number: "", name: displayName || key, team: "", racePoints: {}, sprintPoints: {} });
    }
    return drvMap.get(key);
  };

  let sprintCounter = 0;
  let lastCompletedRound = 0;
  let completedCount = 0;
  let lastStageOrdinal = 0;

  for (let idx = 0; idx < rounds.length; idx++) {
    const roundInfo = rounds[idx];
    const roundNum = Number(roundInfo.round);
    const raceName = roundInfo.raceName;
    const raceTimeISO = roundInfo.raceTime instanceof Date ? roundInfo.raceTime.toISOString() : String(roundInfo.raceTime ?? "");
    const sprintTimeISO = roundInfo.sprintTime instanceof Date ? roundInfo.sprintTime.toISOString() : (roundInfo.sprintTime ? String(roundInfo.sprintTime) : null);

    const [sprintResRaw, raceResRaw] = await Promise.all([
      getSprintResults(year, roundNum).catch(() => []),
      getRaceResults(year, roundNum).catch(() => [])
    ]);

    const [ovSprint, ovRace] = await Promise.all([
      getOverride(env, year, roundNum, "sprint"),
      getOverride(env, year, roundNum, "race")
    ]);

    const sprintRes = Array.isArray(sprintResRaw) ? sprintResRaw : [];
    const raceRes = Array.isArray(raceResRaw) ? raceResRaw : [];
    const hasSprintRes = sprintRes.length > 0;
    const hasRaceRes = raceRes.length > 0;
    const sprintOverrideActive = Array.isArray(ovSprint) && ovSprint.length > 0;
    const raceOverrideActive = Array.isArray(ovRace) && ovRace.length > 0;
    const useSprintOverride = !hasSprintRes && sprintOverrideActive;
    const useRaceOverride = !hasRaceRes && raceOverrideActive;

    const hasSprintData = hasSprintRes || useSprintOverride;
    const hasRaceData = hasRaceRes || useRaceOverride;

    if (!hasSprintData && !hasRaceData) {
      roundsMeta.push({
        round: roundNum,
        raceName,
        status: "upcoming",
        dateTimeUTC: raceTimeISO,
        sprintDateTimeUTC: sprintTimeISO,
        override: { sprint: false, race: false }
      });

      for (let j = idx + 1; j < rounds.length; j++) {
        const future = rounds[j];
        const futureRaceTime = future.raceTime instanceof Date ? future.raceTime.toISOString() : String(future.raceTime ?? "");
        const futureSprintTime = future.sprintTime instanceof Date ? future.sprintTime.toISOString() : (future.sprintTime ? String(future.sprintTime) : null);
        roundsMeta.push({
          round: future.round,
          raceName: future.raceName,
          status: "upcoming",
          dateTimeUTC: futureRaceTime,
          sprintDateTimeUTC: futureSprintTime,
          override: { sprint: false, race: false }
        });
      }
      break;
    }

    if (hasSprintRes && sprintOverrideActive) {
      await clearOverride(env, year, roundNum, "sprint");
    }
    if (hasRaceRes && raceOverrideActive) {
      await clearOverride(env, year, roundNum, "race");
    }

    const pointsByKey = new Map();

    if (hasSprintRes) {
      for (const entry of sprintRes) {
        const d = entry.Driver || {};
        const key = (d.code || d.driverId || fullName(d)).toLowerCase();
        if (!key) continue;
        const pts = Number(entry.points ?? "0") || 0;
        pointsByKey.set(key, (pointsByKey.get(key) || 0) + pts);
        const rec = ensureDriver(key, fullName(d));
        const team = entry.Constructor?.name || entry.constructor?.name || "";
        if (team && !rec.team) rec.team = team;
        rec.sprintPoints[roundNum] = (rec.sprintPoints[roundNum] || 0) + pts;
        const classification = classifyRaceResult(entry);
        if (classification.type === "position" && classification.value <= 3) {
          const winStat = ensureWinStat(key, rec);
          winStat.podiums += 1;
        }
      }
    } else if (useSprintOverride) {
      for (const entry of ovSprint) {
        const key = normalizeEntryKey(entry, drivers);
        if (!key) continue;
        const pts = Number(entry.points) || 0;
        pointsByKey.set(key, (pointsByKey.get(key) || 0) + pts);
        const rec = ensureDriver(key, entry.name || entry.code || key);
        rec.sprintPoints[roundNum] = (rec.sprintPoints[roundNum] || 0) + pts;
      }
    }

    let raceColumnIndex = null;
    if (hasRaceRes) {
      raceColumnIndex = racePositionColumns.length;
      racePositionColumns.push({ round: roundNum, raceName });
      for (const entry of raceRes) {
        const d = entry.Driver || {};
        const key = (d.code || d.driverId || fullName(d)).toLowerCase();
        if (!key) continue;
        const rec = ensureDriver(key, fullName(d));
        const classification = classifyRaceResult(entry);
        const raceRec = ensureRacePositionRec(key, rec);
        raceRec.positions[raceColumnIndex] = classification.type === "position" ? String(classification.value) : classification.type.toUpperCase();
        const tally = ensurePositionTally(key, rec);
        if (classification.type === "position") {
          const bucket = Math.min(classification.value, POSITION_BUCKETS.length);
          tally.counts[bucket] = (tally.counts[bucket] || 0) + 1;
          recordFinish(key, entry.position);
            const winStat = ensureWinStat(key, rec);
            if (classification.value === 1) winStat.raceWins += 1;
            if (classification.value <= 3) winStat.podiums += 1;
        } else {
          tally[classification.type] += 1;
        }
        const pts = Number(entry.points ?? "0") || 0;
        pointsByKey.set(key, (pointsByKey.get(key) || 0) + pts);
        const team = entry.Constructor?.name || entry.constructor?.name || "";
        if (team && !rec.team) rec.team = team;
        rec.racePoints[roundNum] = (rec.racePoints[roundNum] || 0) + pts;
      }
    } else if (useRaceOverride) {
      for (const entry of ovRace) {
        const key = normalizeEntryKey(entry, drivers);
        if (!key) continue;
        const pts = Number(entry.points) || 0;
        pointsByKey.set(key, (pointsByKey.get(key) || 0) + pts);
        const rec = ensureDriver(key, entry.name || entry.code || key);
        rec.racePoints[roundNum] = (rec.racePoints[roundNum] || 0) + pts;
      }
    }

    perRoundPoints.push({ round: roundNum, raceName, pointsByKey });

    const status = hasRaceData ? "completed" : "after-sprint";
    roundsMeta.push({
      round: roundNum,
      raceName,
      status,
      dateTimeUTC: raceTimeISO,
      sprintDateTimeUTC: sprintTimeISO,
      override: {
        sprint: useSprintOverride && !hasSprintRes,
        race: useRaceOverride && !hasRaceRes
      }
    });

    occurred.push({
      round: roundNum,
      raceName,
      status,
      hasSprint: !!sprintTimeISO
    });

    if (hasSprintData) {
      sprintCounter += 1;
      sprints.push({ index: sprintCounter, round: roundNum, raceName });
    }

    if (hasRaceData) {
      completedCount += 1;
      lastCompletedRound = roundNum;
    }

    const stageOrdinal = roundNum * 10 + (hasRaceData ? 2 : 1);
    if (stageOrdinal > lastStageOrdinal) {
      lastStageOrdinal = stageOrdinal;
    }
  }

  const tieMeta = { finishCounts, maxFinishPosition };
  const { headers, rows } = accumulate(drivers, perRoundPoints, tieMeta);

  for (const [key, rec] of drvMap) {
    ensureRacePositionRec(key, rec);
    ensurePositionTally(key, rec);
    ensureWinStat(key, rec);
  }
  for (const rec of racePositions.values()) {
    while (rec.positions.length < racePositionColumns.length) rec.positions.push("");
  }
  const ordering = rows.map(r => r.key);
  const raceHeaders = racePositionColumns.map((_, idx) => `Race ${idx + 1}`);
  const raceRows = ordering.map(key => {
    const rec = racePositions.get(key);
    const row = {
      "Driver Number": rec?.number || "",
      "Driver Name": rec?.name || key
    };
    raceHeaders.forEach((label, idx) => {
      const val = rec?.positions[idx];
      row[label] = val == null ? "" : String(val);
    });
    return row;
  });
  const racePositionsDoc = JSON.stringify({
    year,
    rounds: racePositionColumns.map((col, idx) => ({ index: idx + 1, round: col.round, raceName: col.raceName })),
    rows: raceRows
  });

  const tallyRows = ordering.map(key => {
    const tally = positionTallies.get(key);
    const row = {
      "Driver Number": tally?.number || "",
      "Driver Name": tally?.name || key
    };
    for (const pos of POSITION_BUCKETS) {
      const label = ordinal(pos);
      row[label] = tally?.counts?.[pos] || 0;
    }
    row.DNS = tally?.dns || 0;
    row.DNF = tally?.dnf || 0;
    row.DSQ = tally?.dsq || 0;
    return row;
  });
  const tallyDoc = JSON.stringify({ year, rows: tallyRows });

  const winsRows = ordering.map(key => {
    const stat = winStats.get(key);
    return {
      "Driver Number": stat?.number || "",
      "Driver Name": stat?.name || key,
      "Race Wins": stat?.raceWins || 0,
      "Podiums": stat?.podiums || 0
    };
  });
  const winsDoc = JSON.stringify({ year, rows: winsRows });

  const csv = rowsToCSV(headers, rows);
  const json = JSON.stringify(rowsToJSON(headers, rows));
  const meta = JSON.stringify({
    year,
    lastUpdated: new Date().toISOString(),
    roundsCompleted: completedCount,
    roundsTotal: rounds.length,
    rounds: roundsMeta
  });

  await env.F1_KV.put(JSON_KEY(year), json);
  await env.F1_KV.put(CSV_KEY(year), csv);
  await env.F1_KV.put(META_KEY(year), meta);
  await env.F1_KV.put(RACE_POSITIONS_KEY(year), racePositionsDoc);
  await env.F1_KV.put(POSITION_TALLY_KEY(year), tallyDoc);
  await env.F1_KV.put(WINS_KEY(year), winsDoc);

  const roundsDoc = JSON.stringify({ year, rounds: occurred, sprints });
  await env.F1_KV.put(ROUNDS_KEY(year), roundsDoc);

  const driversArr = Array.from(drvMap.values()).map(rec => {
    const totalRace = Object.values(rec.racePoints).reduce((a, b) => a + b, 0);
    const totalSprint = Object.values(rec.sprintPoints).reduce((a, b) => a + b, 0);
    return { ...rec, totalRacePoints: totalRace, totalSprintPoints: totalSprint, totalPoints: totalRace + totalSprint };
  }).sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    const tie = compareFinishStats(tieMeta, a.key, b.key);
    if (tie !== 0) return tie;
    return a.name.localeCompare(b.name);
  });
  const breakdownDoc = JSON.stringify({ year, rounds: occurred, sprints, drivers: driversArr });
  await env.F1_KV.put(BREAKDOWN_KEY(year), breakdownDoc);

  await env.F1_KV.put(LAST_KEY(year), String(lastCompletedRound));
  await env.F1_KV.put(LAST_STAGE_KEY(year), String(lastStageOrdinal));

  return { csv, json, meta };
}

async function maybeUpdate(env, year) {
  try {
    return await computeAndSave(env, year);
  } catch (err) {
    console.error('maybeUpdate error', err);
    return null;
  }
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
        <div><span class="pill">GET</span> <code>/api/f1/wins.json</code></div>
        <div class="muted">Query: <code>?year=${year}</code> (optional)</div>
        <div>Response: <code>application/json</code></div>
        <div><a href="${withYear(base + "/api/f1/wins.json")}">Open</a></div>
      </div>
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
      <div class="card">
        <div><span class="pill">GET</span> <code>/api/f1/race-positions.json</code></div>
        <div class="muted">Query: <code>?year=${year}</code> (optional)</div>
        <div>Response: <code>application/json</code></div>
        <div><a href="${withYear(base + "/api/f1/race-positions.json")}">Open</a></div>
      </div>
      <div class="card">
        <div><span class="pill">GET</span> <code>/api/f1/position-tally.json</code></div>
        <div class="muted">Query: <code>?year=${year}</code> (optional)</div>
        <div class="muted">Filters: <code>?positions=1-3</code>, <code>?driverNumber=44</code></div>
        <div>Response: <code>application/json</code></div>
        <div><a href="${withYear(base + "/api/f1/position-tally.json")}">Open</a></div>
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

      if (url.pathname === "/api/f1/race-positions.json") {
        const body = await env.F1_KV.get(RACE_POSITIONS_KEY(year));
        if (!body) return new Response(JSON.stringify({ error: "No data yet" }), { status: 404, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
        return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
      }

      if (url.pathname === "/api/f1/position-tally.json") {
        const body = await env.F1_KV.get(POSITION_TALLY_KEY(year));
        if (!body) return new Response(JSON.stringify({ error: "No data yet" }), { status: 404, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });

        const positionsParam = url.searchParams.get("positions");
        const driverParam = url.searchParams.get("driver") || url.searchParams.get("driverNumber");
        if (!positionsParam && !driverParam) {
          return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
        }

        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          return new Response(JSON.stringify({ error: "Malformed data" }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
        }

        let selectedPositions = null;
        if (positionsParam) {
          selectedPositions = parsePositionSelection(positionsParam);
          if (!selectedPositions || selectedPositions.length === 0) {
            return new Response(JSON.stringify({ error: "positions must be a comma list (e.g. 1,2,3) or ranges (e.g. 1-3) within 1-22" }), {
              status: 400,
              headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
          }
        }

        const ordinalLabels = (selectedPositions || POSITION_BUCKETS).map(ordinal);
        let rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
        if (driverParam) {
          const driverFilter = driverParam.trim().toLowerCase();
          rows = rows.filter(row => String(row?.["Driver Number"] || "").trim().toLowerCase() === driverFilter);
        }

        const filteredRows = rows.map(row => {
          const shaped = {
            "Driver Number": row["Driver Number"],
            "Driver Name": row["Driver Name"]
          };
          for (const label of ordinalLabels) {
            shaped[label] = row[label] ?? 0;
          }
          shaped.DNS = row.DNS ?? 0;
          shaped.DNF = row.DNF ?? 0;
          shaped.DSQ = row.DSQ ?? 0;
          return shaped;
        });

        return new Response(JSON.stringify({ ...parsed, rows: filteredRows }), {
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" }
        });
      }

      if (url.pathname === "/api/f1/wins.json") {
        const body = await env.F1_KV.get(WINS_KEY(year));
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