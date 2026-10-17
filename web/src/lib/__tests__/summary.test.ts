import { afterEach, describe, expect, it, vi } from "vitest";
import { summarize, SUMMARY_MODEL, tidy } from "../summary";
import type { SummaryFacts } from "../types";

const facts = (place: string): SummaryFacts => ({
  level: "Medium", raisedBy: ["air quality"], activity: "run", plan: "10 km at 6:00 per km", place,
  when: "Sun 18 Oct 20:00 to 21:00", thresholds: "general",
  air: { level: "Medium", dayPm25: "44 µg/m³", lowBelow: "37.5 µg/m³", highFrom: "75 µg/m³", sessionAvgPm25: "36 µg/m³",
    neaRating: "normal", oneHourMakesItHigh: false },
  heat: { level: "Low", feelsLike: "30.1°C" }, uv: { level: "Low", index: "0" },
  rain: { level: "Low", chanceOfRain: "20%", thunderstormForecast: false },
  dose: { duringSession: "156 µg", addedToDay: "133 µg" }, suggestion: "Starting Wed 21 Oct 06:00 brings it down to Low.",
  forecastCaveat: null,
});
const reply = (content: string) => Response.json({ choices: [{ message: { content } }] });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("summarize", () => {
  it("needs OPENROUTER_API_KEY", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    await expect(summarize(facts("Bishan Park"))).rejects.toMatchObject({ status: 503 });
  });

  it("sends the facts to the open-weight model with reasoning off, and keeps the answer", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetch = vi.fn<typeof globalThis.fetch>(async () => reply("Air drives it. Starting Wed 21 Oct 06:00 brings it down to Low."));
    vi.stubGlobal("fetch", fetch);
    const f = facts("East Coast Park");
    expect(await summarize(f)).toBe("Air drives it. Starting Wed 21 Oct 06:00 brings it down to Low.");
    await summarize(f);
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetch.mock.calls[0][1]!.body as string);
    expect(body).toMatchObject({ model: SUMMARY_MODEL, reasoning: { enabled: false } });
    expect(JSON.parse(body.messages[1].content)).toEqual(f);
  });

  it("SUMMARY_MODEL picks another model", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("SUMMARY_MODEL", "qwen/qwen3.8-27b");
    const fetch = vi.fn<typeof globalThis.fetch>(async () => reply("Fine."));
    vi.stubGlobal("fetch", fetch);
    await summarize(facts("Punggol Waterway"));
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string).model).toBe("qwen/qwen3.8-27b");
  });

  it("answers 502 on an empty reply", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => reply("  ")));
    await expect(summarize(facts("Jurong Lake"))).rejects.toMatchObject({ status: 502 });
  });
});

describe("tidy", () => {
  it("drops wrapping quotes and dashes", () => {
    expect(tidy(" \"Heat drives it — start earlier.\" ")).toBe("Heat drives it, start earlier.");
  });
});
