// The planned run and its alternatives: assess-risk.ipynb §6-§7, with detect.ipynb's heat, UV and rain rules
// scored alongside. Overall level = the worse of the PM2.5 level and the heat/UV/rain level.
import "server-only";
import { factorRisk } from "./factors";
import { fmtShort, roundHalfEven } from "./num";
import { conditionsTimeline, type Hour, type Timeline } from "./openmeteo";
import { assess, LEVEL_RANK, riskLevel, runHourSpan, worst, type PmSeries } from "./risk";
import { fmtDayTime, localDateKey, pad, parseLocal, wallParts } from "./time";
import type { AssessRequest, AssessResponse, Factors, OptionRow, PlanInputs, RunResult, StartOption } from "./types";
import { isDuration, toMinutes } from "./duration";
import { estimateVe, type Plan } from "./ve";

export class InputError extends Error {}

const NOW_WINDOW = 30 * 60;
const FIRST_START_HOUR = 5;
const LAST_START_HOUR = 21;

type Context = { tl: Timeline; pm: PmSeries; tz: string; byT: Map<number, Hour> };

function context(tl: Timeline): Context {
  const withPm = tl.hours.filter((h) => h.pm25 !== null);
  if (withPm.length < 2) throw new InputError("No PM2.5 forecast is available for this place.");
  return {
    tl, tz: tl.timezone, byT: new Map(tl.hours.map((h) => [h.t, h])),
    pm: { t: withPm.map((h) => h.t), v: withPm.map((h) => h.pm25 as number) },
  };
}

function factorsOver(ctx: Context, h0: number, h1: number): Factors {
  const hours = ctx.tl.hours.filter((h) => h.t >= h0 && h.t <= h1);
  const max = (k: "apparentTempC" | "uvIndex" | "precipProbPct") => {
    const xs = hours.map((h) => h[k]).filter((v): v is number => v !== null);
    return xs.length ? Math.max(...xs) : null;
  };
  const values = {
    apparentTempC: max("apparentTempC"), uvIndex: max("uvIndex"), precipProbPct: max("precipProbPct"),
    thunderstorm: hours.some((h) => h.weatherCode !== null && [95, 96, 99].includes(h.weatherCode)),
  };
  return { ...values, ...factorRisk(values) };
}

function pmLast(ctx: Context) {
  return ctx.pm.t[ctx.pm.t.length - 1];
}

function runRisk(ctx: Context, inputs: PlanInputs, plan: Plan, start: number): RunResult {
  const v = estimateVe(plan, inputs.person, inputs.history);
  const ve = inputs.group === "vulnerable" ? v.veP90 : v.veLmin;
  const end = start + v.minutes * 60;
  if (end > pmLast(ctx) + 3600) {
    throw new InputError(`The run ends ${fmtDayTime(end, ctx.tz)}, after the PM2.5 forecast ends at ` +
      `${fmtDayTime(pmLast(ctx), ctx.tz)}. Pick an earlier start or a shorter run.`);
  }
  const r = assess(ctx.pm, start, v.minutes, ve, inputs.person.age, ctx.tz, inputs.group, inputs.indoorRatio);
  const n = Math.max(1, roundHalfEven(v.minutes));
  const [h0, h1] = runHourSpan(ctx.pm, start, start + 60 * (n - 1));
  const factors = factorsOver(ctx, h0, h1);
  return {
    start, end, ve: v, veUsed: ve, runPmMean: r.runPmMean, runPmMaxHour: r.runPmMaxHour, dayPmMean: r.dayPmMean,
    runUg: r.runUg, restUg: r.restUg, vDayM3: r.vDayM3, cEq: r.cEq, hq: r.hq, runShareOfDay: r.runShareOfDay,
    pmLevel: r.level, pmReasons: r.reasons, factors, level: worst(r.level, factors.level), notes: r.notes,
  };
}

function validate(req: AssessRequest | PlanInputs) {
  const { plan, person, history, group, indoorRatio } = req;
  const isTime = (s: unknown) => typeof s === "string" && isDuration(s);
  const num = (x: unknown, lo: number, hi: number) => typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;
  if (!plan || !isTime(plan.pace)) throw new InputError("Pace must look like 6:00, minutes and seconds per km.");
  const pace = toMinutes(plan.pace);
  if (pace < 2 || pace > 20) throw new InputError("Pace must be between 2:00 and 20:00 per km.");
  if (!num(plan.distanceKm, 0.1, 100)) throw new InputError("Distance must be between 0.1 and 100 km.");
  if (!person || !num(person.age, 5, 100)) throw new InputError("Age must be between 5 and 100.");
  if (person.sex !== "male" && person.sex !== "female") throw new InputError("Sex must be male or female.");
  if (!num(person.heightCm, 100, 230)) throw new InputError("Height must be between 100 and 230 cm.");
  if (!num(person.weightKg, 25, 250)) throw new InputError("Weight must be between 25 and 250 kg.");
  const be = history?.bestEffort;
  if (be && (!num(be.distanceKm, 0.4, 100) || !isTime(be.time))) {
    throw new InputError("A best effort needs a distance in km and a time like 25:00.");
  }
  for (const r of history?.runs ?? []) {
    if (!num(r.distanceKm, 0.4, 100) || !isTime(r.time) || !num(r.avgHr, 60, 230)) {
      throw new InputError("Each recent run needs a distance in km, a time like 52:00 and an average heart rate of 60 to 230.");
    }
  }
  if (group !== "general" && group !== "vulnerable") throw new InputError("Group must be general or vulnerable.");
  if (!num(indoorRatio, 0, 1)) throw new InputError("Air for the rest of the day must be between 0 and 100%.");
}

function validatePlace(lat: unknown, lon: unknown) {
  const ok = (x: unknown, lim: number) => typeof x === "number" && Number.isFinite(x) && Math.abs(x) <= lim;
  if (!ok(lat, 90) || !ok(lon, 180)) throw new InputError("Pick a place from the search. Its coordinates are missing.");
}

function startOption(r: RunResult): StartOption {
  return {
    start: r.start, runUg: r.runUg, cEq: r.cEq, runPmMean: r.runPmMean, pmLevel: r.pmLevel, factorsLevel: r.factors.level,
    level: r.level, apparentTempC: r.factors.apparentTempC, uvIndex: r.factors.uvIndex,
    precipProbPct: r.factors.precipProbPct,
  };
}

export async function assessPlan(req: AssessRequest): Promise<AssessResponse> {
  validate(req);
  validatePlace(req.place?.lat, req.place?.lon);
  const ctx = context(await conditionsTimeline(req.place.lat, req.place.lon));
  const { tz, pm } = ctx;
  const now = Date.now() / 1000;
  const start = parseLocal(req.start ?? "", tz);
  if (start === null) throw new InputError("Start must be a date and time.");
  if (start < now - NOW_WINDOW) throw new InputError(`${fmtDayTime(start, tz)} is in the past. Pick a future start.`);

  const planned = runRisk(ctx, req, req.plan, start);
  const v = planned.ve;
  const bandRun = (ve: number) => assess(pm, start, v.minutes, ve, req.person.age, tz, req.group, req.indoorRatio);
  const lo = bandRun(v.veP10);
  const hi = bandRun(v.veP90);
  const skipC = req.indoorRatio * planned.dayPmMean;
  const skipLevel = riskLevel(skipC, 0, req.group).level;

  // the same run at every whole-hour start within the forecast, night included
  const t0 = pm.t[0];
  const first = Math.max(t0 + Math.ceil((now - t0) / 3600) * 3600, t0);
  const last = pmLast(ctx) + 3600 - v.minutes * 60;
  const byStart: StartOption[] = [];
  for (let t = first; t <= last; t += 3600) byStart.push(startOption(runRisk(ctx, req, req.plan, t)));

  // per forecast day, the start with the lowest overall level, then the lowest run dose; suggestions keep to
  // 05:00 to 21:00 like assess-risk.ipynb, so the advice is never a 3am run
  const bestByDay = new Map<string, StartOption>();
  for (const s of byStart) {
    const h = wallParts(s.start, tz).hour;
    if (h < FIRST_START_HOUR || h > LAST_START_HOUR) continue;
    const k = localDateKey(s.start, tz);
    const b = bestByDay.get(k);
    if (!b || LEVEL_RANK[s.level] < LEVEL_RANK[b.level] || (s.level === b.level && s.runUg < b.runUg)) bestByDay.set(k, s);
  }

  const tm = toMinutes(req.plan.pace);
  const slower: Plan = { ...req.plan, pace: `${Math.trunc(tm + 1)}:${pad(roundHalfEven((tm % 1) * 60))}` };
  const half: Plan = { ...req.plan, distanceKm: req.plan.distanceKm / 2 };
  const row = (key: string, label: string, kind: OptionRow["kind"], plan: Plan, r: RunResult): OptionRow => ({
    key, label, kind, plan, start: r.start, minutes: r.ve.minutes, veLmin: r.veUsed, runPmMean: r.runPmMean,
    runUg: r.runUg, vsPlannedUg: r.runUg - planned.runUg, cEq: r.cEq, pmLevel: r.pmLevel, factorsLevel: r.factors.level,
    level: r.level,
  });
  const options: OptionRow[] = [
    row("planned", "As planned", "planned", req.plan, planned),
    {
      key: "skip", label: "Skip the run", kind: "skip", plan: null, start, minutes: 0, veLmin: null, runPmMean: null,
      runUg: 0, vsPlannedUg: -planned.runUg, cEq: skipC, pmLevel: skipLevel, factorsLevel: null, level: skipLevel,
    },
    row("half", `Half distance (${fmtShort(half.distanceKm)} km)`, "shorter", half, runRisk(ctx, req, half, start)),
    row("slower", `1 min/km slower (${slower.pace})`, "slower", slower, runRisk(ctx, req, slower, start)),
  ];
  for (const s of bestByDay.values()) {
    options.push(row(`best-${localDateKey(s.start, tz)}`, `Best start ${fmtDayTime(s.start, tz).slice(0, 3)}`,
      "best-start", req.plan, runRisk(ctx, req, req.plan, s.start)));
  }

  const from = t0 + Math.floor((now - t0) / 3600) * 3600;
  const timeline = ctx.tl.hours
    .filter((h) => h.t >= from && h.t <= pmLast(ctx))
    .map(({ t, pm25, aqiUs, tempC, apparentTempC, uvIndex, precipProbPct, humidityPct, windMs, weatherCode, isDay }) => (
      { t, pm25, aqiUs, tempC, apparentTempC, uvIndex, precipProbPct, humidityPct, windMs, weatherCode, isDay }));

  return {
    place: req.place, timezone: tz, fetchedAt: Math.floor(now), aqGrid: ctx.tl.aqGrid, weatherGrid: ctx.tl.weatherGrid,
    pmHorizon: pmLast(ctx), group: req.group, indoorRatio: req.indoorRatio, plan: req.plan, planned,
    band: { p10: { runUg: lo.runUg, cEq: lo.cEq }, p90: { runUg: hi.runUg, cEq: hi.cEq } },
    skip: { cEq: skipC, level: skipLevel }, timeline, byStart, options,
  };
}

// the planned run scored at another place (for venue alternatives); null when the forecast can't cover it
export async function assessAt(lat: number, lon: number, start: number, inputs: PlanInputs) {
  validate(inputs);
  validatePlace(lat, lon);
  try {
    return runRisk(context(await conditionsTimeline(lat, lon)), inputs, inputs.plan, start);
  } catch (e) {
    if (e instanceof InputError) return null;
    throw e;
  }
}
