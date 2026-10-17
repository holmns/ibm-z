import { describe, expect, it } from "vitest";
import { hazeWarning } from "../haze";
import type { Conditions } from "../types";

const NOW = 1_800_000_000;
const at = (psi: number | null, pm25: number | null) => ({
  fetchedAt: NOW, psi: psi === null ? null : { value: psi, region: "east", t: NOW },
  pmNow: pm25 === null ? null : { t: NOW, pm25 },
}) as Conditions;

describe("hazeWarning", () => {
  it("warns about a plan more than 12 hours out while PSI is unhealthy", () => {
    expect(hazeWarning(at(180, 133), NOW + 13 * 3600)).toBe("Haze now: NEA's 24-hour PSI for the east is 180, unhealthy. " +
      "Forecasts more than 12 hours out tend to miss haze, so check again closer to the time.");
  });

  it("stays quiet within 12 hours, where the forecast still follows the readings", () => {
    expect(hazeWarning(at(180, 133), NOW + 12 * 3600)).toBeNull();
  });

  it("stays quiet without haze", () => {
    expect(hazeWarning(at(80, 40), NOW + 48 * 3600)).toBeNull();
  });

  it("falls back to the PM2.5 reading when NEA's PSI is missing", () => {
    expect(hazeWarning(at(null, 123.4), NOW + 24 * 3600)).toMatch(/^Haze now: PM2.5 here is 123 µg\/m³\./);
  });
});
