"use client";

import { useState } from "react";
import { fmt } from "@/lib/format";
import type { Level } from "@/lib/risk";
import { fmtDayTime } from "@/lib/time";
import type { StartOption } from "@/lib/types";
import { linear, M, niceTicks, timeTicks, TipRow, Tooltip, useWidth } from "./chart-kit";
import { Card, CardHeader, FACTOR_COLUMNS, LevelLegend, LevelMark, STATUS_COLOR, StatusIcon, StatusPill, TextButton } from "./ui";

const PLOT_H = 132;
const TOP = 30;
const AXIS_H = 30;

export function StartTimesChart({ byStart, t0, t1, tz, planned, plannedLevel, onPick, noun = "run" }: {
  byStart: StartOption[]; t0: number; t1: number; tz: string; planned: number; plannedLevel: Level;
  onPick: (start: number) => void; noun?: "run" | "session";
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const plotW = Math.max(0, width - M.left - M.right);
  const xs = linear(t0, t1, M.left, M.left + plotW);
  const pxPerHour = plotW / Math.max(1, (t1 - t0) / 3600);
  const maxUg = Math.max(...byStart.map((s) => s.runUg), 1);
  const yTicks = niceTicks(maxUg * 1.08, 3);
  const d1 = Math.max(maxUg * 1.22, yTicks[yTicks.length - 1]);
  const ys = linear(0, d1, TOP + PLOT_H, TOP);
  const base = TOP + PLOT_H;
  const barW = Math.max(2, Math.min(24, pxPerHour * 0.62));
  const ticks = timeTicks(t0, t1, tz, pxPerHour);
  const h = hover === null ? null : byStart[hover];
  const visible = byStart.filter((s) => s.start >= t0 && s.start <= t1);

  const markerX = xs(planned);
  // clear every bar under the label, which is ~50px wide whatever the hour spacing
  const reach = Math.max(2, 28 / Math.max(pxPerHour, 0.1)) * 3600;
  const near = byStart.filter((s) => Math.abs(s.start - planned) <= reach).map((s) => ys(s.runUg));
  const markerY = Math.max(TOP + 4, (near.length ? Math.min(...near) : base) - 8);

  return (
    <Card>
      <CardHeader
        title={`The same ${noun} at other start times`}
        subtitle={`Bar height is PM2.5 inhaled during the ${noun}. Colour is the overall level. Pick a bar to plan that start.`}
        action={<TextButton onClick={() => setTable((v) => !v)} pressed={table}>{table ? "Chart" : "Table"}</TextButton>}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 pb-1 text-[13px] text-ink-2">
        <LevelLegend />
        <span className="text-muted">Every hourly start within the PM2.5 forecast</span>
      </div>
      {table ? (
        <div className="mt-2 max-h-[420px] overflow-auto border-t border-line">
          <table className="w-full text-[13px] tnum">
            <thead className="sticky top-0 bg-surface text-left text-ink-2">
              <tr className="border-b border-line">
                {["Start", `${noun === "run" ? "Run" : "Session"} dose µg`, "Day's PM2.5 µg/m³", ...FACTOR_COLUMNS, "Overall", ""].map((c, i) => (
                  <th key={i} className={`py-2 font-medium whitespace-nowrap ${i === 1 || i === 2 ? "px-4 text-right"
                    : i >= 3 && i <= 6 ? "px-2 text-center" : "px-4"}`}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byStart.map((s) => (
                <tr key={s.start} className="border-b border-line last:border-0">
                  <td className="px-4 py-1.5 whitespace-nowrap">{fmtDayTime(s.start, tz)}</td>
                  <td className="px-4 py-1.5 text-right">{fmt(s.runUg)}</td>
                  <td className="px-4 py-1.5 text-right">{fmt(s.cEq, 1)}</td>
                  <td className="px-2 py-1.5 text-center"><LevelMark name="Personal air quality" level={s.pmLevel} /></td>
                  <td className="px-2 py-1.5 text-center"><LevelMark name="Heat" level={s.parts.heat} /></td>
                  <td className="px-2 py-1.5 text-center"><LevelMark name="UV" level={s.parts.uv} /></td>
                  <td className="px-2 py-1.5 text-center"><LevelMark name="Rain" level={s.parts.rain} /></td>
                  <td className="px-4 py-1.5"><StatusPill level={s.level} size="sm" /></td>
                  <td className="px-4 py-1.5 text-right">
                    {s.start === planned ? <span className="text-xs text-ink-2">planned</span> : (
                      <button type="button" onClick={() => onPick(s.start)}
                        className="text-[13px] font-medium text-accent-ink hover:underline">Plan</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-5 pb-4">
          <div ref={ref} className="relative" style={{ height: base + AXIS_H }}>
            {width > 0 && (
              <svg
                width={width}
                height={base + AXIS_H}
                role="img"
                aria-label={`PM2.5 inhaled during the ${noun} for each start time, coloured by overall risk level`}
                tabIndex={0}
                className="block outline-none"
                onPointerLeave={() => setHover(null)}
                onBlur={() => setHover(null)}
                onFocus={() => setHover(Math.max(0, byStart.findIndex((s) => s.start >= planned)))}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                    e.preventDefault();
                    const step = e.key === "ArrowRight" ? 1 : -1;
                    setHover((i) => Math.max(0, Math.min(byStart.length - 1, (i ?? 0) + step)));
                  } else if (e.key === "Enter" && h && h.start !== planned) {
                    onPick(h.start);
                  }
                }}
              >
                <text x={0} y={12} className="fill-ink text-[12px] font-semibold">
                  Inhaled during the {noun}<tspan className="fill-ink-2 font-normal">  µg</tspan>
                </text>
                {ticks.filter((t) => t.major && !t.edge).map((t) => (
                  <line key={t.t} x1={xs(t.t)} x2={xs(t.t)} y1={TOP} y2={base} stroke="var(--grid)" />
                ))}
                {yTicks.map((v) => (
                  <g key={v}>
                    <line x1={M.left} x2={M.left + plotW} y1={ys(v)} y2={ys(v)} stroke={v === 0 ? "var(--axis)" : "var(--grid)"} />
                    <text x={M.left - 8} y={ys(v)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tnum">{v}</text>
                  </g>
                ))}
                {visible.map((s) => {
                  const i = byStart.indexOf(s);
                  const x = xs(s.start) - barW / 2;
                  const y = ys(s.runUg);
                  const r = Math.min(4, barW / 2, base - y);
                  const active = hover === i;
                  return (
                    <g key={s.start}>
                      <path
                        d={`M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + barW - r}Q${x + barW},${y} ${x + barW},${y + r}V${base}Z`}
                        fill={STATUS_COLOR[s.level]}
                        fillOpacity={hover === null || active ? 1 : 0.55}
                      />
                      {/* hit target: the whole hour slot, full height */}
                      <rect
                        x={xs(s.start) - Math.max(pxPerHour, 8) / 2}
                        y={TOP}
                        width={Math.max(pxPerHour, 8)}
                        height={PLOT_H}
                        fill="transparent"
                        className={s.start === planned ? "" : "cursor-pointer"}
                        onPointerEnter={() => setHover(i)}
                        onClick={() => s.start !== planned && onPick(s.start)}
                      />
                    </g>
                  );
                })}
                <g pointerEvents="none">
                  <path d={`M${markerX - 5},${markerY - 7}h10l-5,7z`} fill="var(--ink-2)" />
                  <text x={markerX} y={markerY - 12} textAnchor={markerX > M.left + plotW - 30 ? "end" : markerX < M.left + 30 ? "start" : "middle"}
                    className="fill-ink-2 text-[11px] font-medium">Planned</text>
                </g>
                {ticks.map((t) => (
                  <text key={t.t} x={xs(t.t)} y={base + 18} textAnchor={t.edge ? "start" : "middle"}
                    className={`text-[11px] tnum ${t.major ? "fill-ink-2 font-medium" : "fill-muted"}`}>{t.label}</text>
                ))}
              </svg>
            )}
            {h && (
              <Tooltip x={xs(h.start)} y={TOP} containerWidth={width}>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <span className="font-medium text-ink">{fmtDayTime(h.start, tz)}</span>
                  <StatusPill level={h.level} size="sm" />
                </div>
                <TipRow value={`${fmt(h.runUg)} µg`} label={`breathed in on the ${noun}`} />
                <TipRow value={`${fmt(h.cEq, 1)} µg/m³`} label="your day's PM2.5" />
                <div className="mt-2 flex gap-3 text-xs text-ink-2">
                  {([["Air", h.pmLevel], ["Heat", h.parts.heat], ["UV", h.parts.uv], ["Rain", h.parts.rain]] as const).map(([n, l]) => (
                    <span key={n} className="inline-flex items-center gap-1"><StatusIcon level={l} size={12} />{n}</span>
                  ))}
                </div>
                <div className="mt-1.5 text-xs text-ink-2">
                  {h.start === planned ? "Your planned start"
                    : h.level === plannedLevel ? "Same level as planned. Select to plan it."
                      : "Select to plan this start"}
                </div>
              </Tooltip>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
