// PM2.5 intake risk: assess-risk.ipynb §3-§4. Dose over the run and the rest of the day, scored as a
// day-equivalent concentration against WHO 24-hour tiers, with an NEA 1-hour override.
import { interp, mean, roundHalfEven } from "./num";
import { startOfLocalDay } from "./time";

export type Level = "Low" | "Medium" | "High";
export type Group = "general" | "vulnerable";
export const LEVEL_RANK: Record<Level, number> = { Low: 0, Medium: 1, High: 2 };
export const worst = (...levels: Level[]) => levels.reduce((a, b) => (LEVEL_RANK[b] > LEVEL_RANK[a] ? b : a), "Low");

// (age upper bound, m3/day); EPA EFH Table 6-1
const V_DAY_TABLE: [number, number][] = [[1, 5.4], [2, 8.0], [3, 8.9], [6, 10.1], [11, 12.0], [16, 15.2], [21, 16.3],
  [31, 15.7], [41, 16.0], [51, 16.0], [61, 15.7], [71, 14.2], [81, 12.9], [Infinity, 12.2]];
export const WHO_24H: [number, string][] = [[15, "WHO guideline"], [25, "WHO IT-4"], [37.5, "WHO IT-3"], [50, "WHO IT-2"],
  [75, "WHO IT-1"]];
export const NEA_BANDS: [number, string][] = [[55, "Band I Normal"], [150, "Band II Elevated"], [250, "Band III High"],
  [Infinity, "Band IV Very High"]];
export const LEVELS: Record<Group, [number, Level][]> = {
  general: [[37.5, "Low"], [75, "Medium"], [Infinity, "High"]],
  vulnerable: [[25, "Low"], [50, "Medium"], [Infinity, "High"]],
};
export const NEA_HIGH = 150; // above this, the hour is Band III or worse
export const WHO_GUIDELINE = 15;

export function vDay(age: number) {
  return V_DAY_TABLE.find(([top]) => age < top)![1];
}

export function neaBand(pm: number) {
  return NEA_BANDS.find(([top]) => pm <= top)![1];
}

// the highest WHO 24-hour level c is above, or null when within the guideline
export function whoTier(c: number): { name: string; value: number } | null {
  const over = WHO_24H.filter(([top]) => c > top);
  if (!over.length) return null;
  const [value, name] = over[over.length - 1];
  return { name, value };
}

export type PmReason =
  | { kind: "day-equivalent"; cEq: number; tier: { name: string; value: number } | null }
  | { kind: "nea-hour"; pm: number; band: string };

export function riskLevel(cEq: number, maxHourPm: number, group: Group): { level: Level; reasons: PmReason[] } {
  let level = LEVELS[group].find(([top]) => cEq < top)![1];
  const reasons: PmReason[] = [{ kind: "day-equivalent", cEq, tier: whoTier(cEq) }];
  if (maxHourPm > NEA_HIGH) {
    level = "High";
    reasons.push({ kind: "nea-hour", pm: maxHourPm, band: neaBand(maxHourPm) });
  }
  return { level, reasons };
}

// hourly PM2.5 forecast, NaN-free, increasing times (unix s)
export type PmSeries = { t: number[]; v: number[] };

export type PmAssessment = {
  start: number;
  minutes: number;
  veLmin: number;
  runPmMean: number;
  runPmMaxHour: number;
  dayPmMean: number;
  runUg: number;
  restUg: number;
  vDayM3: number;
  cEq: number;
  hq: number;
  runShareOfDay: number;
  level: Level;
  reasons: PmReason[];
  notes: string[];
};

// first and last forecast hour the run's minutes are interpolated between (pandas floor("h") / ceil("h"))
export function runHourSpan(pm: PmSeries, start: number, lastMinute: number): [number, number] {
  const t0 = pm.t[0];
  return [t0 + Math.floor((start - t0) / 3600) * 3600, t0 + Math.ceil((lastMinute - t0) / 3600) * 3600];
}

export function assess(pm: PmSeries, start: number, minutes: number, veLmin: number, age: number, tz: string,
  group: Group = "general", indoorRatio = 1.0): PmAssessment {
  const n = Math.max(1, roundHalfEven(minutes));
  const runT = Array.from({ length: n }, (_, i) => start + 60 * i);
  const day0 = startOfLocalDay(start, tz);
  const vd = vDay(age);

  let runUg = 0;
  for (const t of runT) runUg += (interp(t, pm.t, pm.v) * veLmin) / 1000;

  // the day's other minutes; run minutes sit on the same minute grid as the day's, so a range check finds them
  let rest = 0;
  const dayPm: number[] = [];
  for (let i = 0; i < 1440; i++) {
    const t = day0 + 60 * i;
    const p = interp(t, pm.t, pm.v);
    dayPm.push(p);
    const inRun = t >= start && t < start + 60 * n && (t - start) % 60 === 0;
    if (!inRun) rest += (p * vd) / 1440;
  }
  const restUg = indoorRatio * rest;
  const cEq = (runUg + restUg) / vd;

  const [h0, h1] = runHourSpan(pm, start, runT[n - 1]);
  let maxHour = -Infinity;
  pm.t.forEach((t, i) => {
    if (t >= h0 && t <= h1) maxHour = Math.max(maxHour, pm.v[i]);
  });
  const { level, reasons } = riskLevel(cEq, maxHour, group);
  const notes: string[] = [];
  if (day0 < pm.t[0] || day0 + 60 * 1439 > pm.t[pm.t.length - 1] + 3600) {
    notes.push("part of the day is outside the forecast; its edge hour fills the gap");
  }
  return {
    start, minutes, veLmin, runPmMean: (runUg * 1000) / veLmin / n, runPmMaxHour: maxHour, dayPmMean: mean(dayPm),
    runUg, restUg, vDayM3: vd, cEq, hq: cEq / WHO_GUIDELINE, runShareOfDay: runUg / (runUg + restUg), level, reasons,
    notes,
  };
}
