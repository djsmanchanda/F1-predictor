/**
 * Path to Victory Calculator
 *
 * Provides realistic requirements for a driver to win the championship.
 * Unlike simplistic approaches that assume rivals give up, this calculator
 * accounts for competitive rivals who will also fight for wins and points.
 *
 * The logic evolves from the legacy site implementation but tightens up the
 * maths, especially around tie-breakers and rival win potential.
 */

import type { DriverNum, AppData, EventInfo } from "../types";

const RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1, ...Array(10).fill(0)];
const SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1, ...Array(12).fill(0)];

export type PathToVictoryResult = {
  driver: DriverNum;
  driverName: string;
  isPossible: boolean;
  currentPosition: number;
  currentPoints: number;
  maxPossible: number;
  reason?: string;
  scenario?: ScenarioSummary;
};

type ScenarioSummary = {
  label: string;
  difficulty: DifficultyRating;
  driverNeeds: string[];
  rivalConstraints: RivalConstraint[];
};

export type RivalConstraint = {
  driver: DriverNum;
  driverName: string;
  currentPoints: number;
  gap: number;
  severity: "easy" | "moderate" | "hard" | "very_hard" | "elimination";
  strategy: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  conditions: string[];
  requiredFinishes: Array<{ type: string; count: number; description: string }>;
  pointsToDrop: number;
  maxPointsAllowed: number;
};

export type DifficultyRating = {
  class: string;
  icon: string;
  text: string;
};

type ScenarioCandidate = {
  wins: number;
  sprintWins: number;
  totalPoints: number;
  finalWins: number;
  driverNeeds: string[];
  rivalConstraints: RivalConstraint[];
  difficulty: DifficultyRating;
};

/**
 * Primary calculator entry point.
 */
export function calculatePathToVictory(
  targetDriver: DriverNum,
  data: AppData,
  remainingRaces: Array<EventInfo | { round: number }>,
  remainingSprints: Array<EventInfo | { round: number }>,
  winsData: Record<DriverNum, number>,
  _podiumData: Record<DriverNum, number[]>
): PathToVictoryResult {
  const driverName = data.driverNames[targetDriver] || `Driver #${targetDriver}`;

  const sortedDrivers = Object.entries(data.currentPoints)
    .map(([k, v]) => [parseInt(k, 10), v] as [number, number])
    .sort((a, b) => b[1] - a[1]);

  const targetCurrentPoints = data.currentPoints[targetDriver] ?? 0;
  const targetPosition = sortedDrivers.findIndex(([d]) => d === targetDriver) + 1;

  const racesRemaining = remainingRaces.length;
  const sprintsRemaining = remainingSprints.length;
  const maxRacePoints = racesRemaining * 25;
  const maxSprintPoints = sprintsRemaining * 8;
  const maxPossiblePoints = targetCurrentPoints + maxRacePoints + maxSprintPoints;

  const leaderPoints = sortedDrivers[0]?.[1] ?? 0;
  if (maxPossiblePoints < leaderPoints) {
    return {
      driver: targetDriver,
      driverName,
      isPossible: false,
      currentPosition: targetPosition,
      currentPoints: targetCurrentPoints,
      maxPossible: maxPossiblePoints,
      reason: `Needs ${leaderPoints - maxPossiblePoints} more points than mathematically available.`,
    };
  }

  const contenders = identifyContenders(sortedDrivers, racesRemaining, sprintsRemaining);
  const currentWins = winsData[targetDriver] ?? 0;

  const scenarios = buildScenarioCandidates({
    targetDriver,
    targetCurrentPoints,
    currentWins,
    racesRemaining,
    sprintsRemaining,
    contenders,
    winsData,
    data,
  });

  const viableScenario = pickViableScenario(scenarios);

  if (!viableScenario) {
    return {
      driver: targetDriver,
      driverName,
      isPossible: false,
      currentPosition: targetPosition,
      currentPoints: targetCurrentPoints,
      maxPossible: maxPossiblePoints,
      reason: "No realistic combination found. Needs help and perfect results from several rivals.",
    };
  }

  return {
    driver: targetDriver,
    driverName,
    isPossible: true,
    currentPosition: targetPosition,
    currentPoints: targetCurrentPoints,
    maxPossible: maxPossiblePoints,
    scenario: {
      label: buildScenarioLabel(viableScenario, racesRemaining, sprintsRemaining),
      difficulty: viableScenario.difficulty,
      driverNeeds: viableScenario.driverNeeds,
      rivalConstraints: viableScenario.rivalConstraints,
    },
  };
}

type ScenarioBuilderInput = {
  targetDriver: DriverNum;
  targetCurrentPoints: number;
  currentWins: number;
  racesRemaining: number;
  sprintsRemaining: number;
  contenders: Array<{ driver: DriverNum; points: number }>;
  winsData: Record<DriverNum, number>;
  data: AppData;
};

function buildScenarioCandidates(input: ScenarioBuilderInput): ScenarioCandidate[] {
  const {
    targetDriver,
    targetCurrentPoints,
    currentWins,
    racesRemaining,
    sprintsRemaining,
    contenders,
    winsData,
    data,
  } = input;

  const scenarios: ScenarioCandidate[] = [];

  const sprintPointsGain = sprintsRemaining * SPRINT_POINTS[0]; // assume sprint wins for strongest case
  const scenariosToTry = new Set<number>();

  // Try from "win them all" down to a modest number of wins.
  for (let wins = racesRemaining; wins >= Math.max(0, racesRemaining - 4); wins -= 1) {
    scenariosToTry.add(wins);
  }
  scenariosToTry.add(Math.ceil(racesRemaining / 2));
  scenariosToTry.add(Math.max(1, racesRemaining - 2));

  for (const wins of Array.from(scenariosToTry).sort((a, b) => b - a)) {
    if (wins < 0 || wins > racesRemaining) continue;

    const racesNotWon = racesRemaining - wins;
    const targetRacePoints = wins * RACE_POINTS[0] + racesNotWon * RACE_POINTS[1];
    const totalPoints = targetCurrentPoints + targetRacePoints + sprintPointsGain;
    const finalWins = currentWins + wins;

    const driverNeeds = buildDriverNeeds({ wins, racesNotWon, sprintsRemaining, totalPoints });

    const rivalConstraints: RivalConstraint[] = [];
    let valid = true;

    for (const contender of contenders) {
      if (contender.driver === targetDriver) continue;
      const constraint = analyseRival({
        targetDriver,
        rivalDriver: contender.driver,
        rivalPoints: contender.points,
        winsTarget: finalWins,
        winsTargetScenario: wins,
        racesRemaining,
        sprintsRemaining,
        totalPoints,
        winsData,
        data,
      });

      if (!constraint) {
        valid = false;
        break;
      }

      rivalConstraints.push(constraint);
    }

    if (!valid) continue;

    const difficulty = aggregateDifficulty(rivalConstraints);

    scenarios.push({
      wins,
      sprintWins: sprintsRemaining,
      totalPoints,
      finalWins,
      driverNeeds,
      rivalConstraints,
      difficulty,
    });
  }

  return scenarios.sort((a, b) => difficultyWeight(a.difficulty) - difficultyWeight(b.difficulty));
}

function pickViableScenario(scenarios: ScenarioCandidate[]): ScenarioCandidate | null {
  if (scenarios.length === 0) return null;

  // Prioritise the easiest difficulty, then fewer wins requirement.
  return scenarios.reduce((best, scenario) => {
    if (!best) return scenario;
    const diffCompare = difficultyWeight(scenario.difficulty) - difficultyWeight(best.difficulty);
    if (diffCompare < 0) return scenario;
    if (diffCompare > 0) return best;
    return scenario.wins < best.wins ? scenario : best;
  }, scenarios[0] as ScenarioCandidate | null);
}

function identifyContenders(
  sortedDrivers: Array<[DriverNum, number]>,
  racesRemaining: number,
  sprintsRemaining: number
) {
  const maxGain = racesRemaining * 25 + sprintsRemaining * 8;
  const threshold = sortedDrivers[0]?.[1] ?? 0;

  return sortedDrivers.filter(([_driver, pts]) => {
    const maxPossible = pts + maxGain;
    return maxPossible >= threshold - 5; // allow slight buffer; top drivers remain relevant
  }).map(([driver, points]) => ({ driver, points }));
}

type DriverNeedsInput = {
  wins: number;
  racesNotWon: number;
  sprintsRemaining: number;
  totalPoints: number;
};

function buildDriverNeeds({ wins, racesNotWon, sprintsRemaining, totalPoints }: DriverNeedsInput): string[] {
  const needs: string[] = [];

  if (wins > 0) {
    needs.push(`🏆 Win ${wins} remaining race${wins !== 1 ? "s" : ""}`);
  } else {
    needs.push("📈 No race wins required, but podium every time");
  }

  if (racesNotWon > 0) {
    needs.push(`🥈 Finish P2 in the other ${racesNotWon} race${racesNotWon !== 1 ? "s" : ""}`);
  }

  if (sprintsRemaining > 0) {
    needs.push(`⚡ Maximise sprint points (ideally ${sprintsRemaining} sprint win${sprintsRemaining !== 1 ? "s" : ""})`);
  }

  needs.push(`📊 Finish on ${totalPoints} points`);

  return needs;
}

type RivalAnalysisInput = {
  targetDriver: DriverNum;
  rivalDriver: DriverNum;
  rivalPoints: number;
  winsTarget: number;
  winsTargetScenario: number;
  racesRemaining: number;
  sprintsRemaining: number;
  totalPoints: number;
  winsData: Record<DriverNum, number>;
  data: AppData;
};

function analyseRival(input: RivalAnalysisInput): RivalConstraint | null {
  const {
    targetDriver,
    rivalDriver,
    rivalPoints,
    winsTarget,
    winsTargetScenario,
    racesRemaining,
    sprintsRemaining,
    totalPoints,
    winsData,
    data,
  } = input;

  const currentWinsRival = winsData[rivalDriver] ?? 0;
  const rivalCanWin = currentWinsRival + (racesRemaining - winsTargetScenario);
  const needsTieBreak = rivalCanWin >= winsTarget;

  const maxAllowed = needsTieBreak ? totalPoints - 1 : totalPoints;
  if (maxAllowed < rivalPoints) return null; // already ahead; scenario invalid

  const maxGain = racesRemaining * 25 + sprintsRemaining * 8;
  const rivalMaxTotal = rivalPoints + maxGain;
  const pointsToDrop = Math.max(0, rivalMaxTotal - maxAllowed);

  const { severity, strategy, riskLevel, conditions, requiredFinishes } = describeDrop(
    pointsToDrop,
    racesRemaining,
    sprintsRemaining
  );

  return {
    driver: rivalDriver,
    driverName: data.driverNames[rivalDriver] || `Driver #${rivalDriver}`,
    currentPoints: rivalPoints,
    gap: rivalPoints - (data.currentPoints[targetDriver] ?? 0),
    severity,
    strategy,
    riskLevel,
    conditions,
    requiredFinishes,
    pointsToDrop,
    maxPointsAllowed: maxAllowed,
  };
}

type DropDescription = {
  severity: RivalConstraint["severity"];
  strategy: string;
  riskLevel: RivalConstraint["riskLevel"];
  conditions: string[];
  requiredFinishes: RivalConstraint["requiredFinishes"];
};

function describeDrop(pointsToDrop: number, races: number, sprints: number): DropDescription {
  if (pointsToDrop <= 0) {
    return {
      severity: "easy",
      strategy: "Target wins even if rival is strong",
      riskLevel: "low",
      conditions: ["No special limitation on this rival"],
      requiredFinishes: [],
    };
  }

  const events = races + sprints;
  const avgDrop = pointsToDrop / Math.max(1, events);
  const requiredFinishes: RivalConstraint["requiredFinishes"] = [];
  const conditions: string[] = [];

  if (pointsToDrop >= races * 25 + sprints * 8) {
    conditions.push("❌ Must score 0 points (multiple DNFs / penalties)");
    requiredFinishes.push({ type: "elimination", count: events, description: "DNF/DSQ in every event" });
    return {
      severity: "elimination",
      strategy: "Needs rival to fail completely",
      riskLevel: "critical",
      conditions,
      requiredFinishes,
    };
  }

  if (avgDrop >= 20) {
    const outsideTop10 = Math.min(races, Math.ceil(pointsToDrop / 10));
    conditions.push(`🚫 Outside top 10 in at least ${outsideTop10} race${outsideTop10 !== 1 ? "s" : ""}`);
    requiredFinishes.push({
      type: "outside_top10",
      count: outsideTop10,
      description: `Finish P11 or worse ${outsideTop10} time${outsideTop10 !== 1 ? "s" : ""}`,
    });
    return {
      severity: "very_hard",
      strategy: "Force rival out of the points",
      riskLevel: "high",
      conditions,
      requiredFinishes,
    };
  }

  if (avgDrop >= 15) {
    const maxPodiums = Math.max(0, races - Math.ceil(pointsToDrop / 15));
    conditions.push(`🥉 At most ${maxPodiums} podium${maxPodiums !== 1 ? "s" : ""}`);
    conditions.push(`🚫 Outside top 3 in ${Math.ceil(pointsToDrop / 15)} race${Math.ceil(pointsToDrop / 15) !== 1 ? "s" : ""}`);
    requiredFinishes.push({
      type: "no_podium",
      count: Math.ceil(pointsToDrop / 15),
      description: `Miss the podium ${Math.ceil(pointsToDrop / 15)} time${Math.ceil(pointsToDrop / 15) !== 1 ? "s" : ""}`,
    });
    return {
      severity: "hard",
      strategy: "Limit rival to occasional podiums",
      riskLevel: "high",
      conditions,
      requiredFinishes,
    };
  }

  if (avgDrop >= 10) {
    const maxWins = Math.max(0, races - Math.ceil(pointsToDrop / 10));
    conditions.push(`🏁 At most ${maxWins} race win${maxWins !== 1 ? "s" : ""}`);
    requiredFinishes.push({
      type: "limited_wins",
      count: Math.ceil(pointsToDrop / 10),
      description: `Finish P2 or worse ${Math.ceil(pointsToDrop / 10)} time${Math.ceil(pointsToDrop / 10) !== 1 ? "s" : ""}`,
    });
    return {
      severity: "moderate",
      strategy: "Keep rival off the top step",
      riskLevel: "medium",
      conditions,
      requiredFinishes,
    };
  }

  conditions.push(`📊 Average finish worse than P${Math.max(4, Math.round(avgDrop))}`);
  if (sprints > 0) {
    conditions.push("⚡ Limited sprint wins (P2+ finishes in sprints)");
  }
  return {
    severity: "easy",
    strategy: "Steady pressure is enough",
    riskLevel: "low",
    conditions,
    requiredFinishes,
  };
}

function aggregateDifficulty(rivals: RivalConstraint[]): DifficultyRating {
  const score = rivals.reduce((acc, rival) => acc + severityScore(rival.severity), 0) / Math.max(1, rivals.length);

  if (score >= 4.5) return { class: "impossible", icon: "🔴", text: "Almost impossible" };
  if (score >= 3.5) return { class: "very-hard", icon: "🔴", text: "Extremely difficult" };
  if (score >= 2.5) return { class: "hard", icon: "🟠", text: "Very difficult" };
  if (score >= 1.5) return { class: "moderate", icon: "🟡", text: "Challenging" };
  return { class: "easy", icon: "🟢", text: "Favourable" };
}

function severityScore(severity: RivalConstraint["severity"]): number {
  switch (severity) {
    case "elimination":
      return 5;
    case "very_hard":
      return 4;
    case "hard":
      return 3;
    case "moderate":
      return 2;
    default:
      return 1;
  }
}

function difficultyWeight(difficulty: DifficultyRating): number {
  switch (difficulty.class) {
    case "easy":
      return 1;
    case "moderate":
      return 2;
    case "hard":
      return 3;
    case "very-hard":
      return 4;
    default:
      return 5;
  }
}

function buildScenarioLabel(scenario: ScenarioCandidate, racesRemaining: number, sprintsRemaining: number): string {
  if (scenario.wins === racesRemaining && sprintsRemaining === scenario.sprintWins) {
    return "Win everything";
  }
  if (scenario.wins === racesRemaining) {
    return "Sweep the remaining races";
  }
  if (scenario.wins >= Math.ceil(racesRemaining * 0.7)) {
    return "Dominate the run-in";
  }
  if (scenario.wins >= Math.ceil(racesRemaining * 0.5)) {
    return "Outperform and pressure rivals";
  }
  return "Thread the needle";
}

/**
 * Win/podium estimation derived from raw standings output.
 */
export function calculateDriverStats(rawStandings: any[]): {
  wins: Record<DriverNum, number>;
  podiums: Record<DriverNum, number[]>;
} {
  const wins: Record<DriverNum, number> = {};
  const podiums: Record<DriverNum, number[]> = {};

  for (const row of rawStandings || []) {
    const driverNum = parseInt(row?.["Driver Number"] ?? "", 10) || 0;
    if (!driverNum) continue;
    wins[driverNum] = 0;
    podiums[driverNum] = Array(20).fill(0);

    const keys = Object.keys(row || {}).filter(
      (k) => !["Driver Number", "Driver Name", "Final Points"].includes(k)
    );

    const cumulatives = keys.map((k) => Number(row?.[k] ?? 0));
    let prev = 0;
    for (const value of cumulatives) {
      const gained = Math.max(0, value - prev);
      prev = value;
      if (gained === 25) {
        wins[driverNum] += 1;
        podiums[driverNum][0] += 1;
      } else if (gained === 18) {
        podiums[driverNum][1] += 1;
      } else if (gained === 15) {
        podiums[driverNum][2] += 1;
      }
    }
  }

  return { wins, podiums };
}
