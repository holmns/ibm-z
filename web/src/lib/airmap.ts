// The PM2.5 heat map: Google's Air Quality heatmap tiles (PM25_INDIGO_PERSIAN, current conditions) over Singapore.
// Shared by the tile proxy (aqtiles.ts) and the map (air-map.tsx).

export const HEAT_MAP_TYPE = "PM25_INDIGO_PERSIAN";
// how strongly the tiles cover the base map; in haze they are opaque and would hide every street
export const HEAT_OPACITY = 0.6;

// the map can't leave this box, and only tiles touching it are fetched: Singapore with Johor's south and Batam
export const AREA = { south: 0.95, north: 1.75, west: 103.3, east: 104.4 };
// zooms Google is asked for. Closer in, the zoom-12 tile is scaled up: the heat map is a smooth field anyway, and the
// cap keeps a full sweep of AREA at about 180 tiles an hour
export const HEAT_ZOOM = { min: 10, max: 12 };

const lonToX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const latToY = (lat: number, z: number) =>
  ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;

// a tile Google is asked for: within HEAT_ZOOM and touching AREA
export function isHeatTile(z: number, x: number, y: number) {
  if (![z, x, y].every(Number.isInteger) || z < HEAT_ZOOM.min || z > HEAT_ZOOM.max) return false;
  return x >= Math.floor(lonToX(AREA.west, z)) && x <= Math.floor(lonToX(AREA.east, z)) &&
    y >= Math.floor(latToY(AREA.north, z)) && y <= Math.floor(latToY(AREA.south, z));
}

// the fetched tile that covers map tile (x, y, z), and where in it: past HEAT_ZOOM.max, a 2^d-times enlargement of
// the zoom-12 tile, offset by (ox, oy) tiles
export function heatSource(x: number, y: number, z: number) {
  const d = Math.max(0, z - HEAT_ZOOM.max);
  const scale = 2 ** d;
  const t = { z: z - d, x: Math.floor(x / scale), y: Math.floor(y / scale) };
  if (!isHeatTile(t.z, t.x, t.y)) return null;
  return { ...t, scale, ox: x - t.x * scale, oy: y - t.y * scale };
}

// Google publishes no scale for this palette. These are tile pixels read where currentConditions gave the PM2.5, on
// 17 Oct 2026 from Sydney (4 µg/m³) to Palangka Raya (311): teal, partly transparent, through green, orange and red
// to crimson and violet
const CALIBRATION: [number, string][] = [
  [0, "rgb(5 177 162 / 0)"],
  [5, "rgb(5 177 162 / 0.2)"],
  [16, "rgb(2 216 81)"],
  [31, "rgb(255 173 3)"],
  [38, "rgb(255 137 3)"],
  [50, "rgb(255 78 0)"],
  [68, "rgb(255 25 0)"],
  [84, "rgb(240 3 7)"],
  [122, "rgb(176 15 47)"],
  [148, "rgb(171 16 66)"],
  [194, "rgb(159 19 109)"],
  [300, "rgb(130 22 190)"],
];
// the legend's ticks sit evenly spaced, so the low end, where the colour changes most, isn't squeezed
export const LEGEND_TICKS = [0, 25, 50, 100, 150, 300];

// where µg/m³ value v sits along the legend, 0 to 1, piecewise linear between ticks
export function legendPos(v: number) {
  const t = LEGEND_TICKS;
  if (v >= t[t.length - 1]) return 1;
  const i = t.findIndex((tick, k) => v < t[k + 1]);
  return (i + (v - t[i]) / (t[i + 1] - t[i])) / (t.length - 1);
}

export const LEGEND_GRADIENT = `linear-gradient(to right, ${CALIBRATION
  .map(([v, c]) => `${c} ${(legendPos(v) * 100).toFixed(2)}%`).join(", ")})`;
