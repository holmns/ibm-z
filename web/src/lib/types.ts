// Request and response shapes shared by the API routes and the dashboard.
import type { FactorParts, FactorReason } from "./factors";
import type { Group, Level, PmReason } from "./risk";
import type { ActivityInfo, SessionPlan } from "./session";
import type { History, Person, VeResult } from "./ve";

export type Place = { name: string; lat: number; lon: number; address?: string };

export type PlanInputs = {
  plan: SessionPlan;
  person: Person;
  history: History;
  group: Group;
  outdoorHours: number; // hours in outdoor air besides the session, 0 to 24
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
  parts: FactorParts;
  combo: boolean;
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
  parts: FactorParts;
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
  parts: FactorParts | null;
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
  // google: Google's Air Quality API, which starts from station readings; cams: the CAMS model, which reads low in haze
  pmSource: "google" | "cams";
  pmNow: { t: number; pm25: number } | null; // Google's reading for the current hour
  psi: Psi | null; // NEA's 24-hour PSI for the nearest region
  group: Group;
  outdoorHours: number;
  timeline: TimelineHour[];
};

export type Psi = { value: number; region: string; t: number };

export type AssessResponse = Conditions & {
  found: true;
  plan: SessionPlan;
  activity: ActivityInfo | null; // null for a run
  planned: RunResult;
  band: { p10: { runUg: number; cEq: number }; p90: { runUg: number; cEq: number } };
  // ug: the whole day breathed at the ordinary rate; ugInRunSlot: the part of that falling in the session's minutes
  skip: { cEq: number; level: Level; ug: number; ugInRunSlot: number };
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

// what the summary under the risk title may draw on: the dashboard's own figures, already formatted
export type SummaryFacts = {
  level: Level;
  raisedBy: string[];
  activity: "run" | "session";
  plan: string;
  place: string;
  when: string;
  thresholds: Group;
  air: {
    level: Level; dayPm25: string; lowBelow: string; highFrom: string; sessionAvgPm25: string; neaRating: string;
  };
  heat: { level: Level; feelsLike: string | null };
  uv: { level: Level; index: string | null };
  rain: { level: Level; chanceOfRain: string | null; thunderstormForecast: boolean };
  dose: { duringSession: string; addedToDay: string };
  suggestion: string;
  forecastCaveat: string | null; // the haze warning, when the card shows one
};

export type VenuesRequest = PlanInputs & { lat: number; lon: number; start: number; preferIndoor: boolean };
export type VenuesResponse = { venues: Venue[]; preferIndoor: boolean };
