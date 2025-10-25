import { useEffect, useMemo, useRef, useState } from "react";
import type { AppData, DriverNum, ResultItem, Scenario, SimulationType } from "../types";

const RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1, ...Array(10).fill(0)];
const SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1, ...Array(12).fill(0)];
const F1_WORKER_BASE_URL = "https://f1-autocache.djsmanchanda.workers.dev";

type SimulationMode = SimulationType | "momentum" | "recent-form";

export function useF1Simulator() {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<ResultItem[] | null>(null);
  const [recentFormWeeks, setRecentFormWeeks] = useState<number>(5);
  const [recentFormData, setRecentFormData] = useState<Record<number, number[]> | null>(null);
  const [unpredictability, setUnpredictability] = useState<number>(50);

  const [scenarios, setScenarios] = useState<Record<number, Scenario[]>>({});
  const lastResultsRef = useRef<ResultItem[] | null>(null);
  const lastSimTypeRef = useRef<"std" | "real">("std");

  useEffect(() => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 6000);
    fetch("/api/data", { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(async (json) => {
        setData(json);
        (async () => {
          try {
            const year = json.year || new Date().getUTCFullYear();
            const r = await fetch(`${F1_WORKER_BASE_URL}/api/f1/standings.json?year=${year}`);
            if (!r.ok) return;
            const rows = await r.json();
            setData((prev) => (prev ? { ...prev, rawStandings: rows } : prev));
          } catch {
            // ignore
          }
        })();
      })
      .catch(async (e) => {
        try {
          const year = new Date().getUTCFullYear();
          const direct = await fetchFromCacheEndpoints(year);
          setData(direct);
        } catch (e2) {
          setError((e2 as Error).message || (e as Error).message || "Failed to load");
        }
      })
      .finally(() => {
        clearTimeout(t);
        setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const now = new Date();
  const remainingRaces = useMemo(() => data?.allRaces.filter((r) => r.dateTimeUTC && new Date(r.dateTimeUTC) > now) ?? [], [data, now]);
  const remainingSprints = useMemo(() => data?.allSprints.filter((s) => s.sprintDateTimeUTC && new Date(s.sprintDateTimeUTC) > now) ?? [], [data, now]);

  useEffect(() => {
    if (!data) return;
    const total = remainingRaces.length + remainingSprints.length;
    const next: Record<number, Scenario[]> = {};
    for (let i = 0; i < total; i++) next[i] = [];
    setScenarios(next);
  }, [data, remainingRaces.length, remainingSprints.length]);

  const sortedDriversTop5 = useMemo<DriverNum[]>(() => {
    if (!data) return [];
    return Object.entries(data.currentPoints)
      .map(([k, v]) => [parseInt(k), v] as [number, number])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([d]) => d);
  }, [data]);

  function setScenarioList(index: number, list: Scenario[]) {
    setScenarios((prev) => ({ ...prev, [index]: list }));
  }

  function copyScenariosToAll(sourceIndex: number) {
    const total = remainingRaces.length + remainingSprints.length;
    const from = scenarios[sourceIndex] || [];
    setScenarios((prev) => {
      const next: Record<number, Scenario[]> = {};
      for (let i = 0; i < total; i++) {
        next[i] = i === sourceIndex ? (prev[i] || []) : [...from];
      }
      return next;
    });
  }

  function clearAllScenarios() {
    const total = remainingRaces.length + remainingSprints.length;
    setScenarios(() => {
      const next: Record<number, Scenario[]> = {};
      for (let i = 0; i < total; i++) next[i] = [];
      return next;
    });
  }

  function calculateRecentFormWeights(appData: AppData, formData: Record<number, number[]> | null, options?: { decay?: number; mixWithChamp?: number }): Record<number, number> {
    const weights: Record<number, number> = {};
    const decay = options?.decay ?? 0.65;
    const mixWithChamp = options?.mixWithChamp ?? 0.0;

    if (!formData) {
      appData.drivers.forEach(d => {
        weights[d] = appData.currentPoints[d] || 0;
      });
      return weights;
    }

    const rawScores: Record<number, number> = {};
    let maxRaw = 0;
    appData.drivers.forEach((d) => {
      const arr = formData[d] || [];
      if (!arr || arr.length === 0) {
        rawScores[d] = 0.1;
      } else {
        let score = 0;
        for (let i = arr.length - 1, p = 1; i >= 0; i--, p *= decay) {
          const pts = Number(arr[i] ?? 0);
          score += pts * p;
        }
        rawScores[d] = score;
        if (score > maxRaw) maxRaw = score;
      }
    });

    const maxChamp = Math.max(...appData.drivers.map(d => appData.currentPoints[d] ?? 0), 1);
    for (const d of appData.drivers) {
      const normalizedRecent = maxRaw > 0 ? rawScores[d] / maxRaw : 0;
      const normalizedChamp = (appData.currentPoints[d] ?? 0) / maxChamp;
      const combined = normalizedRecent * (1 - mixWithChamp) + normalizedChamp * mixWithChamp;
      weights[d] = Math.max(0.01, combined * 10);
    }

    return weights;
  }

  function generateOrder(drivers: DriverNum[], scList: Scenario[], top5: DriverNum[], simType: SimulationMode, formWeights?: Record<number, number>, unpredictScale?: number) {
    for (let attempt = 0; attempt < 10000; attempt++) {
      let order = [...drivers].sort(() => Math.random() - 0.5);

      if (simType === "realistic") {
        const rand = Math.random();
        if (rand < 0.6) {
          const topIn = top5.filter((d) => drivers.includes(d));
          const others = order.filter((d) => !topIn.includes(d));
          topIn.sort(() => Math.random() - 0.5);
          others.sort(() => Math.random() - 0.5);
          order = [...topIn, ...others];
        } else if (rand < 0.8) {
          const topIn = top5.filter((d) => drivers.includes(d));
          const others = order.filter((d) => !topIn.includes(d));
          topIn.sort(() => Math.random() - 0.5);
          others.sort(() => Math.random() - 0.5);
          order = [...others.slice(0, 10), ...topIn, ...others.slice(10)];
        }
      }

      if ((simType === "recent-form" || simType === "momentum") && formWeights) {
        const unpredictabilityValue = unpredictScale ?? 0.5;
        
        if (unpredictabilityValue === 0) {
          // Fully deterministic: sort strictly by weights
          const scored = drivers.map(d => ({ d, score: formWeights[d] ?? 0 }));
          scored.sort((a, b) => {
            if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
            return a.d - b.d; // deterministic tie-break by driver number
          });
          order = scored.map(s => s.d);
        } else if (unpredictabilityValue === 1) {
          // Fully random: ignore weights completely
          order = [...drivers].sort(() => Math.random() - 0.5);
        } else {
          // Blend weights with randomness
          const noiseMul = simType === "momentum" ? 0.8 : 1.2;
          const randomnessFactor = unpredictabilityValue * noiseMul * 2;
          const scored = drivers.map(d => ({ 
            d, 
            score: (formWeights[d] ?? 0) * (1 - unpredictabilityValue) + (Math.random() - 0.5) * randomnessFactor 
          }));
          scored.sort((a, b) => b.score - a.score);
          order = scored.map(s => s.d);
          
          if (simType === "momentum" && unpredictabilityValue < 0.8) {
            const topSegment = order.slice(0, 3).sort(() => Math.random() - 0.5);
            order = [...topSegment, ...order.slice(3)];
          }
        }
      }

      let valid = true;
      for (const s of scList) {
        if (s.type === "position") {
          const pos = Math.max(1, Math.min(20, parseInt(s.value, 10))) - 1;
          const idx = order.indexOf(s.driver1);
          if (idx !== -1 && pos < order.length) {
            [order[idx], order[pos]] = [order[pos], order[idx]];
          }
        } else if (s.type === "above") {
          const i1 = order.indexOf(s.driver1);
          const i2 = order.indexOf(parseInt(s.value, 10));
          if (i1 !== -1 && i2 !== -1 && i1 > i2) { valid = false; break; }
        }
      }
      if (valid) return order;
    }
    return [...drivers].sort(() => Math.random() - 0.5);
  }

  function simulate(iterations: number, simTypeRaw: SimulationMode): ResultItem[] {
    if (!data) return [];
    const top5 = sortedDriversTop5;
    const actualIterations = iterations;

    let formWeights: Record<number, number> | undefined;
    if (simTypeRaw === "recent-form") {
      formWeights = calculateRecentFormWeights(data, recentFormData, { decay: 0.7, mixWithChamp: 0.15 });
    } else if (simTypeRaw === "momentum") {
      formWeights = calculateRecentFormWeights(data, recentFormData, { decay: 0.5, mixWithChamp: 0.35 });
    }

    const unpredictScale = (simTypeRaw === "recent-form" || simTypeRaw === "momentum") 
      ? unpredictability / 100 
      : undefined;

    const winCounts: Record<number, number> = {};
    data.drivers.forEach((d) => (winCounts[d] = 0));
    for (let sim = 0; sim < actualIterations; sim++) {
      const simPoints: Record<number, number> = {};
      data.drivers.forEach((d) => (simPoints[d] = data.currentPoints[d] || 0));
      for (let r = 0; r < remainingRaces.length; r++) {
        const order = generateOrder(data.drivers, scenarios[r] || [], top5, simTypeRaw, formWeights, unpredictScale);
        order.forEach((driver, pos) => (simPoints[driver] += RACE_POINTS[pos]));
      }
      for (let s = 0; s < remainingSprints.length; s++) {
        const idx = remainingRaces.length + s;
        const order = generateOrder(data.drivers, scenarios[idx] || [], top5, simTypeRaw, formWeights, unpredictScale);
        order.slice(0, 8).forEach((driver, pos) => (simPoints[driver] += SPRINT_POINTS[pos]));
      }
      let max = -1, winner: number | null = null;
      for (const [dStr, pts] of Object.entries(simPoints)) {
        const d = parseInt(dStr); if (pts > max) { max = pts; winner = d; }
      }
      if (winner != null && winCounts[winner] != null) winCounts[winner]++;
    }
    const res = Object.entries(winCounts).map(([d, w]) => ({ driver: parseInt(d), percentage: (w / actualIterations) * 100 }));
    lastResultsRef.current = res.sort((a, b) => b.percentage - a.percentage);
    setResults([...lastResultsRef.current]);
    lastSimTypeRef.current = simTypeRaw === "realistic" ? "real" : "std";
    return lastResultsRef.current;
  }

  async function fetchRecentFormData(weeks: number) {
    if (!data) return;
    try {
      const year = data.year || new Date().getUTCFullYear();
      let standings: any[] | null = (data as any).rawStandings ?? null;
      if (!standings) {
        const res = await fetch(`${F1_WORKER_BASE_URL}/api/f1/standings.json?year=${year}`);
        if (!res.ok) return;
        standings = await res.json();
      }
      if (!Array.isArray(standings) || standings.length === 0) return;
      const first = standings[0] || {};
      const roundKeys = Object.keys(first).filter(k => !["Driver Number", "Driver Name", "Final Points"].includes(k));
      const recentRoundKeys = roundKeys.slice(-weeks);
      const formData: Record<number, number[]> = {};
      data.drivers.forEach(d => (formData[d] = []));
      for (const row of standings) {
        const driverNum = parseInt(row["Driver Number"]) || 0;
        if (!driverNum) continue;
        const cums = roundKeys.map((k) => Number(row[k] ?? 0));
        const perRound = cums.map((v, i) => {
          const prev = i === 0 ? 0 : (cums[i - 1] ?? 0);
          return Math.max(0, v - prev);
        });
        const recentPerRound = recentRoundKeys.map((k) => {
          const idx = roundKeys.indexOf(k);
          return perRound[idx] ?? 0;
        });
        formData[driverNum] = recentPerRound;
      }
      setRecentFormData(formData);
    } catch (e) {
      console.error('Failed to fetch recent form data:', e);
    }
  }

  return {
    data, error, loading,
    remainingRaces, remainingSprints,
    scenarios,
    setScenarioList, copyScenariosToAll, clearAllScenarios,
    simulate,
    results,
    lastResultsRef, lastSimTypeRef,
    recentFormWeeks, setRecentFormWeeks, fetchRecentFormData,
    unpredictability, setUnpredictability,
  };
}

async function fetchFromCacheEndpoints(year: number): Promise<AppData> {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 8000);
  try {
    const [metaRes, standingsRes] = await Promise.all([
      fetch(`${F1_WORKER_BASE_URL}/api/f1/meta?year=${year}`, { signal: controller.signal, headers: { Accept: "application/json" } }),
      fetch(`${F1_WORKER_BASE_URL}/api/f1/standings.json?year=${year}`, { signal: controller.signal, headers: { Accept: "application/json" } }),
    ]);
    if (!metaRes.ok) throw new Error(`meta HTTP ${metaRes.status}`);
    if (!standingsRes.ok) throw new Error(`standings HTTP ${standingsRes.status}`);
    const [meta, standings] = await Promise.all([metaRes.json(), standingsRes.json()]);
    return buildAppDataFromMetaAndStandings(year, meta, standings);
  } finally {
    clearTimeout(to);
  }
}

function buildAppDataFromMetaAndStandings(year: number, meta: any, standings: any): AppData {
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
  // attach rawStandings for reuse
  return { year, driverNames, currentPoints, drivers, allRaces, allSprints, rawStandings: standings } as any;
}
