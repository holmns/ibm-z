import { describe, expect, it } from "vitest";
import { factorParts, factorRisk } from "../factors";
import { worst } from "../risk";

const f = (apparentTempC: number, uvIndex: number, precipProbPct: number, thunderstorm = false) =>
  factorRisk({ apparentTempC, uvIndex, precipProbPct, thunderstorm });

describe("detect.ipynb heat, UV and rain rules", () => {
  it("levels", () => {
    expect(f(31.9, 5.9, 49).level).toBe("Low");
    expect(f(32, 0, 0).level).toBe("Medium");
    expect(f(35, 0, 0).level).toBe("High");
    expect(f(25, 6, 0).level).toBe("Medium");
    expect(f(25, 8, 69).level).toBe("Medium");
    expect(f(25, 8, 70).level).toBe("High");
    expect(f(25, 0, 50).level).toBe("Medium");
    expect(f(25, 0, 95).level).toBe("Medium");
  });
  it("reasons, including the thunderstorm flag that doesn't change the level", () => {
    expect(f(36, 9, 80).reasons.map((r) => r.kind)).toEqual(["heat", "uv", "rain"]);
    const storm = f(28, 0, 40, true);
    expect(storm.level).toBe("Low");
    expect(storm.reasons).toEqual([{ kind: "thunderstorm" }]);
  });
  it("the worst per-factor level is detect.ipynb's level", () => {
    for (const heat of [25, 31.9, 32, 34.9, 35, 40]) {
      for (const uv of [0, 5.9, 6, 7.9, 8, 11]) {
        for (const rain of [0, 49, 50, 69, 70, 100]) {
          const v = { apparentTempC: heat, uvIndex: uv, precipProbPct: rain, thunderstorm: false };
          const p = factorParts(v);
          expect(worst(p.heat, p.uv, p.rain)).toBe(factorRisk(v).level);
        }
      }
    }
    expect(factorParts({ apparentTempC: 30, uvIndex: 9, precipProbPct: 80, thunderstorm: false }))
      .toEqual({ heat: "Low", uv: "High", rain: "High", combo: true });
  });
  it("missing values don't raise the level", () => {
    expect(factorRisk({ apparentTempC: null, uvIndex: null, precipProbPct: null, thunderstorm: false }).level).toBe("Low");
  });
});
