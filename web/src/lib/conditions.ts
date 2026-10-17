// The hourly timeline the risk runs on: Open-Meteo's weather, with PM2.5 from Google's Air Quality API
// (googleaq.ts). Without a key, or if Google fails, PM2.5 stays on Open-Meteo's CAMS forecast and pmSource says so.
import "server-only";
import { googlePm25 } from "./googleaq";
import { conditionsTimeline, type Timeline } from "./openmeteo";

export type AirTimeline = Timeline & { pmSource: "google" | "cams"; pmNow: { t: number; pm25: number } | null };

export async function airTimeline(lat: number, lon: number): Promise<AirTimeline> {
  const g = googlePm25(lat, lon)?.catch((e) => {
    console.error("Google Air Quality failed, so PM2.5 falls back to CAMS:", e);
    return null;
  });
  const [tl, gp] = await Promise.all([conditionsTimeline(lat, lon), g ?? null]);
  if (gp) {
    const hours = tl.hours.map((h) => ({ ...h, pm25: gp.pm25.get(h.t) ?? null }));
    const withPm = hours.filter((h) => h.pm25 !== null);
    // Google's hours are UTC hours; a place on a half-hour offset matches none of them
    if (withPm.length >= 2) return { ...tl, hours, pmHorizon: withPm[withPm.length - 1].t, pmSource: "google", pmNow: gp.now };
  }
  return { ...tl, pmSource: "cams", pmNow: null };
}
