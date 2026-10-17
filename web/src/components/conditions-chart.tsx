"use client";

import { useMemo, useState } from "react";
import { HEAT_HOT, HEAT_VERY_HOT, RAIN_ELEVATED, RAIN_HIGH, UV_HIGH, UV_VERY_HIGH } from "@/lib/factors";
import { fmt, WMO_CODES } from "@/lib/format";
import { NEA_BANDS, psiBand } from "@/lib/risk";
import { fmtDayTime, fmtTime } from "@/lib/time";
import type { Psi, TimelineHour } from "@/lib/types";
import { linear, M, niceTicks, timeTicks, TipRow, Tooltip, useWidth } from "./chart-kit";
import { Card, CardHeader, TextButton } from "./ui";

type Key = "pm25" | "apparentTempC" | "uvIndex" | "precipProbPct";
type Panel = {
  key: Key;
  title: string;
  unit: string;
  height: number;
  domain: (vals: number[]) => [number, number];
  thresholds: { v: number; label: string }[];
  bars?: boolean;
  digits: number;
};

const PANELS: Panel[] = [
  {
    key: "pm25", title: "PM2.5", unit: "µg/m³", height: 92, digits: 0,
    domain: (v) => [0, Math.max(Math.max(...v) * 1.15, 70)],
    // NEA's 1-hour bands, in the same plain words as the other panels
    thresholds: NEA_BANDS.slice(0, 3).map(([top], i) => ({ v: top, label: ["Elevated", "High", "Very high"][i] })),
  },
  {
    key: "apparentTempC", title: "Feels like", unit: "°C", height: 76, digits: 1,
    domain: (v) => [Math.min(28, Math.floor(Math.min(...v)) - 1), Math.max(38, Math.ceil(Math.max(...v)) + 1)],
    thresholds: [{ v: HEAT_HOT, label: "Hot" }, { v: HEAT_VERY_HOT, label: "Very hot" }],
  },
  {
    key: "uvIndex", title: "UV index", unit: "", height: 68, digits: 1,
    domain: (v) => [0, Math.max(10, Math.ceil(Math.max(...v)) + 1)],
    thresholds: [{ v: UV_HIGH, label: "High" }, { v: UV_VERY_HIGH, label: "Very high" }],
  },
  {
    key: "precipProbPct", title: "Chance of rain", unit: "%", height: 68, digits: 0, bars: true,
    domain: () => [0, 100],
    thresholds: [{ v: RAIN_ELEVATED, label: "Likely" }, { v: RAIN_HIGH, label: "Very likely" }],
  },
];
const TITLE_H = 22;
const GAP = 14;
const AXIS_H = 52;

export function ConditionsChart({ timeline, tz, runStart, runEnd, placeName, psi, label = "Your run" }: {
  timeline: TimelineHour[]; tz: string; runStart: number; runEnd: number; placeName: string; psi: Psi | null; label?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const t0 = timeline[0].t;
  const t1 = timeline[timeline.length - 1].t;
  const plotW = Math.max(0, width - M.left - M.right);
  const xs = linear(t0, t1, M.left, M.left + plotW);
  const pxPerHour = plotW / Math.max(1, (t1 - t0) / 3600);

  const layout = useMemo(() => PANELS.map((p, i) => {
    const vals = timeline.map((h) => h[p.key]).filter((v): v is number => v !== null);
    const [d0, d1] = vals.length ? p.domain(vals) : [0, 1];
    const top = PANELS.slice(0, i).reduce((y, q) => y + TITLE_H + q.height + GAP, 0) + TITLE_H;
    return { ...p, top, d0, d1, ys: linear(d0, d1, top + p.height, top) };
  }), [timeline]);
  const plotTop = layout[0].top;
  const plotBottom = layout[layout.length - 1].top + layout[layout.length - 1].height;
  const height = plotBottom + AXIS_H;
  const ticks = timeTicks(t0, t1, tz, pxPerHour);

  const indexAt = (px: number) => {
    const t = t0 + ((px - M.left) / plotW) * (t1 - t0);
    return Math.max(0, Math.min(timeline.length - 1, Math.round((t - t0) / 3600)));
  };
  const h = hover === null ? null : timeline[hover];
  const inRun = (t: number) => t >= Math.floor(runStart / 3600) * 3600 && t <= runEnd;

  return (
    <Card>
      <CardHeader
        title={`Forecast at ${placeName}`}
        subtitle={<>
          Hourly until {fmtDayTime(t1, tz)}. Labelled lines mark where the risk rules step up.
          {psi && <> NEA&apos;s 24-hour PSI for the {psi.region} is {psi.value} now, {psiBand(psi.value)}.</>}
        </>}
        action={<TextButton onClick={() => setTable((v) => !v)} pressed={table}>{table ? "Chart" : "Table"}</TextButton>}
      />
      {table ? (
        <div className="max-h-[440px] overflow-auto border-t border-line">
          <table className="w-full text-[13px] tnum">
            <thead className="sticky top-0 bg-surface text-left text-ink-2">
              <tr className="border-b border-line">
                {["Hour", "PM2.5 µg/m³", "Feels like °C", "UV index", "Rain %", "Weather"].map((c, i) => (
                  <th key={c} className={`px-4 py-2 font-medium ${i > 0 && i < 5 ? "text-right" : ""}`}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {timeline.map((r) => (
                <tr key={r.t} className={`border-b border-line last:border-0 ${inRun(r.t) ? "bg-[var(--run-window)]" : ""}`}>
                  <td className="px-4 py-1.5 whitespace-nowrap">{fmtDayTime(r.t, tz)}</td>
                  <td className="px-4 py-1.5 text-right">{fmt(r.pm25)}</td>
                  <td className="px-4 py-1.5 text-right">{fmt(r.apparentTempC, 1)}</td>
                  <td className="px-4 py-1.5 text-right">{fmt(r.uvIndex, 1)}</td>
                  <td className="px-4 py-1.5 text-right">{fmt(r.precipProbPct)}</td>
                  <td className="px-4 py-1.5 text-ink-2">{r.weatherCode === null ? "" : WMO_CODES[r.weatherCode]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-5 pb-4">
        <div ref={ref} className="relative" style={{ height }}>
          {width > 0 && (
            <svg
              width={width}
              height={height}
              role="img"
              aria-label={`Hourly PM2.5, feels-like temperature, UV index and chance of rain at ${placeName}`}
              tabIndex={0}
              className="block touch-pan-y outline-none"
              onPointerMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const px = e.clientX - r.left;
                setHover(px < M.left - 6 || px > M.left + plotW + 6 ? null : indexAt(px));
              }}
              onPointerLeave={() => setHover(null)}
              onBlur={() => setHover(null)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  const step = e.key === "ArrowRight" ? 1 : -1;
                  setHover((i) => Math.max(0, Math.min(timeline.length - 1, (i ?? indexAt(xs(runStart))) + step)));
                }
              }}
              onFocus={() => setHover(indexAt(xs(runStart)))}
            >
              {/* run window across every panel */}
              <rect x={xs(runStart)} y={plotTop} width={Math.max(2, xs(runEnd) - xs(runStart))} height={plotBottom - plotTop}
                fill="var(--run-window)" />
              {/* day boundaries */}
              {ticks.filter((t) => t.major && !t.edge).map((t) => (
                <line key={t.t} x1={xs(t.t)} x2={xs(t.t)} y1={plotTop} y2={plotBottom} stroke="var(--grid)" />
              ))}
              {layout.map((p) => {
                // feels-like doesn't start at zero, so its ticks are the multiples of 5 inside the domain
                const yTicks = p.key === "apparentTempC"
                  ? [p.d0, ...Array.from({ length: 12 }, (_, i) => 20 + 5 * i).filter((v) => v > p.d0 + 2 && v <= p.d1)]
                  : niceTicks(p.d1, 2).filter((v) => v <= p.d1);
                const pts = timeline.filter((r) => r[p.key] !== null);
                const path = pts.map((r, i) => `${i ? "L" : "M"}${xs(r.t).toFixed(1)},${p.ys(r[p.key]!).toFixed(1)}`).join("");
                const barW = Math.max(1, Math.min(24, pxPerHour * 0.62));
                return (
                  <g key={p.key}>
                    <text x={0} y={p.top - 8} className="fill-ink text-[12px] font-semibold">
                      {p.title}
                      {p.unit && <tspan className="fill-ink-2 font-normal">{`  ${p.unit}`}</tspan>}
                    </text>
                    {yTicks.map((v) => (
                      <g key={v}>
                        <line x1={M.left} x2={M.left + plotW} y1={p.ys(v)} y2={p.ys(v)}
                          stroke={v === p.d0 ? "var(--axis)" : "var(--grid)"} />
                        {(v !== p.d0 || p.d0 === 0) && (
                          <text x={M.left - 8} y={p.ys(v)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tnum">
                            {v}
                          </text>
                        )}
                      </g>
                    ))}
                    {p.thresholds.filter((th) => th.v > p.d0 && th.v < p.d1).map((th) => (
                      <g key={th.v}>
                        <line x1={M.left} x2={M.left + plotW} y1={p.ys(th.v)} y2={p.ys(th.v)} stroke="var(--axis)" />
                        <text x={M.left + plotW + 8} y={p.ys(th.v)} dy="0.32em" className="fill-ink-2 text-[11px]">{th.label}</text>
                      </g>
                    ))}
                    {p.bars ? pts.map((r) => {
                      const y = p.ys(r[p.key]!);
                      const hgt = p.top + p.height - y;
                      if (hgt <= 0) return null;
                      const rr = Math.min(2, barW / 2, hgt);
                      const x = xs(r.t) - barW / 2;
                      return (
                        <path key={r.t} fill="var(--accent)" fillOpacity={hover !== null && timeline[hover].t === r.t ? 1 : 0.85}
                          d={`M${x},${p.top + p.height}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + barW - rr}Q${x + barW},${y} ${x + barW},${y + rr}V${p.top + p.height}Z`} />
                      );
                    }) : (
                      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                    )}
                    {h && h[p.key] !== null && !p.bars && (
                      <circle cx={xs(h.t)} cy={p.ys(h[p.key]!)} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
                    )}
                  </g>
                );
              })}
              {/* the run, marked under the axis where no title or line can collide with it */}
              <rect x={xs(runStart)} y={plotBottom + 30} width={Math.max(3, xs(runEnd) - xs(runStart))} height={3} rx={1.5}
                fill="var(--accent)" />
              <text x={xs(runStart) > M.left + plotW - 80 ? xs(runEnd) : xs(runStart)} y={plotBottom + 46}
                textAnchor={xs(runStart) > M.left + plotW - 80 ? "end" : "start"} className="fill-accent-ink text-[11px] font-medium">
                {label}, {fmtTime(runStart, tz)} to {fmtTime(runEnd, tz)}
              </text>
              {/* x axis */}
              {ticks.map((t) => (
                <text key={t.t} x={xs(t.t)} y={plotBottom + 18} textAnchor={t.edge ? "start" : "middle"}
                  className={`text-[11px] tnum ${t.major ? "fill-ink-2 font-medium" : "fill-muted"}`}>
                  {t.label}
                </text>
              ))}
              {h && (
                <line x1={xs(h.t)} x2={xs(h.t)} y1={plotTop} y2={plotBottom} stroke="var(--ink-2)" strokeOpacity={0.5} />
              )}
            </svg>
          )}
          {h && (
            <Tooltip x={xs(h.t)} y={plotTop} containerWidth={width}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="font-medium text-ink">{fmtDayTime(h.t, tz)}</span>
                {inRun(h.t) && <span className="text-xs font-medium text-accent-ink">{label.toLowerCase()}</span>}
              </div>
              <TipRow value={`${fmt(h.pm25)} µg/m³`} label="PM2.5" />
              <TipRow value={`${fmt(h.apparentTempC, 1)}°C`} label="Feels like" />
              <TipRow value={fmt(h.uvIndex, 1)} label="UV index" />
              <TipRow value={`${fmt(h.precipProbPct)}%`} label="Chance of rain" />
              {h.weatherCode !== null && <div className="mt-1.5 text-xs text-ink-2">{WMO_CODES[h.weatherCode]}</div>}
            </Tooltip>
          )}
        </div>
        </div>
      )}
    </Card>
  );
}
