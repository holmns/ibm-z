import { describe, expect, it } from "vitest";
import { assess, riskLevel, vDay, type Group } from "../risk";
import golden from "./assess.golden.json";

const TZ = "Asia/Singapore";
const flat = (level: number) => {
  const t0 = Date.UTC(2025, 11, 31, 16) / 1000; // 2026-01-01 00:00 SGT
  const t = Array.from({ length: 72 }, (_, i) => t0 + 3600 * i);
  return { t, v: t.map(() => level) };
};
const T0 = Date.UTC(2026, 0, 2, 12) / 1000; // 2026-01-02 20:00 SGT

describe("assess-risk.ipynb §5 checks", () => {
  it("a run breathed at the day-average rate gives C_eq equal to the PM2.5 level", () => {
    const avgVe = (vDay(30) / 1440) * 1000;
    expect(assess(flat(40), T0, 60, avgVe, 30, TZ).cEq).toBeCloseTo(40, 9);
  });
  it("doubling PM2.5 doubles dose and C_eq; indoor ratio scales the rest of the day", () => {
    const a = assess(flat(20), T0, 60, 65, 30, TZ);
    const b = assess(flat(40), T0, 60, 65, 30, TZ);
    expect(b.runUg).toBeCloseTo(2 * a.runUg, 9);
    expect(b.cEq).toBeCloseTo(2 * a.cEq, 9);
    expect(assess(flat(40), T0, 60, 65, 30, TZ, "general", 0.5).restUg).toBeCloseTo(0.5 * b.restUg, 9);
  });
  it("thresholds and the NEA override", () => {
    expect(riskLevel(37.4, 50, "general").level).toBe("Low");
    expect(riskLevel(37.5, 50, "general").level).toBe("Medium");
    expect(riskLevel(74.9, 50, "general").level).toBe("Medium");
    expect(riskLevel(75, 50, "general").level).toBe("High");
    expect(riskLevel(24.9, 50, "vulnerable").level).toBe("Low");
    expect(riskLevel(50, 50, "vulnerable").level).toBe("High");
    expect(riskLevel(20, 151, "general").level).toBe("High");
    expect(riskLevel(20, 150, "general").level).toBe("Low");
    expect([vDay(30), vDay(31), vDay(70), vDay(85)]).toEqual([15.7, 16.0, 14.2, 12.2]);
  });
});

describe("assess matches the notebook on a non-flat series", () => {
  for (const c of golden.cases) {
    it(`start ${c.start}, ${c.minutes} min, ${c.group}`, () => {
      const r = assess(golden.pm, c.start, c.minutes, c.ve, c.age, TZ, c.group as Group, c.ratio);
      expect(r.runPmMean).toBeCloseTo(c.out.run_pm_mean, 9);
      expect(r.runPmMaxHour).toBeCloseTo(c.out.run_pm_max_hour, 9);
      expect(r.dayPmMean).toBeCloseTo(c.out.day_pm_mean, 9);
      expect(r.runUg).toBeCloseTo(c.out.run_ug, 9);
      expect(r.restUg).toBeCloseTo(c.out.rest_ug, 9);
      expect(r.cEq).toBeCloseTo(c.out.c_eq, 9);
      expect(r.runShareOfDay).toBeCloseTo(c.out.run_share_of_day, 9);
      expect(r.level).toBe(c.out.level);
      expect(r.notes).toEqual(c.out.notes);
    });
  }
});
