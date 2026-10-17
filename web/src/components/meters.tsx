"use client";

import type { Level } from "@/lib/risk";
import { STATUS_COLOR } from "./ui";

const pct = (v: number, [d0, d1]: [number, number]) => `${(Math.max(0, Math.min(1, (v - d0) / (d1 - d0))) * 100).toFixed(2)}%`;

// a value on its Low / Medium / High scale: zones in the status colours, the zone holding the value at full strength
export function ZoneMeter({ domain, zones, value, ticks, band, label }: {
  domain: [number, number];
  zones: { to: number; level: Level }[];
  value: number;
  ticks: { v: number; label: string }[];
  band?: [number, number];
  label: string;
}) {
  const segs = zones.map((z, i) => ({
    from: i ? Math.min(zones[i - 1].to, domain[1]) : domain[0], to: Math.min(z.to, domain[1]), level: z.level,
  })).filter((s) => s.to > s.from);
  const current = segs.find((s) => value < s.to) ?? segs[segs.length - 1];
  return (
    <div role="meter" aria-label={label} aria-valuemin={domain[0]} aria-valuemax={domain[1]} aria-valuenow={value} className="pt-1">
      <div className="relative h-4">
        {band && (
          <div className="absolute top-0 h-[5px] border-x-2 border-ink-2"
            style={{ left: pct(band[0], domain), right: `calc(100% - ${pct(band[1], domain)})` }}>
            <div className="mt-[1.5px] h-0.5 bg-ink-2" />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 flex h-2 gap-0.5">
          {segs.map((s, i) => (
            <div
              key={i}
              className={`h-full ${i === 0 ? "rounded-l-full" : ""} ${i === segs.length - 1 ? "rounded-r-full" : ""}`}
              style={{
                width: `${((s.to - s.from) / (domain[1] - domain[0])) * 100}%`,
                background: STATUS_COLOR[s.level],
                opacity: s === current ? 1 : 0.28,
              }}
            />
          ))}
        </div>
        <div
          className="absolute bottom-[-4px] h-4 w-[5px] -translate-x-1/2 rounded-full bg-ink ring-2 ring-surface"
          style={{ left: pct(value, domain) }}
        />
      </div>
      <div className="relative mt-1.5 h-4 text-[11px] text-muted tnum">
        {ticks.map((t) => (
          <span key={t.v} className="absolute -translate-x-1/2" style={{ left: pct(t.v, domain) }}>{t.label}</span>
        ))}
      </div>
    </div>
  );
}

// the likely range of an estimate: a band from low to high on a track from zero, the estimate as a needle
export function RangeStrip({ lo, hi, value, unit, label }: { lo: number; hi: number; value: number; unit: string; label: string }) {
  const domain: [number, number] = [0, hi * 1.15];
  return (
    <div role="img" aria-label={label} title={label}>
      <div className="relative h-4">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-grid" />
        <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-accent/35"
          style={{ left: pct(lo, domain), right: `calc(100% - ${pct(hi, domain)})` }} />
        <div className="absolute top-0 h-4 w-[5px] -translate-x-1/2 rounded-full bg-accent ring-2 ring-surface"
          style={{ left: pct(value, domain) }} />
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-ink-2 tnum">
        <span className="absolute -translate-x-1/2" style={{ left: pct(lo, domain) }}>{Math.round(lo)}</span>
        <span className="absolute -translate-x-1/2" style={{ left: pct(hi, domain) }}>{Math.round(hi)}{unit}</span>
      </div>
    </div>
  );
}
