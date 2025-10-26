export type DriverNum = number;

export type EventInfo = {
  round: number;
  raceName: string;
  status: "completed" | "upcoming" | string;
  dateTimeUTC?: string;
  hasSprint?: boolean;
  sprintDateTimeUTC?: string;
};

export type AppData = {
  year: number;
  driverNames: Record<DriverNum, string>;
  currentPoints: Record<DriverNum, number>;
  drivers: DriverNum[];
  allRaces: EventInfo[];
  allSprints: EventInfo[];
};

export type ScenarioPosition = { type: "position"; driver1: DriverNum; value: string /* position 1..20 */ };
export type ScenarioAbove = { type: "above"; driver1: DriverNum; value: string /* other driver */ };
export type Scenario = ScenarioPosition | ScenarioAbove;

export type SimulationType = "standard" | "realistic" | "recent-form";

export type ResultItem = { driver: DriverNum; percentage: number; avgPoints?: number };
