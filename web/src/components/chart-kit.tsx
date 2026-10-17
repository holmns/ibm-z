"use client";

import { useCallback, useState, type ReactNode } from "react";
import { fmtWeekday, startOfLocalDay, wallParts } from "@/lib/time";

// shared geometry so the conditions chart and the start-time chart line up when stacked
export const M = { left: 44, right: 72 };

// a callback ref, so a chart unmounted by the table toggle is measured again when it comes back
export function useWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(0);
  const ref = useCallback((el: T | null) => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function linear(d0: number, d1: number, r0: number, r1: number) {
  const k = (r1 - r0) / (d1 - d0 || 1);
  return (v: number) => r0 + (v - d0) * k;
}

// 0 plus round steps up to max, about `count` of them
export function niceTicks(max: number, count = 3) {
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

export type TimeTick = { t: number; label: string; major: boolean; edge?: boolean };

// local midnights (weekday label) and, when there's room, noons
export function timeTicks(t0: number, t1: number, tz: string, pxPerHour: number): TimeTick[] {
  const ticks: TimeTick[] = [];
  for (let d = startOfLocalDay(t0, tz); d <= t1 + 86400; d += 86400) {
    // re-anchor each step so DST days stay on midnight
    const mid = startOfLocalDay(d + 3 * 3600, tz);
    if (mid >= t0 && mid <= t1) ticks.push({ t: mid, label: `${fmtWeekday(mid, tz)} ${wallParts(mid, tz).day}`, major: true });
    const noon = mid + 12 * 3600;
    if (pxPerHour * 12 >= 40 && noon >= t0 && noon <= t1) ticks.push({ t: noon, label: "12:00", major: false });
  }
  // label the partial first day too, unless its midnight is close
  const firstMidnight = ticks.find((t) => t.major);
  if (!firstMidnight || (firstMidnight.t - t0) * pxPerHour / 3600 > 56) {
    ticks.push({ t: t0, label: `${fmtWeekday(t0, tz)} ${wallParts(t0, tz).day}`, major: true, edge: true });
  }
  return ticks.sort((a, b) => a.t - b.t);
}

// sits right of the pointer, or left of it on the right half so it never runs off the card
export function Tooltip({ x, y, containerWidth, children }: { x: number; y: number; containerWidth: number; children: ReactNode }) {
  const flip = x > containerWidth / 2;
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 w-max min-w-44 max-w-64 rounded-lg border border-line bg-surface px-3 py-2.5 text-[13px] shadow-[0_8px_24px_rgba(11,11,11,0.14)]"
      style={flip ? { right: containerWidth - x + 14, top: y } : { left: x + 14, top: y }}
    >
      {children}
    </div>
  );
}

export function TipRow({ value, label }: { value: ReactNode; label: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 leading-5">
      <span className="font-semibold text-ink tnum">{value}</span>
      <span className="text-ink-2">{label}</span>
    </div>
  );
}
