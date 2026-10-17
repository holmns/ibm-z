// Expected VE for activities other than running: calculate-ve-others.ipynb §8. Compendium MET -> VO2 = MET x 3.5 x
// weight -> the VO2 -> VE regression fitted on the treadmill tests, coefficients in ve-others-model.json (§7).
import model from "./ve-others-model.json";
import { fmtG, roundHalfEven } from "./num";
import type { Person, VeResult } from "./ve";

export type MetActivity = { code: string; name: string; met: number; majorHeading: string; indoorOnly: boolean };
export type BandKind = "gait" | "sport";

const BAND = model.band as Record<BandKind, { p10: number; p90: number }>;
const RANGE = model.range as unknown as Record<string, [number, number]>;

export function predictVe(vo2MlMin: number, person: Person) {
  const t: Record<string, number> = { logVO2: Math.log(vo2MlMin / 1000) };
  for (const k of model.vo2Knots) t[`max(0,VO2kg-${k})`] = Math.max(0, vo2MlMin / person.weightKg - k);
  t.Age = person.age;
  t.Sex = person.sex === "female" ? 1 : 0;
  t.logW = Math.log(person.weightKg);
  t.Height = person.heightCm;
  let logVe = model.intercept;
  for (const [name, c] of Object.entries(model.coef as Record<string, number>)) logVe += c * t[name];
  return Math.exp(logVe) * model.smear;
}

export function estimateVeActivity(a: MetActivity, minutes: number, person: Person): VeResult {
  const vo2 = a.met * 3.5 * person.weightKg; // mL/min
  const ve = predictVe(vo2, person);
  const bandKind: BandKind = model.gaitHeadings.includes(a.majorHeading) ? "gait" : "sport";
  const band = BAND[bandKind];
  const notes = [`${a.name}: ${fmtG(a.met, 6)} MET (Compendium ${a.code})`,
    `VO2 ${roundHalfEven(vo2)} mL/min = ${fmtG(a.met, 6)} MET × 3.5 × ${fmtG(person.weightKg, 6)} kg`];
  const warn: string[] = [];
  if (a.indoorOnly) warn.push("this activity is usually done indoors; outdoor PM2.5 overstates the dose");
  if (a.majorHeading === "Sports") warn.push("the MET averages play and rest; hard rallies or rounds breathe more than the average");
  const checks: [string, number][] = [["VO2 mL/kg/min", vo2 / person.weightKg], ["age", person.age],
    ["weight kg", person.weightKg], ["height cm", person.heightCm]];
  for (const [k, v] of checks) {
    const [lo, hi] = RANGE[k];
    if (!(lo <= v && v <= hi)) warn.push(`${k} ${fmtG(v)} outside the data (${fmtG(lo)}-${fmtG(hi)})`);
  }
  return {
    variant: "MET", speedKmh: null, minutes, veLmin: ve, veP10: ve * band.p10, veP90: ve * band.p90,
    airM3: (ve * minutes) / 1000, airP10M3: (ve * band.p10 * minutes) / 1000, airP90M3: (ve * band.p90 * minutes) / 1000,
    notes, warnings: warn, met: a.met, vo2MlMin: vo2, bandKind,
  };
}
