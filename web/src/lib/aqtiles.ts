// PM2.5 heat map tiles from Google's Air Quality API, fetched here so GOOGLE_MAPS_API_KEY stays on the server.
// Google allows a tile to be cached for an hour, so each is kept until the clock hour turns.
import "server-only";
import { HEAT_MAP_TYPE } from "./airmap";

const API = "https://airquality.googleapis.com/v1";
const HOUR_MS = 3_600_000;

const cache = new Map<string, Promise<ArrayBuffer>>();

// seconds until the cached tile is dropped, for the browser's Cache-Control
export const secondsToHour = () => Math.max(1, Math.ceil((HOUR_MS - (Date.now() % HOUR_MS)) / 1000));

// null without a key; the caller checks the tile with isHeatTile first, which caps how many an hour can cost
export function heatTile(z: number, x: number, y: number): Promise<ArrayBuffer> | null {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) return null;
  const hour = Math.floor(Date.now() / HOUR_MS);
  const k = `${z}/${x}/${y}|${hour}`;
  let p = cache.get(k);
  if (!p) {
    p = (async () => {
      const res = await fetch(`${API}/mapTypes/${HEAT_MAP_TYPE}/heatmapTiles/${z}/${x}/${y}`, {
        headers: { "x-goog-api-key": key },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Google heatmap tile ${z}/${x}/${y} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return res.arrayBuffer();
    })();
    cache.set(k, p);
    p.catch(() => cache.delete(k));
    for (const old of cache.keys()) if (!old.endsWith(`|${hour}`)) cache.delete(old);
  }
  return p;
}
