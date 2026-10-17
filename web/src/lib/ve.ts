// Expected VE for a planned run: calculate-ve.ipynb §9-§10, with the fitted coefficients from §8 in ve-model.json.
import model from "./ve-model.json";
import { toMinutes } from "./duration";
import { fmtG, fmtShort, linfit, mean, roundHalfEven } from "./num";

export { isDuration, toMinutes } from "./duration";

export type Plan = { pace: string; distanceKm: number };
export type Person = { age: number; sex: "male" | "female"; heightCm: number; weightKg: number };
export type BestEffort = { distanceKm: number; time: string };
export type HistoryRun = { distanceKm: number; time: string; avgHr: number };
export type History = { bestEffort?: BestEffort | null; runs?: HistoryRun[] | null };
export type Variant = "A" | "B" | "C";

// runs use variants A-C from pace and set the run fields; other activities use "MET" (ve-others.ts), with no speed
// and the MET fields set
export type VeResult = {
  variant: Variant | "MET";
  speedKmh: number | null;
  minutes: number;
  veLmin: number;
  veP10: number;
  veP90: number;
  airM3: number;
  airP10M3: number;
  airP90M3: number;
  notes: string[];
  warnings: string[];
  met?: number;
  vo2MlMin?: number;
  bandKind?: "gait" | "sport";
  vpeakKmh?: number | null;
  vpeakLabMedian?: number;
  hrAtPace?: number | null;
};

type Row = { Speed: number; Age: number; Sex: number; Weight: number; Height: number; HR: number; vpeak: number };
type Fitted = { intercept: number; coef: Record<string, number>; smear: number; hr: boolean; vpeak: boolean };

const MODELS = model.models as Record<Variant, Fitted>;
const BAND = model.band as Record<Variant, { p10: number; p90: number }>;
const RANGE = model.range as unknown as Record<string, [number, number]>;
const LAB_HR = model.labHrBySpeed as Record<string, number | null>;

function design(x: Row, hr: boolean, vpeak: boolean) {
  const t: Record<string, number> = { Speed: x.Speed };
  for (const k of model.speedKnots) t[`max(0,Speed-${k})`] = Math.max(0, x.Speed - k);
  t.Age = x.Age;
  t.Sex = x.Sex;
  t.logW = Math.log(x.Weight);
  t.Height = x.Height;
  if (hr) {
    t.HR = x.HR;
    for (const k of model.hrKnots) t[`max(0,HR-${k})`] = Math.max(0, x.HR - k);
    t["Speed*HR"] = x.Speed * x.HR;
  }
  if (vpeak) {
    t.vpeak = x.vpeak;
    t["vpeak*Speed"] = x.vpeak * x.Speed;
  }
  return t;
}

function predict(variant: Variant, x: Row) {
  const f = MODELS[variant];
  const terms = design(x, f.hr, f.vpeak);
  let logVe = f.intercept;
  for (const [name, c] of Object.entries(f.coef)) logVe += c * terms[name];
  return Math.exp(logVe) * f.smear;
}

// one model row; running speeds shifted to the ramp speed whose VE matches steady state (§6)
function features(plan: Plan, person: Person): Row {
  const speed = 60 / toMinutes(plan.pace);
  return {
    Speed: speed > 5.5 ? speed + model.rampLagKmh : speed, Age: person.age, Sex: person.sex === "female" ? 1 : 0,
    Weight: person.weightKg, Height: person.heightCm, HR: NaN, vpeak: NaN,
  };
}

export function vpeakFromBestEffort(be: BestEffort) {
  const t5 = toMinutes(be.time) * (5 / be.distanceKm) ** model.riegel;
  return 5 / (t5 / 60) / model.fiveKOverVpeak;
}

export function hrAtSpeed(runs: HistoryRun[], speed: number, tol = 0.5): [number | null, string] {
  if (!runs.length) return [null, "no runs with HR"];
  const sp = runs.map((r) => r.distanceKm / (toMinutes(r.time) / 60));
  const hr = runs.map((r) => r.avgHr);
  const lo = Math.min(...sp);
  const hi = Math.max(...sp);
  if (!(lo - tol <= speed && speed <= hi + tol)) {
    return [null, `goal speed ${speed.toFixed(1)} km/h outside run history (${lo.toFixed(1)}-${hi.toFixed(1)} km/h)`];
  }
  if (sp.length === 1 || hi - lo < 0.3) return [mean(hr), `mean HR of runs at ${mean(sp).toFixed(1)} km/h`];
  const [slope, icpt] = linfit(sp, hr);
  return [icpt + slope * speed, `HR-speed line over ${sp.length} runs, ${slope.toFixed(1)} bpm per km/h`];
}

function labHrAt(speed: number) {
  const key = (Math.round(speed * 20) / 20).toFixed(2);
  return LAB_HR[key] ?? null;
}

export function estimateVe(plan: Plan, person: Person, history: History = {}): VeResult {
  const pace = toMinutes(plan.pace);
  const speed = 60 / pace;
  const minutes = plan.distanceKm * pace;
  const x = features(plan, person);
  const notes: string[] = [];
  const warn: string[] = [];

  const be = history.bestEffort;
  if (be) {
    x.vpeak = vpeakFromBestEffort(be);
    notes.push(`peak speed ${x.vpeak.toFixed(1)} km/h from best effort ${fmtShort(be.distanceKm)} km in ${be.time} ` +
      `(lab median ${model.vpeakLabMedian.toFixed(1)})`);
    const goalTime = toMinutes(be.time) * (plan.distanceKm / be.distanceKm) ** model.riegel;
    if (minutes < goalTime) {
      const s = roundHalfEven((goalTime / plan.distanceKm) * 60);
      warn.push(`goal pace is faster than the best effort predicts for ${fmtShort(plan.distanceKm)} km ` +
        `(${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} min/km); VE will be higher than estimated`);
    }
  }
  const runs = history.runs ?? [];
  const [hr, how] = hrAtSpeed(runs, speed);
  if (hr !== null) {
    x.HR = hr;
    const lab = labHrAt(x.Speed);
    notes.push(`HR at pace ${hr.toFixed(0)} bpm (${how}` + (lab === null ? ")" : `; lab median at this pace ${lab.toFixed(0)})`));
  } else if (runs.length) {
    warn.push(`HR not used: ${how}`);
  }

  const variant: Variant = be ? "B" : hr !== null ? "C" : "A";
  const ve = predict(variant, x);
  const band = BAND[variant];

  const checks: [string, number][] = [["speed km/h", x.Speed], ["age", person.age], ["weight kg", person.weightKg],
    ["height cm", person.heightCm], ["peak speed km/h", x.vpeak], ["HR", x.HR]];
  for (const [k, v] of checks) {
    const [lo, hi] = RANGE[k];
    if (!Number.isNaN(v) && !(lo <= v && v <= hi)) warn.push(`${k} ${fmtG(v)} outside the data (${fmtG(lo)}-${fmtG(hi)})`);
  }
  return {
    variant, speedKmh: speed, minutes, veLmin: ve, veP10: ve * band.p10, veP90: ve * band.p90,
    airM3: (ve * minutes) / 1000, airP10M3: (ve * band.p10 * minutes) / 1000, airP90M3: (ve * band.p90 * minutes) / 1000,
    notes, warnings: warn, vpeakKmh: Number.isNaN(x.vpeak) ? null : x.vpeak, vpeakLabMedian: model.vpeakLabMedian,
    hrAtPace: hr,
  };
}

export const VE_RANGE = RANGE;
