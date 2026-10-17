// Request and response shapes shared by the API routes and the dashboard.
import type { FactorReason } from "./factors";
import type { Group, Level, PmReason } from "./risk";
import type { ActivityInfo, SessionPlan } from "./session";
import type { History, Person, VeResult } from "./ve";

export type Place = { name: string; lat: number; lon: number; address?: string };

export type PlanInputs = {
  plan: SessionPlan;
  person: Person;
  history: History;
  group: Group;
  indoorRatio: number;
};

export type AssessRequest = PlanInputs & {
  place: Place;
  start: string; // "YYYY-MM-DDTHH:mm", local time at the place
};

export type Factors = {
  apparentTempC: number | null;
  uvIndex: number | null;
  precipProbPct: number | null;
  thunderstorm: boolean;
  level: Level;
  reasons: FactorReason[];
};

export type RunResult = {
  start: number;
  end: number;
  ve: VeResult;
  veUsed: number;
  runPmMean: number;
  runPmMaxHour: number;
  dayPmMean: number;
  runUg: number;
  restUg: number;
  vDayM3: number;
  cEq: number;
  hq: number;
  runShareOfDay: number;
  pmLevel: Level;
  pmReasons: PmReason[];
  factors: Factors;
  level: Level;
  notes: string[];
};

export type StartOption = {
  start: number;
  runUg: number;
  cEq: number;
  runPmMean: number;
  pmLevel: Level;
  factorsLevel: Level;
  level: Level;
  apparentTempC: number | null;
  uvIndex: number | null;
  precipProbPct: number | null;
};

export type OptionRow = {
  key: string;
  label: string;
  kind: "planned" | "skip" | "shorter" | "slower" | "easier" | "best-start";
  plan: SessionPlan | null;
  start: number;
  minutes: number;
  veLmin: number | null;
  runPmMean: number | null;
  runUg: number;
  vsPlannedUg: number;
  cEq: number;
  pmLevel: Level;
  factorsLevel: Level | null;
  level: Level;
};

export type TimelineHour = {
  t: number;
  pm25: number | null;
  aqiUs: number | null;
  tempC: number | null;
  apparentTempC: number | null;
  uvIndex: number | null;
  precipProbPct: number | null;
  humidityPct: number | null;
  windMs: number | null;
  weatherCode: number | null;
  isDay: boolean | null;
};

// the forecast part of a response, which is all there is when the activity isn't in the database
export type Conditions = {
  place: Place;
  timezone: string;
  fetchedAt: number;
  aqGrid: [number, number];
  weatherGrid: [number, number];
  pmHorizon: number;
  group: Group;
  indoorRatio: number;
  timeline: TimelineHour[];
};

export type AssessResponse = Conditions & {
  found: true;
  plan: SessionPlan;
  activity: ActivityInfo | null; // null for a run
  planned: RunResult;
  band: { p10: { runUg: number; cEq: number }; p90: { runUg: number; cEq: number } };
  skip: { cEq: number; level: Level; ug: number }; // ug: the whole day breathed at the ordinary rate
  byStart: StartOption[];
  options: OptionRow[];
};

// the activity matched nothing in hazewise.db: the forecast still shows, with the planned window marked
export type NotFoundResponse = Conditions & { found: false; query: string; start: number; end: number };

export type AssessResult = AssessResponse | NotFoundResponse;

export type Venue = {
  name: string;
  type: "ActiveSG / SportSG" | "NParks";
  detail: string;
  lat: number;
  lon: number;
  distanceKm: number;
  isIndoor: boolean;
  level: Level | null;
  pmLevel: Level | null;
  factorsLevel: Level | null;
  cEq: number | null;
};

export type VenuesRequest = PlanInputs & { lat: number; lon: number; start: number; preferIndoor: boolean };
export type VenuesResponse = { venues: Venue[]; preferIndoor: boolean };
