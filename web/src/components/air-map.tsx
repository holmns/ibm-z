"use client";

// Google's PM2.5 heat map (now) with pins for the planned place and the nearby alternatives. Google's terms want Air
// Quality tiles shown on a Google Map, so this loads the Maps JavaScript API with a browser key
// (NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY); the tiles come through /api/aq-tiles, which holds the server key.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AREA, HEAT_OPACITY, HEAT_ZOOM, heatSource, LEGEND_GRADIENT, LEGEND_TICKS } from "@/lib/airmap";
import { fmt } from "@/lib/format";
import type { Place, Venue } from "@/lib/types";
import { IndoorIcon, LevelLegend, StatusIcon } from "./ui";

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY?.trim();
export const MAP_ENABLED = Boolean(KEY);

export const PLAN_PIN = "plan";
export const venueId = (v: Venue) => `${v.name}-${v.lat}-${v.lon}`;

const HOUR_MS = 3_600_000;
// closest the map fits the pins; one venue next door shouldn't zoom to a single street
const FIT_MAX_ZOOM = 14;

// a quiet base map in the page's neutrals, so the heat map and the pins carry the colour: no places of interest or
// transit, and only the bigger roads named
function mapStyle(dark: boolean): google.maps.MapTypeStyle[] {
  const c = dark
    ? { land: "#1f1f1d", park: "#222821", water: "#141719", road: "#2e2e2b", highway: "#3a3a36", label: "#9a998f", halo: "#141413", border: "#55544f" }
    : { land: "#efeee9", park: "#e2e7da", water: "#d6dfe5", road: "#ffffff", highway: "#ffffff", label: "#6b6a66", halo: "#f6f6f3", border: "#a9a89f" };
  return [
    { elementType: "geometry", stylers: [{ color: c.land }] },
    { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
    { elementType: "labels.text.fill", stylers: [{ color: c.label }] },
    { elementType: "labels.text.stroke", stylers: [{ color: c.halo }] },
    { featureType: "administrative", elementType: "geometry", stylers: [{ visibility: "off" }] },
    { featureType: "administrative.country", elementType: "geometry.stroke", stylers: [{ visibility: "on" }, { color: c.border }] },
    { featureType: "poi", stylers: [{ visibility: "off" }] },
    { featureType: "poi.park", elementType: "geometry", stylers: [{ visibility: "on" }, { color: c.park }] },
    { featureType: "transit", stylers: [{ visibility: "off" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: c.road }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: c.highway }] },
    { featureType: "road.local", elementType: "labels", stylers: [{ visibility: "off" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: c.water }] },
    { featureType: "water", elementType: "labels", stylers: [{ visibility: "off" }] },
  ];
}

// the page's own scheme: data-theme if set, else the system's
function prefersDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
}

let loader: Promise<void> | null = null;

function loadMaps(key: string, onAuthFailure: () => void) {
  const w = window as unknown as Record<string, () => void>;
  w.gm_authFailure = onAuthFailure;
  loader ??= new Promise<void>((resolve, reject) => {
    w.__hazewiseMapsReady = () => resolve();
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__hazewiseMapsReady`;
    s.async = true;
    s.onerror = () => {
      loader = null;
      s.remove();
      reject(new Error("Google Maps did not load"));
    };
    document.head.append(s);
  });
  return loader;
}

// past HEAT_ZOOM.max each map tile is a slice of the enlarged zoom-12 tile; ?h= starts a fresh browser cache each hour
function heatLayer(): google.maps.MapType {
  const hour = Math.floor(Date.now() / HOUR_MS);
  return {
    tileSize: new google.maps.Size(256, 256),
    minZoom: 0,
    maxZoom: 22,
    name: "PM2.5 now",
    alt: "PM2.5 now",
    projection: null,
    radius: 6378137,
    getTile(coord, zoom, doc) {
      const div = (doc ?? document).createElement("div");
      div.style.width = div.style.height = "256px";
      const t = heatSource(coord.x, coord.y, zoom);
      if (t) {
        Object.assign(div.style, {
          backgroundImage: `url(/api/aq-tiles/${t.z}/${t.x}/${t.y}?h=${hour})`,
          backgroundSize: `${256 * t.scale}px`,
          backgroundPosition: `${-256 * t.ox}px ${-256 * t.oy}px`,
          opacity: String(HEAT_OPACITY),
        });
      }
      return div;
    },
    releaseTile() {},
  };
}

type Pin = { id: string; lat: number; lon: number; el: HTMLElement };

// the pins as plain elements over the map, centred on their places; React fills them through portals
function pinLayer(map: google.maps.Map, pins: Pin[]) {
  class Pins extends google.maps.OverlayView {
    onAdd() {
      for (const p of pins) this.getPanes()?.overlayMouseTarget.append(p.el);
    }
    draw() {
      const proj = this.getProjection();
      for (const p of pins) {
        const xy = proj.fromLatLngToDivPixel(new google.maps.LatLng(p.lat, p.lon));
        if (xy) Object.assign(p.el.style, { left: `${xy.x}px`, top: `${xy.y}px` });
      }
    }
    onRemove() {
      for (const p of pins) p.el.remove();
    }
  }
  const layer = new Pins();
  layer.setMap(map);
  return layer;
}

// the hovered pin draws over its neighbours
function stack(pins: Pin[], active: string | null) {
  for (const p of pins) p.el.style.zIndex = p.id === active ? "10" : p.id === PLAN_PIN ? "2" : "1";
}

function Tip({ title, detail }: { title: string; detail: string }) {
  return (
    <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-md bg-surface px-2 py-1 text-left whitespace-nowrap shadow-[0_2px_8px_rgba(11,11,11,0.2)] ring-1 ring-line">
      <span className="block text-xs font-medium text-ink">{title}</span>
      <span className="block text-[11px] text-ink-2">{detail}</span>
    </span>
  );
}

function PlanPin({ place, active }: { place: Place; active: boolean }) {
  return (
    <div className="relative">
      {active && <Tip title={place.name} detail="Your plan" />}
      <span className={`block size-3.5 rounded-full bg-accent shadow-[0_1px_4px_rgba(0,0,0,0.4)] ring-[3px] ring-white transition-transform duration-150 ${active ? "scale-125" : ""}`} />
    </div>
  );
}

function VenuePin({ v, active }: { v: Venue; active: boolean }) {
  const level = v.isIndoor ? `Indoor${v.level ? `, ${v.level} outdoors` : ""}` : (v.level ?? "No forecast");
  return (
    <div className="relative">
      {active && <Tip title={v.name} detail={`${fmt(v.distanceKm, 1)} km away, ${level}`} />}
      <span className={`grid size-7 place-items-center rounded-full bg-surface text-ink shadow-[0_1px_4px_rgba(0,0,0,0.35)] ring-1 ring-line-strong transition-transform duration-150 ${active ? "scale-[1.18]" : ""}`}>
        {v.isIndoor ? <IndoorIcon size={15} /> : v.level ? <StatusIcon level={v.level} size={16} /> : <span className="size-2 rounded-full bg-muted" />}
      </span>
    </div>
  );
}

function Key({ heatOn, setHeatOn }: { heatOn: boolean; setHeatOn: (on: boolean) => void }) {
  const last = LEGEND_TICKS.length - 1;
  return (
    <div className="space-y-3 border-t border-line px-5 py-3 text-xs text-ink-2">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
        <div className="w-full sm:w-[300px]">
          <div className="mb-1.5 flex items-center justify-between">
            <label className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-ink">
              <input type="checkbox" checked={heatOn} onChange={(e) => setHeatOn(e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
              PM2.5 now
            </label>
            <span className="text-[11px] text-muted">µg/m³</span>
          </div>
          <div className={`transition-opacity ${heatOn ? "" : "opacity-40"}`}>
            <div className="h-2 rounded-full ring-1 ring-line ring-inset">
              <div className="h-full rounded-full" style={{ background: LEGEND_GRADIENT, opacity: HEAT_OPACITY }} />
            </div>
            <div className="tnum relative mt-1 h-3.5 text-[11px] leading-3.5 text-muted">
              {LEGEND_TICKS.map((t, i) => (
                <span key={t} className="absolute top-0"
                  style={{ left: `${(i / last) * 100}%`, transform: `translateX(${i === 0 ? "0" : i === last ? "-100%" : "-50%"})` }}>
                  {i === last ? `${t}+` : t}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-accent ring-2 ring-white shadow-[0_0_0_2.5px_var(--border-strong)]" />Your plan
          </span>
          <LevelLegend />
          <span className="inline-flex items-center gap-1.5"><IndoorIcon />Indoor</span>
        </div>
      </div>
      <p className="text-[11px] text-muted">
        Includes air quality data from Google. The heat map is the current hour; the pins are the level at your start time.
      </p>
    </div>
  );
}

export function AirMap({ place, venues, active, onActive }: {
  place: Place; venues: Venue[] | null; active: string | null; onActive: (id: string | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [heatOn, setHeatOn] = useState(true);

  useEffect(() => {
    if (!KEY) return;
    let cancelled = false;
    loadMaps(KEY, () => setError("Google Maps turned down the key, so the map can't show."))
      .then(() => google.maps.importLibrary("maps") as Promise<google.maps.MapsLibrary>)
      .then(({ Map }) => {
        if (cancelled || !box.current) return;
        const dark = prefersDark();
        setMap(new Map(box.current, {
          center: { lat: (AREA.south + AREA.north) / 2, lng: (AREA.west + AREA.east) / 2 },
          zoom: 11,
          minZoom: HEAT_ZOOM.min,
          maxZoom: 17,
          restriction: { latLngBounds: AREA, strictBounds: true },
          styles: mapStyle(dark),
          backgroundColor: dark ? "#1f1f1d" : "#efeee9",
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "cooperative",
          clickableIcons: false,
        }));
      })
      .catch(() => !cancelled && setError("Google Maps didn't load. Check the connection and reload."));
    return () => {
      cancelled = true;
    };
  }, []);

  // follow the system's light and dark switch
  useEffect(() => {
    if (!map) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const restyle = () => map.setOptions({ styles: mapStyle(prefersDark()) });
    mq.addEventListener("change", restyle);
    return () => mq.removeEventListener("change", restyle);
  }, [map]);

  useEffect(() => {
    if (!map || !heatOn) return;
    map.overlayMapTypes.push(heatLayer());
    return () => map.overlayMapTypes.clear();
  }, [map, heatOn]);

  // detached until the map is up; the portals below fill them either way
  const pins = useMemo<Pin[]>(() => [
    { id: PLAN_PIN, lat: place.lat, lon: place.lon, label: `${place.name}, your plan` },
    ...(venues ?? []).map((v) => ({ id: venueId(v), lat: v.lat, lon: v.lon, label: v.name })),
  ].map(({ label, ...p }) => {
    const el = document.createElement("div");
    el.className = "absolute -translate-x-1/2 -translate-y-1/2 cursor-default";
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", label);
    el.addEventListener("pointerenter", () => onActive(p.id));
    el.addEventListener("pointerleave", () => onActive(null));
    // a tap on a touch screen, where there is no hover
    el.addEventListener("click", () => onActive(p.id));
    return { ...p, el };
  }), [place, venues, onActive]);

  useEffect(() => {
    if (!map) return;
    for (const p of pins) google.maps.OverlayView.preventMapHitsAndGesturesFrom(p.el);
    const layer = pinLayer(map, pins);
    if (pins.length === 1) {
      map.setCenter({ lat: place.lat, lng: place.lon });
      map.setZoom(13);
    } else {
      const bounds = new google.maps.LatLngBounds();
      for (const p of pins) bounds.extend({ lat: p.lat, lng: p.lon });
      map.fitBounds(bounds, 56);
      google.maps.event.addListenerOnce(map, "idle", () => {
        if ((map.getZoom() ?? 0) > FIT_MAX_ZOOM) map.setZoom(FIT_MAX_ZOOM);
      });
    }
    return () => layer.setMap(null);
  }, [map, pins, place]);

  useEffect(() => stack(pins, active), [pins, active]);

  const byId = new Map((venues ?? []).map((v) => [venueId(v), v]));
  return (
    <>
      <div className="relative h-[280px] border-t border-line bg-surface-2 sm:h-[360px]">
        <div ref={box} className="absolute inset-0" />
        {error && <div className="absolute inset-0 grid place-items-center px-6 text-center text-[13px] text-ink-2">{error}</div>}
        {pins.map(({ id, el }) => {
          if (id === PLAN_PIN) return createPortal(<PlanPin place={place} active={active === id} />, el, id);
          const v = byId.get(id);
          return v ? createPortal(<VenuePin v={v} active={active === id} />, el, id) : null;
        })}
      </div>
      <Key heatOn={heatOn} setHeatOn={setHeatOn} />
    </>
  );
}
