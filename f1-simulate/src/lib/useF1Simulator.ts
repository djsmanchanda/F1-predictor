import { useEffect, useMemo, useRef, useState } from "react";
import type { AppData, DriverNum, ResultItem, Scenario, SimulationType } from "../types";

const RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1, ...Array(10).fill(0)];
const SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1, ...Array(12).fill(0)];

export function useF1Simulator() {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<ResultItem[] | null>(null);

  // scenarios per event index (races first then sprints)
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
      .then((json) => setData(json))
      .catch(async (e) => {
        // Fallback: call the official cache endpoints directly (allowed source of truth)
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

  // initialize scenarios when counts change
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
        // leave source event unchanged, copy to others
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

  function generateOrder(drivers: DriverNum[], scList: Scenario[], top5: DriverNum[], simType: SimulationType) {
    for (let attempt = 0; attempt < 10000; attempt++) {
      let order = [...drivers].sort(() => Math.random() - 0.5);
      let biasChance = 0.5;
      if (simType === "realistic") {
        const rand = Math.random();
        if (rand < 0.6) {
          biasChance = 1.0;
        } else if (rand < 0.8) {
          const topIn = top5.filter((d) => drivers.includes(d));
          const others = order.filter((d) => !topIn.includes(d));
          topIn.sort(() => Math.random() - 0.5);
          others.sort(() => Math.random() - 0.5);
          order = [...others.slice(0, 10), ...topIn, ...others.slice(10)];
          biasChance = 0;
        } else {
          biasChance = 0;
        }
      }
      if (Math.random() < biasChance && top5.length > 0) {
        const topIn = top5.filter((d) => drivers.includes(d));
        const others = order.filter((d) => !topIn.includes(d));
        topIn.sort(() => Math.random() - 0.5);
        others.sort(() => Math.random() - 0.5);
        order = [...topIn, ...others];
      }
      // scenarios
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

  function simulate(iterations: number, simType: SimulationType): ResultItem[] {
    if (!data) return [];
    const top5 = sortedDriversTop5;
    const winCounts: Record<number, number> = {};
    data.drivers.forEach((d) => (winCounts[d] = 0));
    for (let sim = 0; sim < iterations; sim++) {
      const simPoints: Record<number, number> = {};
      data.drivers.forEach((d) => (simPoints[d] = data.currentPoints[d] || 0));
      for (let r = 0; r < remainingRaces.length; r++) {
        const order = generateOrder(data.drivers, scenarios[r] || [], top5, simType);
        order.forEach((driver, pos) => (simPoints[driver] += RACE_POINTS[pos]));
      }
      for (let s = 0; s < remainingSprints.length; s++) {
        const idx = remainingRaces.length + s;
        const order = generateOrder(data.drivers, scenarios[idx] || [], top5, simType);
        order.slice(0, 8).forEach((driver, pos) => (simPoints[driver] += SPRINT_POINTS[pos]));
      }
      let max = -1, winner: number | null = null;
      for (const [dStr, pts] of Object.entries(simPoints)) {
        const d = parseInt(dStr); if (pts > max) { max = pts; winner = d; }
      }
      if (winner != null && winCounts[winner] != null) winCounts[winner]++;
    }
    const res = Object.entries(winCounts).map(([d, w]) => ({ driver: parseInt(d), percentage: (w / iterations) * 100 }));
    lastResultsRef.current = res.sort((a, b) => b.percentage - a.percentage);
    setResults([...lastResultsRef.current]);
    lastSimTypeRef.current = simType === "realistic" ? "real" : "std";
    return lastResultsRef.current;
  }

  return {
    data, error, loading,
    remainingRaces, remainingSprints,
    scenarios,
    setScenarioList, copyScenariosToAll, clearAllScenarios,
    simulate,
    results,
    lastResultsRef, lastSimTypeRef,
  };
}

// Fallback helper: build AppData from the official four endpoints when /api/data isn't reachable in dev
const F1_WORKER_BASE_URL = "https://f1-autocache.djsmanchanda.workers.dev";

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
  return { year, driverNames, currentPoints, drivers, allRaces, allSprints };
}
