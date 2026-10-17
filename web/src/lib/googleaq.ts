// Hourly PM2.5 from Google's Air Quality API (GOOGLE_MAPS_API_KEY in web/.env): the hours since local midnight, the
// current hour and 96 hours ahead. It starts from monitoring stations, so it tracks NEA's readings in haze where the
// CAMS forecast doesn't: at East Coast Park on 17 Oct 2026 it missed NEA's east reading by 19 µg/m³ on average over
// 30 hours, CAMS by 55. About 10 hours out it has eased back to a global model, CAMS-like, and misses haze again.
import "server-only";

const API = "https://airquality.googleapis.com/v1";
const HOUR_MS = 3_600_000;

export type GooglePm = { pm25: Map<number, number>; now: { t: number; pm25: number } | null };

type GoogleHour = {
  dateTime?: string;
  pollutants?: { code: string; concentration?: { value: number; units: string } }[];
};

async function post(path: string, key: string, body: object) {
  const res = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Google Air Quality ${path} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

function pm25Of(h: GoogleHour) {
  const c = h.pollutants?.find((p) => p.code === "pm25")?.concentration;
  return c && c.units === "MICROGRAMS_PER_CUBIC_METER" && Number.isFinite(c.value) ? c.value : null;
}

const cache = new Map<string, Promise<GooglePm>>();

// null without a key; rejects if Google fails, so the caller can fall back and say so
export function googlePm25(lat: number, lon: number): Promise<GooglePm> | null {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) return null;
  // ~1 km cells: Google's grid is 500 m, and venues near each other share one set of calls
  const location = { latitude: Math.round(lat * 100) / 100, longitude: Math.round(lon * 100) / 100 };
  const hour = Math.floor(Date.now() / HOUR_MS);
  const k = `${location.latitude}|${location.longitude}|${hour}`;
  let p = cache.get(k);
  if (!p) {
    const extraComputations = ["POLLUTANT_CONCENTRATION"];
    p = (async () => {
      // history counts back from the last whole hour, so 25 reaches local midnight anywhere; the forecast can't
      // start before the next hour, so the current hour comes from current conditions
      const [hist, cur, fc] = await Promise.all([
        post("history:lookup", key, { location, hours: 25, pageSize: 25, extraComputations }),
        post("currentConditions:lookup", key, { location, extraComputations }),
        post("forecast:lookup", key, {
          location, pageSize: 96, extraComputations,
          period: { startTime: new Date((hour + 1) * HOUR_MS).toISOString(), endTime: new Date((hour + 96) * HOUR_MS).toISOString() },
        }),
      ]);
      const pm25 = new Map<number, number>();
      for (const h of [...(hist.hoursInfo ?? []), cur, ...(fc.hourlyForecasts ?? [])] as GoogleHour[]) {
        const v = pm25Of(h);
        if (v !== null && h.dateTime) pm25.set(Date.parse(h.dateTime) / 1000, v);
      }
      if (!pm25.size) throw new Error("Google Air Quality returned no PM2.5");
      const nowV = pm25Of(cur);
      return { pm25, now: cur.dateTime && nowV !== null ? { t: Date.parse(cur.dateTime) / 1000, pm25: nowV } : null };
    })();
    cache.set(k, p);
    p.catch(() => cache.delete(k));
    for (const old of cache.keys()) if (!old.endsWith(`|${hour}`)) cache.delete(old);
  }
  return p;
}
