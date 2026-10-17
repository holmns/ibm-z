import { describe, expect, it } from "vitest";
import { factorRisk } from "../factors";

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
  it("missing values don't raise the level", () => {
    expect(factorRisk({ apparentTempC: null, uvIndex: null, precipProbPct: null, thunderstorm: false }).level).toBe("Low");
  });
});
