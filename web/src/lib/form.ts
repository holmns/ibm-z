// Dashboard form state. Fields stay strings while typing; toRequest turns them into an API request.
import type { Group } from "./risk";
import { fmtDay, localDateKey, parseLocal, startOfLocalDay, wallParts } from "./time";
import type { AssessRequest, Place } from "./types";
import { isDuration, toMinutes } from "./duration";

export const DEFAULT_TZ = "Asia/Singapore";

export type RunRow = { distanceKm: string; time: string; avgHr: string };

export type FormState = {
  place: Place;
  day: string;
  time: string;
  distanceKm: string;
  pace: string;
  age: string;
  sex: "male" | "female";
  heightCm: string;
  weightKg: string;
  bestEffort: { distanceKm: string; time: string } | null;
  runs: RunRow[];
  group: Group;
  indoorPct: number;
};

// tonight 20:00, or tomorrow's if that has passed (assess-risk.ipynb's START = "20:00")
export function defaultStart(now = Date.now() / 1000, tz = DEFAULT_TZ) {
  let t = startOfLocalDay(now, tz) + 20 * 3600;
  if (t < now) t += 86400;
  return { day: localDateKey(t, tz), time: "20:00" };
}

// the notebooks' example runner, so the first result can be checked against assess-risk.ipynb §6
export function defaultForm(): FormState {
  return {
    place: { name: "East Coast Park", lat: 1.301, lon: 103.912 },
    ...defaultStart(),
    distanceKm: "10",
    pace: "6:00",
    age: "30",
    sex: "male",
    heightCm: "175",
    weightKg: "70",
    bestEffort: { distanceKm: "5", time: "25:00" },
    runs: [
      { distanceKm: "8", time: "52:00", avgHr: "148" },
      { distanceKm: "5", time: "30:00", avgHr: "155" },
      { distanceKm: "10", time: "58:00", avgHr: "160" },
    ],
    group: "general",
    indoorPct: 100,
  };
}

// today plus the next four days, which is about as far as the PM2.5 forecast reaches
export function dayOptions(now = Date.now() / 1000, tz = DEFAULT_TZ) {
  const day0 = startOfLocalDay(now, tz);
  return Array.from({ length: 5 }, (_, i) => {
    const t = day0 + i * 86400 + 12 * 3600;
    const label = i === 0 ? `Today, ${fmtDay(t, tz).slice(0, 6)}` : i === 1 ? `Tomorrow, ${fmtDay(t, tz).slice(0, 6)}` : fmtDay(t, tz);
    return { value: localDateKey(t, tz), label: label.trim() };
  });
}

export function startInstant(f: Pick<FormState, "day" | "time">, tz = DEFAULT_TZ) {
  return parseLocal(`${f.day}T${f.time}`, tz);
}

export function paceInfo(f: Pick<FormState, "pace" | "distanceKm">) {
  const d = Number(f.distanceKm);
  if (!isDuration(f.pace) || !(d > 0)) return null;
  const pace = toMinutes(f.pace);
  return { minutes: pace * d, speedKmh: 60 / pace };
}

export function toRequest(f: FormState): AssessRequest | { error: string } {
  const n = (s: string) => (s.trim() === "" ? NaN : Number(s));
  if (!isDuration(f.pace)) return { error: "Pace must look like 6:00, minutes and seconds per km." };
  if (!/^\d{1,2}:\d{2}$/.test(f.time)) return { error: "Pick a start time." };
  const runs = f.runs.filter((r) => r.distanceKm || r.time || r.avgHr);
  return {
    place: f.place,
    start: `${f.day}T${f.time}`,
    plan: { pace: f.pace.trim(), distanceKm: n(f.distanceKm) },
    person: { age: n(f.age), sex: f.sex, heightCm: n(f.heightCm), weightKg: n(f.weightKg) },
    history: {
      bestEffort: f.bestEffort && (f.bestEffort.distanceKm || f.bestEffort.time)
        ? { distanceKm: n(f.bestEffort.distanceKm), time: f.bestEffort.time.trim() } : null,
      runs: runs.map((r) => ({ distanceKm: n(r.distanceKm), time: r.time.trim(), avgHr: n(r.avgHr) })),
    },
    group: f.group,
    indoorRatio: f.indoorPct / 100,
  };
}

export function hourOf(t: number, tz = DEFAULT_TZ) {
  return wallParts(t, tz).hour;
}
