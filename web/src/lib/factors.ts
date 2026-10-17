// Heat, UV and rain: the non-PM2.5 rules of detect.ipynb's assess_risk. PM2.5 is scored by risk.ts instead.
// detect.ipynb reads the single forecast hour nearest the start; here every hour the run touches counts, and the
// worst of each value is scored, so a long run can't slip past a hot hour.
import type { Level } from "./risk";

export const HEAT_HOT = 32;
export const HEAT_VERY_HOT = 35;
export const UV_HIGH = 6;
export const UV_VERY_HIGH = 8;
export const RAIN_ELEVATED = 50;
export const RAIN_HIGH = 70;

export type FactorReason =
  | { kind: "heat"; value: number; severity: "hot" | "very hot" }
  | { kind: "uv"; value: number; severity: "high" | "very high" }
  | { kind: "rain"; value: number; severity: "elevated" | "high" }
  | { kind: "thunderstorm" };

export type FactorValues = { apparentTempC: number | null; uvIndex: number | null; precipProbPct: number | null;
  thunderstorm: boolean };

export function factorRisk(f: FactorValues): { level: Level; reasons: FactorReason[] } {
  const heat = f.apparentTempC ?? -Infinity;
  const uv = f.uvIndex ?? -Infinity;
  const rain = f.precipProbPct ?? -Infinity;
  const reasons: FactorReason[] = [];
  if (heat >= HEAT_VERY_HOT) reasons.push({ kind: "heat", value: heat, severity: "very hot" });
  else if (heat >= HEAT_HOT) reasons.push({ kind: "heat", value: heat, severity: "hot" });
  if (uv >= UV_VERY_HIGH) reasons.push({ kind: "uv", value: uv, severity: "very high" });
  else if (uv >= UV_HIGH) reasons.push({ kind: "uv", value: uv, severity: "high" });
  // detect.ipynb raises the level at 50% without saying why; the reason makes that visible
  if (rain >= RAIN_HIGH) reasons.push({ kind: "rain", value: rain, severity: "high" });
  else if (rain >= RAIN_ELEVATED) reasons.push({ kind: "rain", value: rain, severity: "elevated" });
  // shown, not scored: detect.ipynb has no thunderstorm rule
  if (f.thunderstorm) reasons.push({ kind: "thunderstorm" });

  let level: Level = "Low";
  if (heat >= HEAT_VERY_HOT || (uv >= UV_VERY_HIGH && rain >= RAIN_HIGH)) level = "High";
  else if (heat >= HEAT_HOT || uv >= UV_HIGH || rain >= RAIN_ELEVATED) level = "Medium";
  return { level, reasons };
}
