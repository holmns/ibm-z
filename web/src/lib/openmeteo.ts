// Open-Meteo client: air-weather-api.ipynb §1-§2. Hourly weather joined with hourly air quality, unchanged.
// Responses are cached per rounded coordinate and UTC hour, like the notebook.
import "server-only";

const OM_AQ_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const OM_WX_URL = "https://api.open-meteo.com/v1/forecast";
const AQ_VARS = ["pm2_5", "pm10", "us_aqi"];
const WX_VARS = ["temperature_2m", "relative_humidity_2m", "apparent_temperature", "precipitation_probability",
  "precipitation", "weather_code", "wind_speed_10m", "uv_index", "is_day"];

export class OpenMeteoError extends Error {}

export type Hour = {
  t: number;
  pm25: number | null;
  pm10: number | null;
  aqiUs: number | null;
  tempC: number | null;
  apparentTempC: number | null;
  humidityPct: number | null;
  precipProbPct: number | null;
  precipMm: number | null;
  weatherCode: number | null;
  windMs: number | null;
  uvIndex: number | null;
  isDay: boolean | null;
};

export type Timeline = {
  timezone: string;
  aqGrid: [number, number];
  weatherGrid: [number, number];
  pmHorizon: number | null; // last hour with PM2.5
  hours: Hour[];
};

type OmBody = {
  latitude: number;
  longitude: number;
  timezone: string;
  hourly: Record<string, (number | null)[]>;
  error?: boolean;
  reason?: string;
};

const cache = new Map<string, Promise<OmBody>>();

async function omFetch(url: string, lat: number, lon: number, variables: string[], extra: Record<string, string>) {
  const hour = Math.floor(Date.now() / 3_600_000);
  const key = `${url}|${lat.toFixed(3)}|${lon.toFixed(3)}|${hour}`;
  let p = cache.get(key);
  if (!p) {
    const params = new URLSearchParams({ latitude: String(lat), longitude: String(lon), hourly: variables.join(","),
      timezone: "auto", timeformat: "unixtime", ...extra });
    p = (async () => {
      const r = await fetch(`${url}?${params}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      const body = (await r.json()) as OmBody;
      if (r.status !== 200 || body.error) throw new OpenMeteoError(body.reason ?? `Open-Meteo HTTP ${r.status}`);
      return body;
    })();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
    for (const k of cache.keys()) if (!k.endsWith(`|${hour}`)) cache.delete(k);
  }
  return p;
}

export async function conditionsTimeline(lat: number, lon: number): Promise<Timeline> {
  const [aq, wx] = await Promise.all([
    omFetch(OM_AQ_URL, lat, lon, AQ_VARS, { forecast_days: "7" }),
    omFetch(OM_WX_URL, lat, lon, WX_VARS, { forecast_days: "16", wind_speed_unit: "ms" }),
  ]);
  const aqAt = new Map<number, number>();
  (aq.hourly.time as number[]).forEach((t, i) => aqAt.set(t, i));
  const pick = (key: string, i: number | undefined) => (i === undefined ? null : (aq.hourly[key][i] ?? null));
  const hours: Hour[] = (wx.hourly.time as number[]).map((t, i) => {
    const j = aqAt.get(t);
    const w = (k: string) => wx.hourly[k][i] ?? null;
    return {
      t, pm25: pick("pm2_5", j), pm10: pick("pm10", j), aqiUs: pick("us_aqi", j), tempC: w("temperature_2m"),
      apparentTempC: w("apparent_temperature"), humidityPct: w("relative_humidity_2m"),
      precipProbPct: w("precipitation_probability"), precipMm: w("precipitation"), weatherCode: w("weather_code"),
      windMs: w("wind_speed_10m"), uvIndex: w("uv_index"), isDay: w("is_day") === null ? null : w("is_day") === 1,
    };
  });
  const withPm = hours.filter((h) => h.pm25 !== null);
  return {
    timezone: wx.timezone, aqGrid: [aq.latitude, aq.longitude], weatherGrid: [wx.latitude, wx.longitude],
    pmHorizon: withPm.length ? withPm[withPm.length - 1].t : null, hours,
  };
}
