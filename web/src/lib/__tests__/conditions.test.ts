import { afterEach, describe, expect, it, vi } from "vitest";
import { airTimeline } from "../conditions";
import { neaPsi } from "../nea";

// three Singapore hours from 2026-10-17 20:00 (12:00 UTC); the clock sits in the first
const T0 = Date.UTC(2026, 9, 17, 12) / 1000;
const iso = (t: number) => new Date(t * 1000).toISOString().replace(".000Z", "Z");
const gHour = (t: number, v: number) => ({ dateTime: iso(t), pollutants: [{ code: "pm25", concentration: { value: v, units: "MICROGRAMS_PER_CUBIC_METER" } }] });

function stubFetch(google: "ok" | "fail") {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = String(input);
    const om = (hourly: object) => Response.json({ latitude: 1.3, longitude: 103.9, timezone: "Asia/Singapore", hourly });
    if (url.startsWith("https://air-quality-api.open-meteo.com")) {
      return om({ time: [T0, T0 + 3600, T0 + 7200], pm2_5: [40, 41, 42], pm10: [50, 51, 52], us_aqi: [1, 2, 3] });
    }
    if (url.startsWith("https://api.open-meteo.com")) {
      const n = (v: number) => [v, v, v];
      return om({ time: [T0, T0 + 3600, T0 + 7200], temperature_2m: n(30), relative_humidity_2m: n(70), apparent_temperature: n(33),
        precipitation_probability: n(10), precipitation: n(0), weather_code: n(1), wind_speed_10m: n(2), uv_index: n(0), is_day: n(0) });
    }
    if (url.startsWith("https://airquality.googleapis.com")) {
      if (google === "fail") return new Response("quota", { status: 429 });
      if (url.endsWith("history:lookup")) return Response.json({ hoursInfo: [] });
      if (url.endsWith("currentConditions:lookup")) return Response.json(gHour(T0, 133));
      return Response.json({ hourlyForecasts: [gHour(T0 + 3600, 120)] });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("airTimeline", () => {
  it("takes PM2.5 from Google, hour by hour, and leaves hours Google lacks empty", async () => {
    vi.useFakeTimers({ now: (T0 + 600) * 1000, toFake: ["Date"] });
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");
    stubFetch("ok");
    const tl = await airTimeline(1.301, 103.912);
    expect(tl.pmSource).toBe("google");
    expect(tl.hours.map((h) => h.pm25)).toEqual([133, 120, null]);
    expect(tl.pmHorizon).toBe(T0 + 3600);
    expect(tl.pmNow).toEqual({ t: T0, pm25: 133 });
  });

  it("keeps CAMS and says so when Google fails", async () => {
    vi.useFakeTimers({ now: (T0 + 600) * 1000, toFake: ["Date"] });
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch("fail");
    const tl = await airTimeline(1.35, 103.85);
    expect(tl.pmSource).toBe("cams");
    expect(tl.hours.map((h) => h.pm25)).toEqual([40, 41, 42]);
    expect(tl.pmNow).toBeNull();
  });

  it("keeps CAMS without a key, and never calls Google", async () => {
    vi.useFakeTimers({ now: (T0 + 600) * 1000, toFake: ["Date"] });
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    const fetch = stubFetch("ok");
    expect((await airTimeline(1.4, 103.8)).pmSource).toBe("cams");
    expect(fetch.mock.calls.some(([u]) => String(u).includes("googleapis"))).toBe(false);
  });
});

describe("neaPsi", () => {
  const body = {
    data: {
      regionMetadata: [
        { name: "south", labelLocation: { latitude: 1.29587, longitude: 103.82 } },
        { name: "east", labelLocation: { latitude: 1.35735, longitude: 103.94 } },
      ],
      items: [{ timestamp: "2026-10-17T22:00:00+08:00", readings: { psi_twenty_four_hourly: { south: 163, east: 180 } } }],
    },
  };

  it("reads the 24-hour PSI of the nearest region, and nothing outside Singapore", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 17, 14) + 5 * 3_600_000, toFake: ["Date"] });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(body)));
    expect(await neaPsi(1.301, 103.912)).toEqual({ value: 180, region: "east", t: Date.UTC(2026, 9, 17, 14) / 1000 });
    expect(await neaPsi(3.139, 101.687)).toBeNull(); // Kuala Lumpur
  });
});
