// Nearby venue alternatives: detect.ipynb's nearby_facilities and alternative_venues. SportSG facilities and NParks
// park facilities from data.gov.sg, cached in memory and on disk after the first download.
import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assessAt } from "./plan";
import { LEVEL_RANK } from "./risk";
import type { PlanInputs, Venue } from "./types";

const DATA_GOV_POLL = "https://api-open.data.gov.sg/v1/public/api/datasets/{}/poll-download";
const SPORTSG_DATASET = "d_9b87bab59d036a60fad2a91530e10773";
const NPARKS_DATASET = "d_14d807e20158338fd578c2913953516e";
const CACHE_DIR = path.join(process.cwd(), ".cache");
// detect.ipynb's keywords, minus swimming/pool (ActiveSG pools are outdoor) and plus sport centre (each has an
// indoor sports hall or gym); a guess from the name, not a verified attribute
const INDOOR_KEYWORDS =
  /\b(gym|fitness|indoor|sports?\s*(hall|centre)|squash|badminton|table\s*tennis|studio|bowling|climbing|dojo|martial\s*arts)\b/i;
// detect.ipynb takes the nearest NParks features of any class, which in practice are car parks and notice boards;
// only classes someone could exercise at or shelter in are kept
const NPARKS_CLASSES = new Set(["FITNESS AREA", "MULTIPURPOSE COURT", "SHELTER"]);
const RADIUS_KM = 12;

type Feature = { geometry: { coordinates: number[] } | null; properties: Record<string, string | null> | null };
type GeoJson = { features: Feature[] };

const memory = new Map<string, Promise<GeoJson>>();

async function download(datasetId: string): Promise<GeoJson> {
  const file = path.join(CACHE_DIR, `${datasetId}.geojson`);
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {}
  let url: string | undefined;
  for (let attempt = 0; attempt < 4 && !url; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1500 * attempt));
    const r = await fetch(DATA_GOV_POLL.replace("{}", datasetId), { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const body = await r.json().catch(() => null);
    if (body?.code === 0) url = body.data?.url;
  }
  if (!url) throw new Error("data.gov.sg download is not available");
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`data.gov.sg HTTP ${r.status}`);
  const text = await r.text();
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, text);
  return JSON.parse(text);
}

function loadGeojson(datasetId: string) {
  let p = memory.get(datasetId);
  if (!p) {
    p = download(datasetId);
    memory.set(datasetId, p);
    p.catch(() => memory.delete(datasetId));
  }
  return p;
}

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const rad = Math.PI / 180;
  const dlat = (lat2 - lat1) * rad;
  const dlon = (lon2 - lon1) * rad;
  const a = Math.sin(dlat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dlon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

const sentence = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

async function nearby(lat: number, lon: number, datasetId: string, kind: Venue["type"], limit: number) {
  const geo = await loadGeojson(datasetId);
  const rows: Venue[] = [];
  for (const f of geo.features ?? []) {
    const c = f.geometry?.coordinates;
    const p = f.properties ?? {};
    if (!c || c.length < 2) continue;
    if (kind === "NParks" && !NPARKS_CLASSES.has(p.CLASS ?? "")) continue;
    const [flon, flat] = c;
    const km = distanceKm(lat, lon, flat, flon);
    if (km > RADIUS_KM) continue;
    const name = kind === "ActiveSG / SportSG" ? (p.VENUE ?? "SportSG facility") : sentence(p.CLASS ?? "NParks facility");
    const detail = kind === "ActiveSG / SportSG"
      ? [p.ADDRESSBLOCKHOUSENUMBER, p.ADDRESSSTREETNAME].filter(Boolean).join(" ")
      : (p.NAME ?? "").trim();
    rows.push({
      name, type: kind, detail, lat: flat, lon: flon, distanceKm: km,
      // NParks features are park facilities, so outdoor air even under a shelter roof
      isIndoor: kind === "ActiveSG / SportSG" && INDOOR_KEYWORDS.test(name),
      level: null, pmLevel: null, factorsLevel: null, cEq: null,
    });
  }
  return rows.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, limit);
}

export async function alternativeVenues(lat: number, lon: number, start: number, inputs: PlanInputs, preferIndoor: boolean) {
  const candidates = [
    ...(await nearby(lat, lon, SPORTSG_DATASET, "ActiveSG / SportSG", 8)),
    ...(await nearby(lat, lon, NPARKS_DATASET, "NParks", 5)),
  ];
  candidates.sort((a, b) => (preferIndoor ? Number(!a.isIndoor) - Number(!b.isIndoor) : 0) || a.distanceKm - b.distanceKm);
  const picks = candidates.slice(0, 6);
  const scored = await Promise.all(picks.map(async (v) => {
    const r = await assessAt(v.lat, v.lon, start, inputs);
    return r ? { ...v, level: r.level, pmLevel: r.pmLevel, factorsLevel: r.factors.level, cEq: r.cEq } : v;
  }));
  const rank = (v: Venue) => (v.level ? LEVEL_RANK[v.level] : 3);
  return scored.sort((a, b) => rank(a) - rank(b) || Number(!a.isIndoor) - Number(!b.isIndoor) || a.distanceKm - b.distanceKm);
}
