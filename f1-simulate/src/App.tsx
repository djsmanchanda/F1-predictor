//src/App.tsx
import { useEffect, useState } from "react";
import "./App.css";
import { useF1Simulator } from "./lib/useF1Simulator";
import type { AppData } from "./types";
import { TEAM_COLORS, colorVariant } from "./lib/teamColors";
import {
  buildShareURL,
  buildParameterizedURL,
  shortenURL,
  copyTextToClipboard,
  extractSimulationCode,
  resolveShortCode,
  decodeCompressedScenarios,
  type SimulationType,
} from "./lib/share";

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="container-page space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

export default function App() {
  const sim = useF1Simulator();
  const { data, error, loading } = sim;

  return (
    <div className="min-h-dvh">
      <header className="container-page flex flex-col gap-2">
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">🏁 F1 2025 Championship Simulator</h1>
        <p className="text-muted-foreground">Predict the championship outcome based on your scenarios</p>
      </header>

      {loading ? (
        <Section title="Loading">
          <div className="flex items-center justify-center py-10">
            <div className="size-10 rounded-full border-2 border-primary/20 border-t-transparent animate-spin" />
          </div>
        </Section>
      ) : error ? (
        <Section title="Error">
          <div className="card p-6">Failed to load data. {error}</div>
        </Section>
      ) : data ? (
        <>
          <Section title="Current Driver Standings">
            <StandingsTable data={data} remainingRaces={sim.remainingRaces} remainingSprints={sim.remainingSprints} />
          </Section>

          <Section title="Season Statistics">
            <Stats data={data} />
          </Section>

          <Section title="Points Progression">
            <PointsProgression data={data} />
          </Section>

          <Section title="Set Your Scenarios" subtitle="Configure race outcomes for remaining events">
            <ScenarioEditor {...sim} />
          </Section>

          <Section title="Simulate your Scenarios" subtitle="10000 simulations">
            <SimulatePanel {...sim} />
          </Section>

          <Section title="Championship Win Probability">
            <ResultsPanel results={sim.results} data={data} />
            {sim.results && sim.results.length > 0 && (
              <ShareButtons 
                scenarios={sim.scenarios}
                remainingRaces={sim.remainingRaces}
                remainingSprints={sim.remainingSprints}
                simulationType="standard"
              />
            )}
          </Section>

          <Section title="Path to Victory (beta)" subtitle="See what needs to happen for a driver to win">
            <PathToVictoryPanel {...sim} />
          </Section>

          <footer className="container-page pt-8 pb-12 text-sm text-muted-foreground">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                Made with ❤️ by <a className="underline-offset-4 hover:underline" href="https://djsmanchanda.com" target="_blank" rel="noreferrer">Divjot</a>
              </div>
              <div className="flex items-center gap-4">
                <a className="btn-secondary" href="https://buymeacoffee.com/djsmanchanda" target="_blank" rel="noreferrer">☕ Support this project</a>
                <a className="underline-offset-4 hover:underline" href="https://github.com/djsmanchanda/F1-predictor" target="_blank" rel="noreferrer">Contribute</a>
              </div>
            </div>
          </footer>
        </>
      ) : null}
    </div>
  );
}

function Stats({ data }: { data: AppData }) {
  const now = new Date();
  const remainingRaces = data.allRaces.filter((r) => (r.dateTimeUTC ? new Date(r.dateTimeUTC) : new Date(0)) > now);
  const remainingSprints = data.allSprints.filter((s) => (s.sprintDateTimeUTC ? new Date(s.sprintDateTimeUTC) : new Date(0)) > now);
  const completedRaces = data.allRaces.length - remainingRaces.length;
  const maxPoints = remainingRaces.length * 25 + remainingSprints.length * 8 + remainingRaces.length * 1;

  const items = [
    { label: "Total Races in Season", value: data.allRaces.length, tone: "bg-neutral-900" },
    { label: "Races Completed", value: completedRaces, tone: "bg-green-900/30" },
    { label: "Races Remaining", value: remainingRaces.length, tone: "bg-yellow-900/30" },
    { label: "Sprints Remaining", value: remainingSprints.length, tone: "bg-violet-900/30" },
    { label: "Max Points Possible", value: maxPoints, tone: "bg-red-900/30" },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {items.map((s) => (
        <div key={s.label} className={`card p-4 ${s.tone}`}>
          <div className="text-xs text-muted-foreground">{s.label}</div>
          <div className="text-2xl font-semibold">{s.value}</div>
        </div>
      ))}
    </div>
  );
}

function StandingsTable({ data, remainingRaces, remainingSprints }: { data: AppData; remainingRaces: Array<{round:number}>; remainingSprints: Array<{round:number}> }) {
  const [page, setPage] = useState(0);
  const perPage = 10;
  const sorted = Object.entries<number>(data.currentPoints)
    .map(([k, v]) => [parseInt(k), v] as [number, number])
    .sort((a, b) => b[1] - a[1]);
  const totalPages = Math.ceil(sorted.length / perPage);
  const start = page * perPage;
  const current = sorted.slice(start, start + perPage);

  const leaderId = sorted[0]?.[0];
  const leaderPts = sorted[0]?.[1] ?? 0;
  const maxPointsPossible = (remainingRaces?.length || 0) * 25 + (remainingSprints?.length || 0) * 8 + (remainingRaces?.length || 0) * 1;

  // Precompute contention set: break as soon as one driver exceeds the max possible gap
  const contention = new Set<number>();
  for (const [num, pts] of sorted) {
    const gap = Math.max(0, leaderPts - pts);
    if (gap < maxPointsPossible) {
      contention.add(num);
    } else {
      break; // after the first non-contender, all below are also non-contenders
    }
  }

  // Previous-weekend cumulative points and order
  const [prevPoints, setPrevPoints] = useState<Record<number, number> | null>(null);
  const [leaderPrevPts, setLeaderPrevPts] = useState<number | null>(null);
  const [prevOrder, setPrevOrder] = useState<number[] | null>(null);

  // Build ordered Grand Prix keys from schedule
  const now = new Date();
  let lastCompletedIndex = -1;
  for (let i = data.allRaces.length - 1; i >= 0; i--) {
    const r = data.allRaces[i];
    if (r.status === "completed" || (r.dateTimeUTC && new Date(r.dateTimeUTC) <= now)) { lastCompletedIndex = i; break; }
  }
  const prevIndex = lastCompletedIndex - 1;

  useEffect(() => {
    let cancelled = false;
    async function loadPrev() {
      if (leaderId == null || prevIndex < 0) { setPrevPoints(null); setLeaderPrevPts(null); setPrevOrder(null); return; }
      try {
        const year = new Date().getUTCFullYear();
        const r = await fetch(`https://f1-autocache.djsmanchanda.workers.dev/api/f1/standings.json?year=${year}`);
        if (!r.ok) throw new Error(String(r.status));
        const rows: any[] = await r.json();
  const prevRace = data.allRaces[prevIndex];
  const prevKey = prevRace.raceName;
        // Build prev points map and order
        const ptsMap: Record<number, number> = {};
        for (const row of rows) {
          const num = parseInt(row["Driver Number"]) || 0;
          if (!num) continue;
          ptsMap[num] = Number(row[prevKey] ?? 0);
        }
        const order = Object.entries(ptsMap)
          .map(([k, v]) => [parseInt(k), v] as [number, number])
          .sort((a, b) => b[1] - a[1])
          .map(([d]) => d);
        const leaderPrev = ptsMap[leaderId] ?? 0;
        if (!cancelled) {
          setPrevPoints(ptsMap);
          setPrevOrder(order);
          setLeaderPrevPts(leaderPrev);
        }
      } catch {
        if (!cancelled) { setPrevPoints(null); setPrevOrder(null); setLeaderPrevPts(null); }
      }
    }
    loadPrev();
    return () => { cancelled = true; };
  }, [leaderId, prevIndex]);


  const ArrowLeader = ({ d }: { d: number }) => {
    if (prevPoints == null || leaderPrevPts == null)
      return <span className="text-muted-foreground">—</span>;

    const prevGap = Math.max(0, leaderPrevPts - (prevPoints[d] ?? 0));
    const nowGap = Math.max(0, leaderPts - (data.currentPoints[d] ?? 0));
    const diff = nowGap - prevGap;

    if (nowGap < prevGap)
      return (
        <span className="inline-flex items-center gap-1">
          <span className="text-green-500">▲</span>
          <span className="text-muted-foreground tabular-nums">{diff > 0 ? `+${diff}` : diff}</span>
        </span>
      );

    if (nowGap > prevGap)
      return (
        <span className="inline-flex items-center gap-1">
          <span className="text-red-500">▼</span>
          <span className="text-muted-foreground tabular-nums">{diff > 0 ? `+${diff}` : diff}</span>
        </span>
      );

    return <span className="text-muted-foreground">—</span>;
  };

  const ArrowPrev = ({ d, currentIndex }: { d: number; currentIndex: number }) => {
    if (prevPoints == null || prevOrder == null)
      return <span className="text-muted-foreground">—</span>;

    const idxPrev = prevOrder.indexOf(d);
    if (idxPrev <= 0)
      return <span className="text-muted-foreground">—</span>;

    const prevAbove = prevOrder[idxPrev - 1];
    const prevGapPrev = Math.max(0, (prevPoints[prevAbove] ?? 0) - (prevPoints[d] ?? 0));
    const currAbovePts = currentIndex === 0 ? null : (sorted[currentIndex - 1]?.[1] ?? null);
    const nowGapPrev =
      currAbovePts == null ? 0 : Math.max(0, (currAbovePts ?? 0) - (data.currentPoints[d] ?? 0));
    const diff = nowGapPrev - prevGapPrev;

    if (nowGapPrev < prevGapPrev)
      return (
        <span className="inline-flex items-center gap-1">
          <span className="text-green-500">▲</span>
          <span className="text-muted-foreground tabular-nums">{diff > 0 ? `+${diff}` : diff}</span>
        </span>
      );

    if (nowGapPrev > prevGapPrev)
      return (
        <span className="inline-flex items-center gap-1">
          <span className="text-red-500">▼</span>
          <span className="text-muted-foreground tabular-nums">{diff > 0 ? `+${diff}` : diff}</span>
        </span>
      );

    return <span className="text-muted-foreground">—</span>;
  };

  const PositionChange = ({ d, currentIndex }: { d: number; currentIndex: number }) => {
    if (prevOrder == null) return null;

    const prevPos = prevOrder.indexOf(d);
    if (prevPos < 0) return null;

    const posChange = prevPos - currentIndex;
    
    if (posChange > 0) {
      // Moved up (previous position was higher number = worse position)
      return (
        <span className="inline-flex items-center gap-0.5 ml-1">
          <span className="text-green-500 text-[0.6rem]">▲</span>
          <span className="text-green-500/60 text-[0.65rem] tabular-nums">{posChange}</span>
        </span>
      );
    }

    if (posChange < 0) {
      // Moved down
      return (
        <span className="inline-flex items-center gap-0.5 ml-1">
          <span className="text-red-500 text-[0.6rem]">▼</span>
          <span className="text-red-500/60 text-[0.65rem] tabular-nums">{Math.abs(posChange)}</span>
        </span>
      );
    }

    return null;
  };

  return (
    <div className="card p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-0 w-full">
          <div className="grid grid-cols-[4rem_1fr_8rem_8rem_6rem] items-center bg-muted/60 px-4 py-2 text-sm font-medium">
            <div className="text-left">Pos</div>
            <div className="text-left">Driver</div>
            <div className="text-center">Δ Leader</div>
            <div className="text-center">Δ Prev</div>
            <div className="text-right">Points</div>
          </div>

          <div className="p-1 space-y-1">
            {current.map(([num, pts], idx) => {
              const absIndex = start + idx;
              const gapLeader = Math.max(0, leaderPts - pts);
              const gapPrev = absIndex === 0 ? 0 : Math.max(0, (sorted[absIndex - 1]?.[1] ?? pts) - pts);
              const isLeader = num === leaderId;
              const isContender = !isLeader && contention.has(num);

              return (
                <div
                  key={num}
                  className={`grid grid-cols-[4rem_1fr_8rem_8rem_6rem] items-center border border-border/60 rounded-md shadow-md hover:shadow-lg hover:-translate-y-1 relative hover:z-10 transition px-2 py-1.5 ${
                    isLeader
                      ? "bg-yellow-900/25 ring-1 ring-yellow-500/30"
                      : isContender
                      ? "bg-green-900/15 ring-1 ring-green-500/25"
                      : "bg-background/40"
                  } card-fixed-row`}
                >
                  <div className="px-2 font-medium inline-flex items-center">
                    <span>{absIndex + 1}</span>
                    <PositionChange d={num} currentIndex={absIndex} />
                  </div>
                  <div className="px-2">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-[35%] bg-neutral-200/80">
                        <img
                          src={`/driver_numbers/${num}.png`}
                          alt={`#${num}`}
                          className="h-5 w-5 object-contain"
                          onError={(e) => ((e.currentTarget.style.display = 'none'), undefined)}
                        />
                      </span>
                      <span className="font-semibold truncate max-w-[120px] md:max-w-none">{data.driverNames[num] || `Driver #${num}`}</span>
                    </div>
                  </div>
                  <div className="px-2 text-center">
                    <div className="inline-flex items-center gap-3">
                      <span className="tabular-nums font-medium w-10 text-right">{gapLeader}</span>
                      <span className="inline-block w-14 text-left">
                        <ArrowLeader d={num} />
                      </span>
                    </div>
                  </div>
                  <div className="px-2 text-center">
                    <div className="inline-flex items-center gap-3">
                      <span className="tabular-nums font-medium w-10 text-right">{gapPrev}</span>
                      <span className="inline-block w-14 text-left">
                        <ArrowPrev d={num} currentIndex={absIndex} />
                      </span>
                    </div>
                  </div>
                  <div className="px-2 text-right font-semibold tabular-nums">{pts}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-border/50 px-4 py-2">
        <button className="btn-secondary" onClick={() => setPage((p) => Math.max(p - 1, 0))} disabled={page === 0}>
          ← Previous
        </button>
        <div className="text-sm text-muted-foreground">Page {page + 1} of {totalPages}</div>
        <button className="btn-secondary" onClick={() => setPage((p) => Math.min(p + 1, totalPages - 1))} disabled={page >= totalPages - 1}>
          Next →
        </button>
      </div>
    </div>
  );
}

type ScenarioItem = { type: "position" | "above"; driver1: number; value: string };
function ScenarioEditor({ data, scenarios, setScenarioList, remainingRaces, remainingSprints, copyScenariosToAll }: ReturnType<typeof useF1Simulator>) {
  if (!data) return null;
  const total = remainingRaces.length + remainingSprints.length;
  const [selected, setSelected] = useState(0);
  const shortName = (name: string) => name.replace(/\s*Grand Prix$/i, "").trim();
  const options = [
    ...remainingRaces.map((r, i) => ({ id: i, label: `🏁 ${shortName(r.raceName)}` })),
    ...remainingSprints.map((s, i) => ({ id: remainingRaces.length + i, label: `⚡ ${shortName(s.raceName)}` })),
  ];

  // Copy a single scenario from the selected event to all events (append)
  const copyOneScenarioToAll = (idxInList: number) => {
    const sourceList = scenarios[selected] || [];
    const item = sourceList[idxInList];
    if (!item) return;
    for (let i = 0; i < total; i++) {
      if (i === selected) continue; // avoid duplicating on source event
      const list = scenarios[i] || [];
      setScenarioList(i, [...list, { ...item }]);
    }
  };

  return (
    <div className="space-y-3">
  <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap py-1 scrollbar-slim">
        {options.map((o) => {
          const isSel = selected === o.id;
          return (
            <button
              key={o.id}
              type="button"
              className={`btn-secondary whitespace-nowrap snap-start ${isSel ? "opacity-60 cursor-default" : ""}`}
              aria-pressed={isSel}
              onClick={() => !isSel && setSelected(o.id)}
              disabled={isSel}
              title={o.label}
            >
              {o.label}
            </button>
          );
        })}
      </div>

      <div className="card p-4">
        {(() => {
          const isRace = selected < remainingRaces.length;
          const full = isRace
            ? `🏁 ${remainingRaces[selected]?.raceName ?? ""}`
            : `⚡ ${remainingSprints[selected - remainingRaces.length]?.raceName ?? ""}`;
          return <h3 className="font-semibold mb-3">{full}</h3>;
        })()}
        <ScenarioList
          eventIndex={selected}
          drivers={data.drivers}
          driverNames={data.driverNames}
          value={scenarios[selected] || []}
          onChange={(v) => setScenarioList(selected, v)}
          onCopyOne={copyOneScenarioToAll}
          onCopyAllFromCurrent={() => copyScenariosToAll(selected)}
        />
      </div>
    </div>
  );
}

function ScenarioList({ eventIndex: _eventIndex, drivers, driverNames, value, onChange, onCopyOne, onCopyAllFromCurrent }: { eventIndex: number; drivers: number[]; driverNames: Record<number, string>; value: ScenarioItem[]; onChange: (v: ScenarioItem[]) => void; onCopyOne?: (idx: number) => void; onCopyAllFromCurrent?: () => void }) {
  const takenDrivers = new Set((value || []).filter((s) => s.type === "position").map((s) => s.driver1));
  const takenPositions = new Set((value || []).filter((s) => s.type === "position").map((s) => s.value));
  const firstAvailable = drivers.find((d) => !takenDrivers.has(d)) ?? drivers[0];
  const add = () => {
    const firstAvailablePosition = Array.from({ length: 20 }, (_, i) => String(i + 1)).find((p) => !takenPositions.has(p)) ?? "1";
    onChange([...(value || []), { type: "position", driver1: firstAvailable, value: firstAvailablePosition }]);
  };
  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= (value?.length || 0)) return;
    const next = [...(value || [])];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };
  const update = (idx: number, patch: Partial<ScenarioItem>) => {
    onChange(
      value.map((v, i) => {
        if (i !== idx) return v;
        const next = { ...v, ...patch } as ScenarioItem;
        // if switching to position and current driver is already taken elsewhere, pick first available
        if (patch.type === "position") {
          const othersTaken = new Set((value || []).filter((s, j) => j !== idx && s.type === "position").map((s) => s.driver1));
          if (othersTaken.has(next.driver1)) {
            const avail = drivers.find((d) => !othersTaken.has(d));
            if (avail != null) next.driver1 = avail;
          }
          // Also check if position is already taken
          const othersTakenPos = new Set((value || []).filter((s, j) => j !== idx && s.type === "position").map((s) => s.value));
          if (othersTakenPos.has(next.value)) {
            // Find first available position
            const availPos = Array.from({ length: 20 }, (_, i) => String(i + 1)).find((p) => !othersTakenPos.has(p));
            if (availPos != null) next.value = availPos;
          }
        }
        return next;
      })
    );
  };
  return (
    <div className="space-y-2">
      {(!value || value.length === 0) ? (
        <button
          type="button"
          onClick={add}
          className="w-full border-2 border-dashed border-border/60 rounded-md px-4 py-6 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition"
          title="Click to create a default scenario"
        >
          Default scenario • click to start
        </button>
      ) : null}
      {(value || []).map((s, idx) => (
        <div key={idx} className="flex gap-2 items-center">
          <select className="card px-3 py-2 w-40" value={s.type} onChange={(e) => update(idx, { type: e.target.value as any })}>
            <option value="position">Set Position</option>
            <option value="above">A Above B</option>
          </select>
          <select className="card px-3 py-2 flex-1 min-w-0" value={s.driver1} onChange={(e) => update(idx, { driver1: parseInt(e.target.value, 10) })}>
            {drivers.map((d) => {
              const isTaken = takenDrivers.has(d) && !(s.type === "position" && s.driver1 === d);
              return (
                <option key={d} value={d} disabled={s.type === "position" ? isTaken : false}>
                  {`#${d} — ${driverNames[d] || `Driver #${d}`}`}
                  {s.type === "position" && isTaken ? " (used)" : ""}
                </option>
              );
            })}
          </select>
          {s.type === "position" ? (
            <select className="card px-3 py-2 w-44" value={s.value} onChange={(e) => update(idx, { value: e.target.value })}>
              {Array.from({ length: 20 }, (_, i) => {
                const pos = String(i + 1);
                const isTaken = takenPositions.has(pos) && s.value !== pos;
                return (
                  <option key={i + 1} value={pos} disabled={isTaken}>
                    {`Position ${i + 1}`}
                    {isTaken ? " (used)" : ""}
                  </option>
                );
              })}
            </select>
          ) : (
            <select className="card px-3 py-2 w-44" value={s.value} onChange={(e) => update(idx, { value: e.target.value })}>
              {drivers.filter((d) => d !== s.driver1).map((d) => (
                <option key={d} value={String(d)}>{`#${d} — ${driverNames[d] || `Driver #${d}`}`}</option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-1">
            <button className="btn-secondary" title="Move up" onClick={() => move(idx, idx - 1)} disabled={idx === 0}>↑</button>
            <button className="btn-secondary" title="Move down" onClick={() => move(idx, idx + 1)} disabled={idx >= (value.length - 1)}>↓</button>
            {onCopyOne ? (
              <button className="btn-secondary" title="Copy this scenario to all events" onClick={() => onCopyOne(idx)}>📄</button>
            ) : null}
            <button className="btn-secondary" onClick={() => remove(idx)}>✕</button>
          </div>
        </div>
      ))}
      <div className="grid grid-cols-3 items-center gap-2">
        <div />
        <div className="flex justify-center">
          <button className="btn-primary" onClick={add}>+ Add Scenario</button>
        </div>
        <div className="flex justify-end">
          {onCopyAllFromCurrent ? (
            <button className="btn-secondary" onClick={onCopyAllFromCurrent}>📋 Copy all scenarios</button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SimulatePanel(sim: ReturnType<typeof useF1Simulator>) {
  const [busy, setBusy] = useState(false);
  const [showFormSelector, setShowFormSelector] = useState(false);
  const [selectedFormType, setSelectedFormType] = useState<"recent-form" | "momentum">("recent-form");
  const [lastSimType, setLastSimType] = useState<"standard" | "realistic" | "recent-form" | "momentum" | null>(null);
  const [showInfo, setShowInfo] = useState<string | null>(null);
  const [showLoadBox, setShowLoadBox] = useState(false);
  const [loadInput, setLoadInput] = useState('');
  const [loadStatus, setLoadStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const simInfo = {
    standard: "Completely random race outcomes with equal probability for all drivers. No biases or patterns.",
    realistic: "Top 5 championship drivers have a higher chance of getting podiums, simulating more predictable outcomes.",
    "recent-form": "Analyzes recent race performance to weight probabilities. Use the unpredictability slider to control randomness vs form-based predictions.",
    momentum: "Similar to Recent Form but emphasizes current trajectory. Lower unpredictability = stronger momentum effect.",
    load: "Load a shared simulation from a code or URL. Enter a short code (e.g., ABC123) or paste a full simulation URL."
  };

  const run = (type: "standard" | "realistic" | "recent-form" | "momentum") => {
    if (type === "recent-form" || type === "momentum") {
      setShowFormSelector(true);
      setSelectedFormType(type);
      return;
    }
    setShowFormSelector(false);
    setLastSimType(type);
    setBusy(true);
    setTimeout(() => {
      if (sim.data) {
        // cast to any to avoid strict SimulationType mismatch
        sim.simulate(10000, type as any);
        setBusy(false);
      } else {
        setBusy(false);
      }
    }, 50);
  };

  const runRecentForm = () => {
    // Don't close the form selector anymore
    setLastSimType(selectedFormType);
    setBusy(true);
    setTimeout(() => {
      if (sim.data) {
        sim.fetchRecentFormData(sim.recentFormWeeks).then(() => {
          sim.simulate(10000, selectedFormType as any);
          setBusy(false);
        });
      } else {
        setBusy(false);
      }
    }, 50);
  };

  const getButtonClass = (type: "standard" | "realistic" | "recent-form" | "momentum") => {
    const baseClass = "relative card p-4 text-left transition-all duration-200 hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100";
    const isSelected = lastSimType === type || (showFormSelector && (type === "recent-form" || type === "momentum") && selectedFormType === type);
    const selectedClass = isSelected ? "ring-2 ring-primary shadow-lg shadow-primary/20 bg-neutral-700/30" : "";
    return `${baseClass} ${selectedClass}`;
  };

  const handleLoadSimulation = async () => {
    if (!loadInput.trim() || !sim.data) return;
    
    setIsLoading(true);
    setLoadStatus(null);

    try {
      const extracted = extractSimulationCode(loadInput);
      
      if (!extracted.code || !extracted.type) {
        setLoadStatus({ type: 'error', message: 'Invalid simulation code or URL' });
        setIsLoading(false);
        return;
      }

      let sc2Code = extracted.code;

      // If it's a short code, resolve it first
      if (extracted.type === 'short') {
        setLoadStatus({ type: 'info', message: 'Resolving short code...' });
        const resolvedUrl = await resolveShortCode(extracted.code);
        
        if (!resolvedUrl) {
          setLoadStatus({ type: 'error', message: 'Short code not found or expired' });
          setIsLoading(false);
          return;
        }

        // Extract sc2 from resolved URL
        try {
          const url = new URL(resolvedUrl);
          const sc2Param = url.searchParams.get('sc2');
          if (!sc2Param) {
            setLoadStatus({ type: 'error', message: 'Invalid simulation data' });
            setIsLoading(false);
            return;
          }
          sc2Code = sc2Param;
        } catch {
          setLoadStatus({ type: 'error', message: 'Failed to parse resolved URL' });
          setIsLoading(false);
          return;
        }
      }

      // Decode the scenarios
      const { scenarios, simulationType } = decodeCompressedScenarios(
        sc2Code,
        sim.remainingRaces,
        sim.remainingSprints
      );

      // Load scenarios into the simulator
      const total = sim.remainingRaces.length + sim.remainingSprints.length;
      for (let i = 0; i < total; i++) {
        sim.setScenarioList(i, scenarios[i] || []);
      }

      setLoadStatus({ type: 'success', message: `✓ Loaded ${Object.keys(scenarios).length} scenario(s) (${simulationType} mode)` });
      setLoadInput('');
      
      // Keep success message visible
    } catch (err) {
      console.error('Load simulation error:', err);
      setLoadStatus({ type: 'error', message: 'Failed to load simulation. Invalid format.' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {(() => {
          const isSelected = lastSimType === "standard" && !showFormSelector;
          return (
            <button
              className={getButtonClass("standard")}
              data-selected={isSelected}
              aria-pressed={isSelected}
              disabled={busy}
              onClick={() => run("standard")}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="font-semibold">{busy && lastSimType === "standard" ? "⏳ Simulating..." : "🎯 Standard"}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Random outcomes</div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowInfo(showInfo === "standard" ? null : "standard"); }}
                  className="text-muted-foreground hover:text-foreground text-sm px-1 transition-colors"
                  title="More info"
                >
                  ⓘ
                </button>
              </div>
              {showInfo === "standard" && (
                <div className="mt-2 pt-2 border-t border-border/50 text-xs text-muted-foreground">
                  {simInfo.standard}
                </div>
              )}
            </button>
          );
        })()}
        {(() => {
          const isSelected = lastSimType === "realistic" && !showFormSelector;
          return (
            <button
              className={getButtonClass("realistic")}
              data-selected={isSelected}
              aria-pressed={isSelected}
              disabled={busy}
              onClick={() => run("realistic")}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="font-semibold">{busy && lastSimType === "realistic" ? "⏳ Simulating..." : "🏎️ Realistic"}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Top 5 favored</div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowInfo(showInfo === "realistic" ? null : "realistic"); }}
                  className="text-muted-foreground hover:text-foreground text-sm px-1 transition-colors"
                  title="More info"
                >
                  ⓘ
                </button>
              </div>
              {showInfo === "realistic" && (
                <div className="mt-2 pt-2 border-t border-border/50 text-xs text-muted-foreground">
                  {simInfo.realistic}
                </div>
              )}
            </button>
          );
        })()}
        {(() => {
          const isSelected = lastSimType === "recent-form" || (showFormSelector && selectedFormType === "recent-form");
          return (
            <button
              className={getButtonClass("recent-form")}
              data-selected={isSelected}
              aria-pressed={isSelected}
              disabled={busy}
              onClick={() => run("recent-form")}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="font-semibold">{busy && lastSimType === "recent-form" ? "⏳ Simulating..." : "📊 Recent Form"}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Performance-based</div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowInfo(showInfo === "recent-form" ? null : "recent-form"); }}
                  className="text-muted-foreground hover:text-foreground text-sm px-1 transition-colors"
                  title="More info"
                >
                  ⓘ
                </button>
              </div>
              {showInfo === "recent-form" && (
                <div className="mt-2 pt-2 border-t border-border/50 text-xs text-muted-foreground">
                  {simInfo["recent-form"]}
                </div>
              )}
            </button>
          );
        })()}
        {(() => {
          const isSelected = lastSimType === "momentum" || (showFormSelector && selectedFormType === "momentum");
          return (
            <button
              className={getButtonClass("momentum")}
              data-selected={isSelected}
              aria-pressed={isSelected}
              disabled={busy}
              onClick={() => run("momentum")}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="font-semibold">{busy && lastSimType === "momentum" ? "⏳ Simulating..." : "🔁 Momentum"}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Trajectory-focused</div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowInfo(showInfo === "momentum" ? null : "momentum"); }}
                  className="text-muted-foreground hover:text-foreground text-sm px-1 transition-colors"
                  title="More info"
                >
                  ⓘ
                </button>
              </div>
              {showInfo === "momentum" && (
                <div className="mt-2 pt-2 border-t border-border/50 text-xs text-muted-foreground">
                  {simInfo.momentum}
                </div>
              )}
            </button>
          );
        })()}
        {(() => {
          return (
            <button
              className="relative card p-4 text-left transition-all duration-200 hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              data-selected={showLoadBox}
              aria-pressed={showLoadBox}
              disabled={busy || isLoading}
              onClick={() => {
                setShowFormSelector(false);
                setShowLoadBox(!showLoadBox);
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="font-semibold">{isLoading ? "⏳ Loading..." : "📥 Load"}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Import simulation</div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowInfo(showInfo === "load" ? null : "load"); }}
                  className="text-muted-foreground hover:text-foreground text-sm px-1 transition-colors"
                  title="More info"
                >
                  ⓘ
                </button>
              </div>
              {showInfo === "load" && (
                <div className="mt-2 pt-2 border-t border-border/50 text-xs text-muted-foreground">
                  {simInfo.load}
                </div>
              )}
            </button>
          );
        })()}
      </div>

      {/* Load Simulation Box */}
      <div 
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{ 
          maxHeight: showLoadBox ? '200px' : '0',
          opacity: showLoadBox ? 1 : 0
        }}
      >
        <div className="card p-4 space-y-3">
          <div className="flex gap-3">
            <input
              type="text"
              value={loadInput}
              onChange={(e) => setLoadInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLoadSimulation()}
              placeholder="Enter code (e.g., ABC123) or paste URL"
              className="flex-1 px-3 py-2 bg-muted border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={isLoading}
            />
            <button
              onClick={handleLoadSimulation}
              disabled={isLoading || !loadInput.trim() || !sim.data}
              className="btn-primary px-6 whitespace-nowrap disabled:opacity-50"
            >
              {isLoading ? '⏳' : '▶️ Load'}
            </button>
          </div>
          {loadStatus && (
            <div className={`text-sm ${
              loadStatus.type === 'success' ? 'text-green-500' : 
              loadStatus.type === 'error' ? 'text-red-500' : 
              'text-yellow-500'
            }`}>
              {loadStatus.message}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            💡 Enter a simulation code or paste a URL to load scenarios. You can try unlimited times.
          </p>
        </div>
      </div>

      {/* Form Selector for Recent Form / Momentum */}
      <div 
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{ 
          maxHeight: showFormSelector ? (selectedFormType === "momentum" ? '120px' : '200px') : '0',
          opacity: showFormSelector ? 1 : 0
        }}
      >
        <div className="card p-4 space-y-4">
          {selectedFormType === "recent-form" && (
            <div className="flex items-center gap-4">
              <label htmlFor="form-weeks" className="text-sm font-medium whitespace-nowrap">Analyze last:</label>
              <input
                id="form-weeks"
                type="range"
                min="1"
                max="20"
                value={sim.recentFormWeeks}
                onChange={(e) => sim.setRecentFormWeeks(parseInt(e.target.value))}
                className="flex-1"
                disabled={busy}
              />
              <span className="text-sm font-semibold w-16 text-center">{sim.recentFormWeeks} races</span>
            </div>
          )}
          
          <div className="flex items-center gap-4">
            <label htmlFor="unpredictability" className="text-sm font-medium whitespace-nowrap">Unpredictability:</label>
            <input
              id="unpredictability"
              type="range"
              min="0"
              max="100"
              value={sim.unpredictability}
              onChange={(e) => sim.setUnpredictability(parseInt(e.target.value))}
              className="flex-1"
              disabled={busy}
            />
            <span className="text-sm font-semibold w-16 text-center">{sim.unpredictability}%</span>
          </div>

          <div className="flex justify-end">
            <button 
              className="btn-primary px-6 py-2 text-sm whitespace-nowrap" 
              disabled={busy} 
              onClick={runRecentForm}
            >
              {busy ? "⏳ Simulating..." : "▶️ Run"}
            </button>
          </div>
        </div>
      </div>

      <button className="btn-secondary w-full" disabled={busy} onClick={() => sim.clearAllScenarios()}>
        🗑️ Clear All Scenarios
      </button>
    </div>
  );
}

function ResultsPanel({ results, data }: { results: Array<{ driver: number; percentage: number; avgPoints?: number }> | null; data: AppData | null }) {
    const [showPoints, setShowPoints] = useState(false);
    
    if (!results || !data || results.length === 0) {
        return <div className="card p-4 text-muted-foreground">Run a simulation to see results.</div>;
    }

    // sort primarily by win percentage, then by current championship points (desc), then by driver number
    const sorted = [...results].sort((a, b) => {
        const pctDiff = b.percentage - a.percentage;
        if (Math.abs(pctDiff) > 1e-9) return pctDiff;
        const ptsA = data.currentPoints[a.driver] ?? 0;
        const ptsB = data.currentPoints[b.driver] ?? 0;
        const ptsDiff = ptsB - ptsA;
        if (ptsDiff !== 0) return ptsDiff;
        return a.driver - b.driver;
    });

    const top = sorted.slice(0, 5);
    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <button
                    onClick={() => setShowPoints(!showPoints)}
                    className="btn-secondary px-4 py-2 text-sm"
                >
                    {showPoints ? "Hide Points" : "Show Points"}
                </button>
            </div>
            <div className="space-y-2">
                {top.map((r) => (
                    <div key={r.driver} className="card p-3">
                        <div className="flex items-center gap-4">
                            <div className="w-10 text-sm text-muted-foreground">#{r.driver}</div>
                            <div className="flex-1">
                                <div className="font-medium">{data.driverNames[r.driver] || `Driver #${r.driver}`}</div>
                                <div className="h-2 mt-2 rounded bg-muted">
                                    <div className="h-2 rounded bg-green-500" style={{ width: `${r.percentage}%` }} />
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="w-16 text-right font-semibold">{r.percentage.toFixed(1)}%</div>
                                {showPoints && (
                                    <div className="w-20 text-right text-sm text-muted-foreground">
                                        {r.avgPoints ?? 0} pts
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function ShareButtons({ 
  scenarios, 
  remainingRaces, 
  remainingSprints, 
  simulationType = 'standard' 
}: { 
  scenarios: Record<number, Array<{ type: 'position' | 'above'; driver1: number; value: string }>>; 
  remainingRaces: Array<{ round: number }>; 
  remainingSprints: Array<{ round: number }>; 
  simulationType?: SimulationType;
}) {
  const [shareStatus, setShareStatus] = useState<string>('');
  const [isSharing, setIsSharing] = useState(false);
  const [lastShortCode, setLastShortCode] = useState<string | null>(null);

  const hasScenarios = Object.keys(scenarios).length > 0;

  const handleShare = async (e: React.MouseEvent) => {
    if (!hasScenarios) return;
    
    setIsSharing(true);
    setShareStatus('');
    setLastShortCode(null);

    try {
      // Ctrl+click = copy full parameterized URL
      if (e.ctrlKey || e.metaKey) {
        const paramUrl = buildParameterizedURL(scenarios, remainingRaces, remainingSprints, simulationType);
        await copyTextToClipboard(paramUrl);
        setShareStatus('✓ Full URL copied!');
      } else {
        // Default: create shortened URL
        const compressedUrl = buildShareURL(scenarios, remainingRaces, remainingSprints, simulationType);
        try {
          const shortUrl = await shortenURL(compressedUrl);
          
          // Extract short code from the URL (abc123)
          try {
            const urlObj = new URL(shortUrl);
            const match = urlObj.pathname.match(/\/s\/([a-zA-Z0-9]+)/);
            if (match && match[1]) {
              setLastShortCode(match[1]);
            }
          } catch {
            // Couldn't parse, skip code extraction
          }
          
          await copyTextToClipboard(shortUrl);
          setShareStatus('✓ Link copied!');
        } catch (err) {
          console.error('Shortening failed, using compressed URL:', err);
          
          // Fallback: extract the compressed data as the "code"
          try {
            const urlObj = new URL(compressedUrl);
            const data = urlObj.searchParams.get('data');
            if (data) {
              setLastShortCode(data);
            }
          } catch {
            // Couldn't extract data
          }
          
          await copyTextToClipboard(compressedUrl);
          setShareStatus('✓ Link copied!');
        }
      }

      setTimeout(() => setShareStatus(''), 5000);
    } catch (err) {
      console.error('Share failed:', err);
      setShareStatus('✗ Failed to copy');
      setTimeout(() => setShareStatus(''), 3000);
    } finally {
      setIsSharing(false);
    }
  };

  const copyShortCode = async () => {
    if (lastShortCode) {
      await copyTextToClipboard(lastShortCode);
      setShareStatus('✓ Code copied!');
      setTimeout(() => setShareStatus(''), 3000);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-3 items-center flex-wrap">
        <button
          onClick={handleShare}
          disabled={!hasScenarios || isSharing}
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          title={hasScenarios ? "Click to copy short link, Ctrl+Click for full URL" : "Run a simulation first"}
        >
          {isSharing ? '⏳ Creating link...' : '🔗 Share'}
        </button>
        
        <button
          disabled
          className="btn-secondary opacity-30 cursor-not-allowed"
          title="Coming soon"
        >
          𝕏 Share to X
        </button>

        {shareStatus && (
          <span className={`text-sm ${shareStatus.startsWith('✓') ? 'text-green-500' : 'text-red-500'}`}>
            {shareStatus}
          </span>
        )}
      </div>
      
      {lastShortCode && (
        <div className="card p-3 bg-muted/50 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-sm text-muted-foreground whitespace-nowrap">Share sim code:</span>
            <code className="text-sm font-mono bg-background px-2 py-1 rounded border border-border truncate">
              {lastShortCode}
            </code>
          </div>
          <button
            onClick={copyShortCode}
            className="btn-secondary px-3 py-1 text-xs whitespace-nowrap"
            title="Copy code to clipboard"
          >
            📋 Copy
          </button>
        </div>
      )}
    </div>
  );
}

function PathToVictoryPanel({ data, remainingRaces, remainingSprints }: { data: AppData | null; remainingRaces: Array<{ round: number }>; remainingSprints: Array<{ round: number }> }) {
  const [selectedDriver, setSelectedDriver] = useState<number | null>(null);
  const [pathResult, setPathResult] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  if (!data) return <div className="card p-4 text-muted-foreground">Loading data...</div>;

  const top5Drivers = Object.entries(data.currentPoints)
    .map(([k, v]) => [parseInt(k), v] as [number, number])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const handleCalculate = async (driver: number) => {
    if (!data) return;
    
    setSelectedDriver(driver);
    setLoading(true);
    setPathResult(null);
    
    try {
      // Import the calculator
      const { calculatePathToVictory, calculateDriverStats } = await import('./lib/pathToVictory');
      
      // Get raw standings if available
      const rawStandings = (data as any).rawStandings || [];
      const { wins, podiums } = calculateDriverStats(rawStandings);
      
      const result = calculatePathToVictory(
        driver,
        data,
        remainingRaces,
        remainingSprints,
        wins,
        podiums
      );
      
      setPathResult(result);
    } catch (err) {
      console.error('Path to victory calculation error:', err);
      setPathResult({
        driver: driver,
        driverName: data.driverNames[driver] || `Driver #${driver}`,
        isPossible: false,
        reason: 'Calculation error'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Driver Selection - Top 5 Buttons */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {top5Drivers.map(([driver, points], index) => {
          const isSelected = selectedDriver === driver;
          return (
            <button
              key={driver}
              onClick={() => handleCalculate(driver)}
              disabled={loading}
              className={`card p-4 text-left transition-all duration-200 hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed ${
                isSelected ? 'ring-2 ring-primary shadow-lg shadow-primary/20 bg-neutral-700/30' : ''
              }`}
              data-selected={isSelected}
              aria-pressed={isSelected}
            >
              <div className="text-xs text-muted-foreground mb-1">P{index + 1}</div>
              <div className="font-semibold text-lg">#{driver}</div>
              <div className="text-sm truncate">{data.driverNames[driver]}</div>
              <div className="text-xs text-muted-foreground mt-1">{points} pts</div>
            </button>
          );
        })}
      </div>

      {/* Loading State */}
      {loading && (
        <div className="card p-8 text-center">
          <div className="text-4xl mb-2">⏳</div>
          <p className="text-muted-foreground">Calculating path to victory...</p>
        </div>
      )}

      {/* Results */}
      {pathResult && !loading && (
        <div className="space-y-4">
          {!pathResult.isPossible ? (
            <div className="card p-4 bg-red-900/20 border-red-500/30">
              <h3 className="font-semibold text-lg mb-2">❌ No Path to Victory</h3>
              <p className="text-muted-foreground">{pathResult.reason}</p>
            </div>
          ) : (
            <>
              {/* Summary */}
              <div className="card p-4 bg-green-900/20 border-green-500/30">
                <h3 className="font-semibold text-lg mb-2">✅ Path to Victory Found</h3>
                <p className="text-xl font-bold text-green-400 mb-3">{pathResult.requirements.description}</p>
                
                <div className="space-y-2">
                  <h4 className="font-medium text-sm text-muted-foreground">What {pathResult.driverName} needs:</h4>
                  <ul className="space-y-1">
                    {pathResult.requirements.driverNeeds.map((need: string, i: number) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-green-500">•</span>
                        <span>{need}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Rival Constraints */}
              {pathResult.requirements.rivalConstraints.length > 0 && (
                <div className="card p-4">
                  <h4 className="font-semibold mb-3">Rival Constraints</h4>
                  <div className="space-y-3">
                    {pathResult.requirements.rivalConstraints.map((rival: any, i: number) => (
                      <div key={i} className="border-l-4 border-yellow-500/50 pl-3">
                        <div className="font-medium">
                          #{rival.driver} {rival.driverName}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Max {rival.maxPoints} points
                        </div>
                        <ul className="text-sm space-y-1 mt-1">
                          {rival.constraints.map((c: string, j: number) => (
                            <li key={j} className="text-yellow-300">• {c}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Scenario Table */}
              {pathResult.requirements.scenarioTable.length > 0 && (
                <div className="card p-4 overflow-x-auto">
                  <h4 className="font-semibold mb-3">Scenario Breakdown</h4>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-2">Driver</th>
                        <th className="text-right py-2 px-2">Current Pts</th>
                        <th className="text-right py-2 px-2">Gained Pts</th>
                        <th className="text-right py-2 px-2">Final Pts</th>
                        <th className="text-right py-2 px-2">Current Wins</th>
                        <th className="text-right py-2 px-2">Gained Wins</th>
                        <th className="text-right py-2 px-2">Final Wins</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pathResult.requirements.scenarioTable.map((row: any, i: number) => (
                        <tr key={i} className={`border-b border-border/50 ${row.driver === pathResult.driver ? 'bg-green-900/20' : ''}`}>
                          <td className="py-2 px-2 font-medium">
                            #{row.driver} {row.driverName}
                          </td>
                          <td className="text-right py-2 px-2">{row.currentPoints}</td>
                          <td className="text-right py-2 px-2 text-green-400">+{row.gainedPoints}</td>
                          <td className="text-right py-2 px-2 font-bold">{row.finalPoints}</td>
                          <td className="text-right py-2 px-2">{row.currentWins}</td>
                          <td className="text-right py-2 px-2 text-green-400">+{row.gainedWins}</td>
                          <td className="text-right py-2 px-2 font-bold">{row.finalWins}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {!pathResult && !loading && (
        <div className="card p-8 text-center text-muted-foreground">
          <div className="text-4xl mb-2">🎯</div>
          <p>Select a top 5 driver to calculate their path to championship victory</p>
        </div>
      )}
    </div>
  );
}

function PointsProgression({ data }: { data: AppData }) {
  const [mode, setMode] = useState<'all'|'top5'|'battle3'>('all');
  const [rows, setRows] = useState<any[] | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [teamByNum, setTeamByNum] = useState<Record<number, string>>({});
  const [selectedNums, setSelectedNums] = useState<Set<number> | null>(null);
  const [sprintWeeks, setSprintWeeks] = useState<boolean[]>([]);
  const yearFromData = data?.year;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
  const year = yearFromData || new Date().getUTCFullYear();
        const [rStandings, rBreakdown, rRounds] = await Promise.all([
          fetch(`https://f1-autocache.djsmanchanda.workers.dev/api/f1/standings.json?year=${year}`),
          fetch(`https://f1-autocache.djsmanchanda.workers.dev/api/f1/breakdown.json?year=${year}`),
          fetch(`https://f1-autocache.djsmanchanda.workers.dev/api/f1/rounds.json?year=${year}`)
        ]);
        if (!rStandings.ok) throw new Error(String(rStandings.status));
        const arr: any[] = await rStandings.json();
        if (cancelled) return;
        setRows(arr);
        // Extract round labels in order (headers 3..n-1 excluding final points)
        const first = arr[0] || {};
        const keys = Object.keys(first).filter(k => !["Driver Number","Driver Name","Final Points"].includes(k));
        setLabels(keys);
        // Build team mapping from breakdown (if available)
        if (rBreakdown.ok) {
          const bd = await rBreakdown.json();
          const map: Record<number, string> = {};
          for (const d of (bd?.drivers || [])) {
            const num = parseInt(d.number || "") || 0;
            if (!num) continue;
            if (d.team) map[num] = String(d.team);
          }
          if (!cancelled) setTeamByNum(map);
        }
        // Sprint flags by round index
        if (rRounds.ok) {
          const rounds = await rRounds.json();
          const flags: boolean[] = Array.isArray(rounds?.rounds)
            ? rounds.rounds.map((r: any) => !!(r?.sprint || r?.hasSprint || r?.sprintDateTimeUTC))
            : (Array.isArray(rounds) ? rounds.map((r: any) => !!(r?.sprint || r?.hasSprint || r?.sprintDateTimeUTC)) : []);
          if (!cancelled) setSprintWeeks(flags);
        }
      } catch {
        setRows(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Initialize selection once when rows arrive
  useEffect(() => {
    if (!selectedNums && rows) {
      const all = new Set<number>((rows || []).map(r => parseInt(r["Driver Number"]) || 0).filter(Boolean));
      setSelectedNums(all);
    }
  }, [rows]);

  if (!rows || labels.length === 0) return null;

  // Build series from rows
  const seriesByDriver = rows.map((row) => ({
    num: parseInt(row["Driver Number"]) || 0,
    name: row["Driver Name"] as string,
    series: labels.map((k) => Number(row[k] ?? 0)),
  }));

  // Initialize selection (all drivers) once rows are ready
  if (!selectedNums) {
    const all = new Set<number>(seriesByDriver.map(s => s.num).filter(Boolean));
    setSelectedNums(all);
  }

  // Determine top drivers by final points for filtering
  const topSorted = [...seriesByDriver].sort((a,b) => (b.series[b.series.length-1] - a.series[a.series.length-1]));
  const top3 = topSorted.slice(0,3);
  const top5 = topSorted.slice(0,5);

  // Mode selectors
  const view = mode === 'all' ? seriesByDriver : (mode === 'top5' ? top5 : top3);

  // Determine per-driver colors using team colors with slight variations per teammate
  const palette = (() => {
    const indicesByTeam: Record<string, number> = {};
    const baseFrom = (mode === 'all' ? seriesByDriver : view);
    return baseFrom.map((s) => {
      const team = teamByNum[s.num] || "";
      const base = TEAM_COLORS[team] || null;
      if (!base) {
        // fallback color cycle if team unknown
        const fallback = ["#4781D7","#F47600","#00D7B6","#ED1131","#1868DB","#01C00E","#6C98FF","#9C9FA2","#00A1E8","#229971"]; 
        return fallback[(s.num * 7 + s.name.length * 13) % fallback.length];
      }
      const idx = indicesByTeam[team] ?? 0;
      indicesByTeam[team] = idx + 1;
      return colorVariant(base, idx);
    });
  })();

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <button className={`btn-secondary ${mode==='all'? 'opacity-60' : ''}`} onClick={() => setMode('all')}>All drivers (cumulative)</button>
        <button className={`btn-secondary ${mode==='top5'? 'opacity-60' : ''}`} onClick={() => setMode('top5')}>Top 5: Δ Leader</button>
        <button className={`btn-secondary ${mode==='battle3'? 'opacity-60' : ''}`} onClick={() => setMode('battle3')}>Championship battle</button>
        
      </div>

      {/* 1) Cumulative progression */}
      {mode === 'all' && (
        <div className="card p-4 overflow-x-auto">
          <SparkLines
            labels={labels}
            dataSeries={seriesByDriver}
            palette={palette}
            yLabel="Points"
            selectedSet={selectedNums}
            onToggleSeries={(num) => {
              setSelectedNums(prev => {
                const set = new Set(prev || []);
                if (set.has(num)) set.delete(num); else set.add(num);
                return set;
              });
            }}
            sprintWeeks={sprintWeeks}
          />
        </div>
      )}

      {/* 2) Difference from leader (top 5) */}
      {mode === 'top5' && (
        <div className="card p-4 overflow-x-auto">
          <DeltaLeader labels={labels} allSeries={seriesByDriver} topSeries={top5} palette={palette} sprintWeeks={sprintWeeks} />
        </div>
      )}

      {/* 3) Championship battle (top 3 around average) */}
      {mode === 'battle3' && (
        <div className="card p-4 overflow-x-auto">
          <BattleThree labels={labels} battleSeries={top3} palette={palette} sprintWeeks={sprintWeeks} />
        </div>
      )}
    </div>
  );
}

function SparkLines({ labels, dataSeries, palette, yLabel, selectedSet, onToggleSeries, sprintWeeks }: {
  labels: string[];
  dataSeries: Array<{num:number;name:string;series:number[]}>;
  palette: string[];
  yLabel: string;
  selectedSet?: Set<number> | null;
  onToggleSeries?: (num: number) => void;
  sprintWeeks?: boolean[];
}) {
  // Extend with an initial zero point before the first race
  const extLabels = ['Start', ...labels];
  const seriesExt = dataSeries.map(s => ({
    ...s,
    series: [0, ...s.series]
  }));
  // Chart geometry
  const width = Math.max(720, extLabels.length * 52);
  const height = 300;
  const padding = { left: 48, right: 44, top: 10, bottom: 40 };
  const visible = selectedSet ? seriesExt.filter(s => selectedSet.has(s.num)) : seriesExt;
  const eff = (visible && visible.length > 0) ? visible : seriesExt;
  const maxY = Math.max(...eff.flatMap(s => s.series));
  const minY = Math.min(0, ...eff.flatMap(s => s.series));
  const xStep = (width - padding.left - padding.right) / Math.max(1, extLabels.length - 1);
  const scaleX = (i: number) => padding.left + i * xStep;
  const scaleY = (v: number) => padding.top + (height - padding.top - padding.bottom) * (1 - (v - minY) / Math.max(1, maxY - minY));
  // y ticks and ghost lines
  const range = Math.max(1, maxY - minY);
  const roughStep = range / 6;
  const step = Math.max(5, Math.round(roughStep / 10) * 10);
  const ticks: number[] = [];
  const startT = Math.ceil(minY / step) * step;
  for (let v = startT; v <= maxY; v += step) ticks.push(v);
  // label stride and rotation to reduce collisions
  const labelStride = xStep < 40 ? (xStep < 28 ? 3 : 2) : 1;
  const short = (l: string) => l.replace(/ Grand Prix$/,'');
  // hover tooltip
  const [hover, setHover] = useState<{i: number} | null>(null);

  return (
    <div className="overflow-x-auto relative">
      <div className="chart-wrapper p-1">
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="auto" preserveAspectRatio="xMidYMid meet" className="block"
          onMouseMove={(e) => {
            const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
            const x = e.clientX - rect.left;
            const i = Math.max(0, Math.min(extLabels.length - 1, Math.round((x - padding.left) / xStep)));
            setHover({ i });
          }}
          onMouseLeave={() => setHover(null)}
        >
        {/* X-axis labels (rotated) */}
        {extLabels.map((l, i) => (
          i % labelStride === 0 ? (
            <g key={i} transform={`translate(${scaleX(i)}, ${height - 8}) rotate(-35)`}>
              <text fontSize={10} fill="#999" textAnchor="end">{i===0 ? '' : short(l)}</text>
            </g>
          ) : null
        ))}
        {/* Y-axis label */}
        <text x={6} y={14} fontSize={10} fill="#999">{yLabel}</text>
        {/* horizontal grid + y ticks */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padding.left} x2={width - padding.right} y1={scaleY(t)} y2={scaleY(t)} stroke="#666" strokeOpacity={0.18} />
            <text x={padding.left - 8} y={scaleY(t) - 2} fontSize={10} fill="#888" textAnchor="end">{t}</text>
          </g>
        ))}
        {/* vertical guides per race (darker); lighter for sprint weeks */}
        {extLabels.map((_, i) => (i>0 ? (
          <line key={`v-${i}`} x1={scaleX(i)} x2={scaleX(i)} y1={padding.top} y2={height - padding.bottom}
            stroke="#555" strokeOpacity={sprintWeeks && sprintWeeks[i-1] ? 1 : 0.3} />
        ) : null))}
        {/* Lines */}
        {seriesExt.map((s, idx) => {
          const color = palette[idx % palette.length];
          const d = s.series.map((v, i) => `${i===0?'M':'L'} ${scaleX(i)} ${scaleY(v)}`).join(' ');
          const selected = selectedSet ? selectedSet.has(s.num) : true;
          const dash = idx % 3 === 1 ? '4 3' : (idx % 3 === 2 ? '2 3' : undefined);
          return <path key={s.num} d={d} fill="none" stroke={selected ? color : '#555'} strokeOpacity={selected ? 1 : 0.25} strokeWidth={2} strokeDasharray={dash} />
        })}
        {/* hover crosshair */}
        {hover && (
          <line x1={scaleX(hover.i)} x2={scaleX(hover.i)} y1={padding.top} y2={height - padding.bottom} stroke="#999" strokeDasharray="3 3" />
        )}
      </svg>
      </div>
      {hover && hover.i>0 && (
        <div className="absolute top-2 left-2 card px-3 py-2 text-xs max-w-sm">
          <div className="font-medium mb-1">{extLabels[hover.i]}</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {seriesExt.slice(0, 10).map((s, idx) => {
              const selected = selectedSet ? selectedSet.has(s.num) : true;
              return (
                <div key={s.num} className="flex items-center gap-2 min-w-0 opacity-100">
                  <span className="inline-block w-2.5 h-2.5 rounded" style={{ background: selected ? palette[idx % palette.length] : '#555', opacity: selected ? 1 : 0.4 }} />
                  <span className="truncate">#{s.num} {s.name}</span>
                  <span className="tabular-nums ml-auto">{s.series[hover.i]}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* Inline selectable legend */}
      <div className="mt-2 flex flex-wrap gap-2">
        {seriesExt.map((s, idx) => {
          const active = selectedSet ? selectedSet.has(s.num) : true;
          const color = palette[idx % palette.length];
          return (
            <button key={s.num} type="button" onClick={() => onToggleSeries && onToggleSeries(s.num)}
              className={`px-2 py-1 rounded border text-sm ${active ? 'border-border/60' : 'border-transparent opacity-50'}`}
              title={`Toggle #${s.num} ${s.name}`}>
              <span className="inline-block w-3 h-3 rounded mr-2 align-middle" style={{ background: active ? color : '#555' }} />
              <span>#{s.num} {s.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DeltaLeader({ labels, allSeries, topSeries, palette, sprintWeeks }: { labels: string[]; allSeries: Array<{num:number;name:string;series:number[]}>; topSeries: Array<{num:number;name:string;series:number[]}>; palette: string[]; sprintWeeks?: boolean[] }) {
  // Compute deltas to the leader per round (dynamic leader)
  const leaderPerRound = labels.map((_, i) => Math.max(...allSeries.map(s => s.series[i] ?? -Infinity)));
  const deltasBase = topSeries.map((s) => ({
    ...s,
    deltas: s.series.map((v, i) => v - leaderPerRound[i]),
  }));
  // extend with zero at start
  const deltas = deltasBase.map(s => ({ ...s, deltas: [0, ...s.deltas] }));
  const extLabels = ['Start', ...labels];
  const width = Math.max(720, extLabels.length * 52);
  const height = 280;
  const padding = { left: 48, right: 44, top: 10, bottom: 40 };
  const minY = Math.min(0, ...deltas.flatMap(s => s.deltas));
  const maxY = 0;
  const xStep = (width - padding.left - padding.right) / Math.max(1, extLabels.length - 1);
  const scaleX = (i: number) => padding.left + i * xStep;
  const scaleY = (v: number) => padding.top + (height - padding.top - padding.bottom) * (1 - (v - minY) / Math.max(1, maxY - minY));
  // y ticks and grid
  const range = Math.abs(minY);
  const roughStep = range / 5;
  const step = Math.max(5, Math.round(roughStep / 10) * 10);
  const ticks: number[] = [];
  for (let v = 0; v >= minY; v -= step) ticks.push(v);
  // hover tooltip
  const [hover, setHover] = useState<{i: number} | null>(null);

  return (
    <div className="chart-wrapper p-1">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="auto" preserveAspectRatio="xMidYMid meet" className="block"
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
          const x = e.clientX - rect.left;
          const i = Math.max(0, Math.min(extLabels.length - 1, Math.round((x - padding.left) / xStep)));
          setHover({ i });
        }}
        onMouseLeave={() => setHover(null)}
      >
        {/* X-axis labels */}
        {extLabels.map((l, i) => (
        <g key={i} transform={`translate(${scaleX(i)}, ${height - 8}) rotate(-35)`}>
          <text fontSize={10} fill="#999" textAnchor="end">{i===0 ? '' : l.replace(/ Grand Prix$/,'')}</text>
        </g>
      ))}
      {/* Zero line */}
      <line x1={padding.left} x2={width - padding.right} y1={scaleY(0)} y2={scaleY(0)} stroke="#666" strokeDasharray="4 3" />
      {/* horizontal grid + y ticks */}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padding.left} x2={width - padding.right} y1={scaleY(t)} y2={scaleY(t)} stroke="#666" strokeOpacity={0.2} />
          <text x={padding.left - 6} y={scaleY(t) - 2} fontSize={10} fill="#888" textAnchor="end">{t}</text>
        </g>
      ))}
      {/* vertical guides per race (darker); lighter for sprint weeks */}
      {extLabels.map((_, i) => (i>0 ? (
        <line key={`v-${i}`} x1={scaleX(i)} x2={scaleX(i)} y1={padding.top} y2={height - padding.bottom}
          stroke="#777" strokeOpacity={sprintWeeks && sprintWeeks[i-1] ? 0.22 : 0.32} />
      ) : null))}
      {/* Lines */}
      {deltas.map((s, idx) => {
        const color = palette[idx % palette.length];
        const d = s.deltas.map((v, i) => `${i===0?'M':'L'} ${scaleX(i)} ${scaleY(v)}`).join(' ');
        const dash = idx % 3 === 1 ? '4 3' : (idx % 3 === 2 ? '2 3' : undefined);
        return <path key={s.num} d={d} fill="none" stroke={color} strokeWidth={2} strokeDasharray={dash} />
      })}
      {/* hover crosshair */}
      {hover && (
        <line x1={scaleX(hover.i)} x2={scaleX(hover.i)} y1={padding.top} y2={height - padding.bottom} stroke="#999" strokeDasharray="3 3" />
      )}
    </svg>
    </div>
  );
}

function BattleThree({ labels, battleSeries, palette, sprintWeeks }: { labels: string[]; battleSeries: Array<{num:number;name:string;series:number[]}>; palette: string[]; sprintWeeks?: boolean[] }) {
  // Centerline = average of the 3 drivers per round; plot each relative to average
  const avg = labels.map((_, i) => (battleSeries.reduce((a, s) => a + s.series[i], 0) / battleSeries.length));
  const relBase = battleSeries.map(s => ({ ...s, rel: s.series.map((v,i) => v - avg[i]) }));
  const rel = relBase.map(s => ({ ...s, rel: [0, ...s.rel] }));
  const extLabels = ['Start', ...labels];
  const width = Math.max(720, extLabels.length * 52);
  const height = 280;
  const padding = { left: 48, right: 44, top: 10, bottom: 40 };
  const minY = Math.min(...rel.flatMap(s => s.rel), 0);
  const maxY = Math.max(...rel.flatMap(s => s.rel), 0);
  const xStep = (width - padding.left - padding.right) / Math.max(1, extLabels.length - 1);
  const scaleX = (i: number) => padding.left + i * xStep;
  const scaleY = (v: number) => padding.top + (height - padding.top - padding.bottom) * (1 - (v - minY) / Math.max(1, maxY - minY));
  // y ticks and grid
  const range = Math.max(Math.abs(minY), Math.abs(maxY));
  const roughStep = range / 5;
  const step = Math.max(5, Math.round(roughStep / 10) * 10);
  const ticks: number[] = [];
  for (let v = 0; v <= range; v += step) ticks.push(v, -v);
  const uniqTicks = Array.from(new Set(ticks)).sort((a,b) => a-b);
  // hover tooltip
  const [hover, setHover] = useState<{i: number} | null>(null);
  
  return (
    <div className="chart-wrapper p-1">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="auto" preserveAspectRatio="xMidYMid meet" className="block"
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
          const x = e.clientX - rect.left;
          const i = Math.max(0, Math.min(extLabels.length - 1, Math.round((x - padding.left) / xStep)));
          setHover({ i });
        }}
        onMouseLeave={() => setHover(null)}
      >
        {/* X-axis labels */}
        {extLabels.map((l, i) => (
        <g key={i} transform={`translate(${scaleX(i)}, ${height - 8}) rotate(-35)`}>
          <text fontSize={10} fill="#999" textAnchor="end">{i===0 ? '' : l.replace(/ Grand Prix$/,'')}</text>
        </g>
      ))}
      {/* Zero (average) line */}
      <line x1={padding.left} x2={width - padding.right} y1={scaleY(0)} y2={scaleY(0)} stroke="#666" strokeDasharray="4 3" />
      {/* horizontal grid + y ticks */}
      {uniqTicks.map((t) => (
        <g key={t}>
          <line x1={padding.left} x2={width - padding.right} y1={scaleY(t)} y2={scaleY(t)} stroke="#666" strokeOpacity={0.2} />
          <text x={padding.left - 6} y={scaleY(t) - 2} fontSize={10} fill="#888" textAnchor="end">{t}</text>
        </g>
      ))}
      {/* vertical guides per race (darker); lighter for sprint weeks */}
      {extLabels.map((_, i) => (i>0 ? (
        <line key={`v-${i}`} x1={scaleX(i)} x2={scaleX(i)} y1={padding.top} y2={height - padding.bottom}
          stroke="#777" strokeOpacity={sprintWeeks && sprintWeeks[i-1] ? 0.22 : 0.32} />
      ) : null))}
      {/* Lines */}
      {rel.map((s, idx) => {
        const color = palette[idx % palette.length];
        const d = s.rel.map((v, i) => `${i===0?'M':'L'} ${scaleX(i)} ${scaleY(v)}`).join(' ');
        const dash = idx % 3 === 1 ? '4 3' : (idx % 3 === 2 ? '2 3' : undefined);
        return <path key={s.num} d={d} fill="none" stroke={color} strokeWidth={2} strokeDasharray={dash} />
      })}
      {/* hover crosshair */}
      {hover && (
        <line x1={scaleX(hover.i)} x2={scaleX(hover.i)} y1={padding.top} y2={height - padding.bottom} stroke="#999" strokeDasharray="3 3" />
      )}
    </svg>
    </div>
  );
}

