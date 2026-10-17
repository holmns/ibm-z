import { describe, expect, it } from "vitest";
import { activityByCode } from "../activities";
import type { Person } from "../ve";
import { estimateVeActivity } from "../ve-others";
import golden from "./ve-others.golden.json";

type PyPerson = { age: number; sex: "male" | "female"; height_cm: number; weight_kg: number };
const person = (p: PyPerson): Person => ({ age: p.age, sex: p.sex, heightCm: p.height_cm, weightKg: p.weight_kg });

describe("estimateVeActivity matches calculate-ve-others.ipynb", () => {
  for (const g of golden.cases) {
    it(`${g.text}, ${g.intensity}, ${g.minutes} min, age ${g.person.age}`, () => {
      const a = activityByCode(g.code)!;
      const r = estimateVeActivity(a, g.minutes, person(g.person as PyPerson));
      expect(r.variant).toBe(g.out.variant);
      expect(r.bandKind).toBe(g.out.band_kind);
      for (const [ts, py] of [["met", "met"], ["vo2MlMin", "vo2_mlmin"], ["minutes", "minutes"], ["veLmin", "ve_lmin"],
        ["veP10", "ve_p10"], ["veP90", "ve_p90"], ["airM3", "air_m3"]] as const) {
        expect(r[ts]).toBeCloseTo(g.out[py] as number, 9);
      }
      expect(r.notes).toEqual(g.out.notes);
      expect(r.warnings).toEqual(g.out.warnings);
    });
  }
});
