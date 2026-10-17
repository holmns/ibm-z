import { describe, expect, it } from "vitest";
import { estimateVe, type History, type Person, type Plan } from "../ve";
import golden from "./ve.golden.json";

type PyPlan = { pace: string; distance_km: number };
type PyPerson = { age: number; sex: "male" | "female"; height_cm: number; weight_kg: number };
type PyHistory = { best_effort?: { distance_km: number; time: string }; runs?: { distance_km: number; time: string; avg_hr: number }[] };

const plan = (p: PyPlan): Plan => ({ pace: p.pace, distanceKm: p.distance_km });
const person = (p: PyPerson): Person => ({ age: p.age, sex: p.sex, heightCm: p.height_cm, weightKg: p.weight_kg });
const history = (h: PyHistory | null): History => ({
  bestEffort: h?.best_effort ? { distanceKm: h.best_effort.distance_km, time: h.best_effort.time } : null,
  runs: (h?.runs ?? []).map((r) => ({ distanceKm: r.distance_km, time: r.time, avgHr: r.avg_hr })),
});

describe("estimateVe matches calculate-ve.ipynb", () => {
  for (const g of golden) {
    it(`${g.plan.pace} x ${g.plan.distance_km} km, age ${g.person.age}`, () => {
      const r = estimateVe(plan(g.plan), person(g.person as PyPerson), history(g.history as PyHistory | null));
      expect(r.variant).toBe(g.out.variant);
      for (const [ts, py] of [["veLmin", "ve_lmin"], ["veP10", "ve_p10"], ["veP90", "ve_p90"], ["minutes", "minutes"],
        ["airM3", "air_m3"], ["speedKmh", "speed_kmh"]] as const) {
        expect(r[ts]).toBeCloseTo(g.out[py] as number, 9);
      }
      expect(r.warnings).toEqual(g.out.warnings);
      // notes carry a lab-median HR read off a 0.05 km/h grid; compare everything before it
      expect(r.notes.map((n) => n.replace(/; lab median at this pace \d+\)/, ")")))
        .toEqual((g.out.notes as string[]).map((n) => n.replace(/; lab median at this pace \d+\)/, ")")));
    });
  }
});
