// The planned session and its alternatives: assess-risk.ipynb §6-§8, with detect.ipynb's heat, UV and rain rules
// scored alongside. Overall level = the worse of the PM2.5 level and the heat/UV/rain level. Runs get VE from pace
// (ve.ts); any other activity from its Compendium MET (ve-others.ts); an activity the database doesn't know gets the
// forecast alone.
import "server-only";
import { codeMatch, familyMatch, toInfo, type ActivityMatch } from "./activities";
import { factorParts, factorRisk } from "./factors";
import { fmtShort, roundHalfEven } from "./num";
import { airTimeline, type AirTimeline } from "./conditions";
import { neaPsi } from "./nea";
import type { Hour } from "./openmeteo";
import { assess, LEVEL_RANK, outdoorShare, riskLevel, runHourSpan, worst, type PmSeries } from "./risk";
import { INTENSITIES, isActivityPlan, noun, type ActivityPlan, type SessionPlan } from "./session";
import { fmtDayTime, localDateKey, pad, parseLocal, wallParts } from "./time";
import type {
  AssessRequest, AssessResult, Conditions, Factors, OptionRow, PlanInputs, Psi, RunResult, StartOption,
} from "./types";
import { isDuration, toMinutes } from "./duration";
import { estimateVe, type Plan, type VeResult } from "./ve";
import { estimateVeActivity } from "./ve-others";

export class InputError extends Error {}

const NOW_WINDOW = 30 * 60;
const FIRST_START_HOUR = 5;
const LAST_START_HOUR = 21;

type Context = { tl: AirTimeline; pm: PmSeries; tz: string; byT: Map<number, Hour> };

function context(tl: AirTimeline): Context {
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
  const { combo, ...parts } = factorParts(values);
  return { ...values, ...factorRisk(values), parts, combo };
}

function pmLast(ctx: Context) {
  return ctx.pm.t[ctx.pm.t.length - 1];
}

// the database row an activity plan points at: its family's code for the intensity, else its own code
export function activityFor(plan: ActivityPlan): ActivityMatch | null {
  if (plan.family) return familyMatch(plan.family, plan.intensity ?? "moderate");
  return plan.code ? codeMatch(plan.code) : null;
}

function veFor(inputs: PlanInputs, plan: SessionPlan): VeResult {
  if (!isActivityPlan(plan)) return estimateVe(plan, inputs.person, inputs.history);
  const a = activityFor(plan);
  if (!a) throw new InputError(`Activity not found: ${plan.text}.`);
  // runs go through the pace model above; a running MET is never used
  if (a.majorHeading === "Running") throw new InputError("A run takes a pace and distance. Look up the activity again.");
  return estimateVeActivity(a, plan.minutes, inputs.person);
}

function runRisk(ctx: Context, inputs: PlanInputs, plan: SessionPlan, start: number): RunResult {
  const v = veFor(inputs, plan);
  const ve = inputs.group === "vulnerable" ? v.veP90 : v.veLmin;
  const end = start + v.minutes * 60;
  if (end > pmLast(ctx) + 3600) {
    throw new InputError(`The ${noun(plan)} ends ${fmtDayTime(end, ctx.tz)}, after the PM2.5 forecast ends at ` +
      `${fmtDayTime(pmLast(ctx), ctx.tz)}. Pick an earlier start or a shorter ${noun(plan)}.`);
  }
  const r = assess(ctx.pm, start, v.minutes, ve, inputs.person.age, ctx.tz, inputs.group,
    outdoorShare(inputs.outdoorHours, v.minutes));
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
  const { plan, person, history, group, outdoorHours } = req;
  const isTime = (s: unknown) => typeof s === "string" && isDuration(s);
  const num = (x: unknown, lo: number, hi: number) => typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;
  const strOrNull = (x: unknown) => x === null || (typeof x === "string" && x.length <= 300);
  if (!plan) throw new InputError("Describe the activity.");
  if (isActivityPlan(plan)) {
    if (typeof plan.text !== "string" || plan.text.length > 300 || !strOrNull(plan.code) || !strOrNull(plan.family)) {
      throw new InputError("Look up the activity again.");
    }
    if (plan.intensity !== null && !INTENSITIES.includes(plan.intensity)) throw new InputError("Intensity must be light, moderate or vigorous.");
    if (!num(plan.minutes, 1, 600)) throw new InputError("Duration must be between 1 and 600 minutes.");
  } else {
    if (!isTime(plan.pace)) throw new InputError("Pace must look like 6:00, minutes and seconds per km.");
    const pace = toMinutes(plan.pace);
    if (pace < 2 || pace > 20) throw new InputError("Pace must be between 2:00 and 20:00 per km.");
    if (!num(plan.distanceKm, 0.1, 100)) throw new InputError("Distance must be between 0.1 and 100 km.");
  }
  if (!person || !num(person.age, 5, 100)) throw new InputError("Age must be between 5 and 100.");
  if (person.sex !== "male" && person.sex !== "female") throw new InputError("Sex must be male or female.");
  if (!num(person.heightCm, 100, 230)) throw new InputError("Height must be between 100 and 230 cm.");
  if (!num(person.weightKg, 25, 250)) throw new InputError("Weight must be between 25 and 250 kg.");
  // running history only feeds the running model
  if (!isActivityPlan(plan)) {
    const be = history?.bestEffort;
    if (be && (!num(be.distanceKm, 0.4, 100) || !isTime(be.time))) {
      throw new InputError("A best effort needs a distance in km and a time like 25:00.");
    }
    for (const r of history?.runs ?? []) {
      if (!num(r.distanceKm, 0.4, 100) || !isTime(r.time) || !num(r.avgHr, 60, 230)) {
        throw new InputError("Each recent run needs a distance in km, a time like 52:00 and an average heart rate of 60 to 230.");
      }
    }
  }
  if (group !== "general" && group !== "vulnerable") throw new InputError("Group must be general or vulnerable.");
  if (!num(outdoorHours, 0, 24)) throw new InputError("Hours outdoors must be between 0 and 24.");
}

function validatePlace(lat: unknown, lon: unknown) {
  const ok = (x: unknown, lim: number) => typeof x === "number" && Number.isFinite(x) && Math.abs(x) <= lim;
  if (!ok(lat, 90) || !ok(lon, 180)) throw new InputError("Pick a place from the search. Its coordinates are missing.");
}

function startOption(r: RunResult): StartOption {
  return {
    start: r.start, runUg: r.runUg, cEq: r.cEq, runPmMean: r.runPmMean, pmLevel: r.pmLevel, factorsLevel: r.factors.level,
    parts: r.factors.parts, level: r.level, apparentTempC: r.factors.apparentTempC, uvIndex: r.factors.uvIndex,
    precipProbPct: r.factors.precipProbPct,
  };
}

function conditions(ctx: Context, req: AssessRequest, now: number, psi: Psi | null): Conditions {
  const t0 = ctx.pm.t[0];
  const from = t0 + Math.floor((now - t0) / 3600) * 3600;
  const timeline = ctx.tl.hours
    .filter((h) => h.t >= from && h.t <= pmLast(ctx))
    .map(({ t, pm25, aqiUs, tempC, apparentTempC, uvIndex, precipProbPct, humidityPct, windMs, weatherCode, isDay }) => (
      { t, pm25, aqiUs, tempC, apparentTempC, uvIndex, precipProbPct, humidityPct, windMs, weatherCode, isDay }));
  return {
    place: req.place, timezone: ctx.tz, fetchedAt: Math.floor(now), aqGrid: ctx.tl.aqGrid, weatherGrid: ctx.tl.weatherGrid,
    pmHorizon: pmLast(ctx), pmSource: ctx.tl.pmSource, pmNow: ctx.tl.pmNow, psi, group: req.group,
    outdoorHours: req.outdoorHours, timeline,
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// half as long and one step easier: half distance and 1 min/km slower for a run, half the time and the family's next
// lower intensity for other activities (none when the activity has no family or is already light)
function changes(plan: SessionPlan): { key: string; label: string; kind: OptionRow["kind"]; plan: SessionPlan }[] {
  if (isActivityPlan(plan)) {
    const out: ReturnType<typeof changes> = [
      { key: "half", label: `Half the time (${fmtShort(plan.minutes / 2)} min)`, kind: "shorter", plan: { ...plan, minutes: plan.minutes / 2 } },
    ];
    const i = INTENSITIES.indexOf(plan.intensity ?? "moderate");
    const lower = plan.family && i > 0 ? familyMatch(plan.family, INTENSITIES[i - 1]) : null;
    if (lower) {
      out.push({
        key: "easier", label: `${cap(INTENSITIES[i - 1])} intensity (${fmtShort(lower.met)} MET)`, kind: "easier",
        plan: { ...plan, intensity: INTENSITIES[i - 1], code: lower.code },
      });
    }
    return out;
  }
  const tm = toMinutes(plan.pace);
  const slower: Plan = { ...plan, pace: `${Math.trunc(tm + 1)}:${pad(roundHalfEven((tm % 1) * 60))}` };
  const half: Plan = { ...plan, distanceKm: plan.distanceKm / 2 };
  return [
    { key: "half", label: `Half distance (${fmtShort(half.distanceKm)} km)`, kind: "shorter", plan: half },
    { key: "slower", label: `1 min/km slower (${slower.pace})`, kind: "slower", plan: slower },
  ];
}

export async function assessPlan(req: AssessRequest): Promise<AssessResult> {
  validate(req);
  validatePlace(req.place?.lat, req.place?.lon);
  const [tl, psi] = await Promise.all([airTimeline(req.place.lat, req.place.lon), neaPsi(req.place.lat, req.place.lon)]);
  const ctx = context(tl);
  const { tz, pm } = ctx;
  const now = Date.now() / 1000;
  const start = parseLocal(req.start ?? "", tz);
  if (start === null) throw new InputError("Start must be a date and time.");
  if (start < now - NOW_WINDOW) throw new InputError(`${fmtDayTime(start, tz)} is in the past. Pick a future start.`);

  const activity = isActivityPlan(req.plan) ? activityFor(req.plan) : null;
  if (isActivityPlan(req.plan) && !activity) {
    return { ...conditions(ctx, req, now, psi), found: false, query: req.plan.text, start, end: start + req.plan.minutes * 60 };
  }

  const planned = runRisk(ctx, req, req.plan, start);
  const v = planned.ve;
  const bandRun = (ve: number) => assess(pm, start, v.minutes, ve, req.person.age, tz, req.group,
    outdoorShare(req.outdoorHours, v.minutes));
  const lo = bandRun(v.veP10);
  const hi = bandRun(v.veP90);
  // skipping keeps the same hours outdoors, so the session's slot is spent indoors
  const skipC = outdoorShare(req.outdoorHours, 0) * planned.dayPmMean;
  const skipLevel = riskLevel(skipC, 0, req.group).level;

  // the same session at every whole-hour start within the forecast, night included
  const t0 = pm.t[0];
  const first = Math.max(t0 + Math.ceil((now - t0) / 3600) * 3600, t0);
  const last = pmLast(ctx) + 3600 - v.minutes * 60;
  const byStart: StartOption[] = [];
  for (let t = first; t <= last; t += 3600) byStart.push(startOption(runRisk(ctx, req, req.plan, t)));

  // per forecast day, the start with the lowest overall level, then the lowest dose; suggestions keep to
  // 05:00 to 21:00 like assess-risk.ipynb, so the advice is never a 3am session
  const bestByDay = new Map<string, StartOption>();
  for (const s of byStart) {
    const h = wallParts(s.start, tz).hour;
    if (h < FIRST_START_HOUR || h > LAST_START_HOUR) continue;
    const k = localDateKey(s.start, tz);
    const b = bestByDay.get(k);
    if (!b || LEVEL_RANK[s.level] < LEVEL_RANK[b.level] || (s.level === b.level && s.runUg < b.runUg)) bestByDay.set(k, s);
  }

  const row = (key: string, label: string, kind: OptionRow["kind"], plan: SessionPlan, r: RunResult): OptionRow => ({
    key, label, kind, plan, start: r.start, minutes: r.ve.minutes, veLmin: r.veUsed, runPmMean: r.runPmMean,
    runUg: r.runUg, vsPlannedUg: r.runUg - planned.runUg, cEq: r.cEq, pmLevel: r.pmLevel, factorsLevel: r.factors.level,
    parts: r.factors.parts, level: r.level,
  });
  const options: OptionRow[] = [
    row("planned", "As planned", "planned", req.plan, planned),
    {
      key: "skip", label: `Skip the ${noun(req.plan)}`, kind: "skip", plan: null, start, minutes: 0, veLmin: null,
      runPmMean: null, runUg: 0, vsPlannedUg: -planned.runUg, cEq: skipC, pmLevel: skipLevel, factorsLevel: null,
      parts: null, level: skipLevel,
    },
    ...changes(req.plan).map((c) => row(c.key, c.label, c.kind, c.plan, runRisk(ctx, req, c.plan, start))),
  ];
  for (const s of bestByDay.values()) {
    options.push(row(`best-${localDateKey(s.start, tz)}`, `Best start ${fmtDayTime(s.start, tz).slice(0, 3)}`,
      "best-start", req.plan, runRisk(ctx, req, req.plan, s.start)));
  }

  return {
    ...conditions(ctx, req, now, psi), found: true, plan: req.plan, activity: activity && toInfo(activity), planned,
    band: { p10: { runUg: lo.runUg, cEq: lo.cEq }, p90: { runUg: hi.runUg, cEq: hi.cEq } },
    skip: {
      cEq: skipC, level: skipLevel, ug: skipC * planned.vDayM3,
      ugInRunSlot: skipC * planned.vDayM3 - planned.restUg,
    },
    byStart, options,
  };
}

// the planned session scored at another place (for venue alternatives); null when the forecast can't cover it
export async function assessAt(lat: number, lon: number, start: number, inputs: PlanInputs) {
  validate(inputs);
  validatePlace(lat, lon);
  try {
    return runRisk(context(await airTimeline(lat, lon)), inputs, inputs.plan, start);
  } catch (e) {
    if (e instanceof InputError) return null;
    throw e;
  }
}
