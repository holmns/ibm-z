import { describe, expect, it } from "vitest";
import { fmtDayTime, parseLocal, startOfLocalDay, toLocalInput } from "../time";

describe("time zone helpers", () => {
  it("reads wall time in the place's zone", () => {
    expect(parseLocal("2026-10-17T20:00", "Asia/Singapore")).toBe(Date.UTC(2026, 9, 17, 12) / 1000);
    expect(parseLocal("2026-10-17 07:30", "Asia/Kolkata")).toBe(Date.UTC(2026, 9, 17, 2, 0) / 1000);
    expect(parseLocal("2026-13-01T00:00", "Asia/Singapore")).toBeNull();
  });
  it("handles DST zones", () => {
    // London is on BST until 25 Oct 2026
    expect(parseLocal("2026-10-24T09:00", "Europe/London")).toBe(Date.UTC(2026, 9, 24, 8) / 1000);
    expect(parseLocal("2026-10-26T09:00", "Europe/London")).toBe(Date.UTC(2026, 9, 26, 9) / 1000);
  });
  it("formats and round-trips", () => {
    const t = Date.UTC(2026, 9, 17, 12) / 1000;
    expect(fmtDayTime(t, "Asia/Singapore")).toBe("Sat 17 Oct 20:00");
    expect(toLocalInput(t, "Asia/Singapore")).toBe("2026-10-17T20:00");
    expect(startOfLocalDay(t, "Asia/Singapore")).toBe(Date.UTC(2026, 9, 16, 16) / 1000);
  });
});
