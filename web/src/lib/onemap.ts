// Venue search: detect.ipynb's onemap_search. OneMap answers without a token too (with an "error" note beside the
// results), so ONEMAP_TOKEN is optional.
import "server-only";
import type { Place } from "./types";

const ONEMAP_SEARCH = "https://www.onemap.gov.sg/api/common/elastic/search";

type OneMapResult = { SEARCHVAL: string; ADDRESS: string; LATITUDE: string; LONGITUDE: string };

const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());

export async function searchPlaces(query: string, limit = 6): Promise<Place[]> {
  const params = new URLSearchParams({ searchVal: query, returnGeom: "Y", getAddrDetails: "Y", pageNum: "1" });
  const token = process.env.ONEMAP_TOKEN;
  const r = await fetch(`${ONEMAP_SEARCH}?${params}`, {
    headers: token ? { Authorization: token } : {}, cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`OneMap HTTP ${r.status}`);
  const body = (await r.json()) as { results?: OneMapResult[] };
  const seen = new Set<string>();
  const places: Place[] = [];
  for (const x of body.results ?? []) {
    const lat = Number(x.LATITUDE);
    const lon = Number(x.LONGITUDE);
    // OneMap lists every building of a park; one per name and ~200 m cell is enough
    const key = `${x.SEARCHVAL}|${lat.toFixed(2)}|${lon.toFixed(2)}`;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || seen.has(key)) continue;
    seen.add(key);
    places.push({ name: titleCase(x.SEARCHVAL), address: titleCase(x.ADDRESS), lat, lon });
    if (places.length >= limit) break;
  }
  return places;
}
