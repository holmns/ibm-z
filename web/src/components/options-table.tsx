"use client";

import { fmt } from "@/lib/format";
import { isActivityPlan, type SessionPlan } from "@/lib/session";
import { fmtDayTime } from "@/lib/time";
import type { AssessResponse, OptionRow } from "@/lib/types";
import { Card, CardHeader, StatusPill } from "./ui";

export function OptionsTable({ r, onApply }: { r: AssessResponse; onApply: (o: OptionRow) => void }) {
  const key = (p: SessionPlan | null) => (!p ? "" : isActivityPlan(p) ? `${p.code}|${p.intensity}|${p.minutes}` : `${p.pace}|${p.distanceKm}`);
  const same = (o: OptionRow) => o.start === r.planned.start && key(o.plan) === key(r.plan);
  const activity = isActivityPlan(r.plan);
  return (
    <Card>
      <CardHeader
        title="Ways to change the plan"
        subtitle={activity
          ? "Timing moves the score the most. A shorter or lighter session lowers its own dose, but most of the day's air is breathed outside it. Best start is the lowest level on each day between 05:00 and 21:00, then the lowest dose."
          : "Timing moves the score the most. Slowing down barely helps, because a slower run lasts longer. Best start is the lowest level on each day between 05:00 and 21:00, then the lowest dose."}
      />
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full min-w-[780px] text-[13px] tnum [&_th]:whitespace-nowrap">
          <thead className="text-left text-ink-2">
            <tr className="border-b border-line">
              <th className="py-2 pr-3 pl-5 font-medium">Option</th>
              <th className="px-2.5 py-2 text-right font-medium">Inhaled µg</th>
              <th className="px-2.5 py-2 text-right font-medium">vs planned</th>
              <th className="px-2.5 py-2 text-right font-medium">Day-equivalent</th>
              <th className="px-2.5 py-2 font-medium">PM2.5</th>
              <th className="px-2.5 py-2 font-medium">Heat, UV, rain</th>
              <th className="px-2.5 py-2 font-medium">Overall</th>
              <th className="py-2 pr-5 pl-3" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {r.options.map((o) => (
              <tr key={o.key} className={`border-b border-line last:border-0 ${o.kind === "planned" ? "bg-surface-2" : ""}`}>
                <td className="py-2 pr-3 pl-5">
                  <div className="font-medium text-ink">{o.label}</div>
                  <div className="text-xs whitespace-nowrap text-ink-2">
                    {o.kind === "skip" ? "Only the day's air counts"
                      : `${fmtDayTime(o.start, r.timezone)}, ${fmt(o.minutes)} min, ${fmt(o.veLmin, 1)} L/min`}
                  </div>
                </td>
                <td className="px-2.5 py-2 text-right text-ink">{fmt(o.runUg)}</td>
                <td className="px-2.5 py-2 text-right text-ink-2">
                  {o.kind === "planned" ? "" : `${o.vsPlannedUg > 0 ? "+" : o.vsPlannedUg < 0 ? "−" : ""}${fmt(Math.abs(o.vsPlannedUg))}`}
                </td>
                <td className="px-2.5 py-2 text-right text-ink">{fmt(o.cEq, 1)}</td>
                <td className="px-2.5 py-2"><StatusPill level={o.pmLevel} size="sm" /></td>
                <td className="px-2.5 py-2">
                  {o.factorsLevel ? <StatusPill level={o.factorsLevel} size="sm" /> : <span className="text-ink-2">not outside</span>}
                </td>
                <td className="px-2.5 py-2"><StatusPill level={o.level} size="sm" /></td>
                <td className="py-2 pr-5 pl-3 text-right">
                  {o.kind !== "planned" && o.kind !== "skip" && same(o) && <span className="text-xs text-ink-2">planned</span>}
                  {o.kind !== "planned" && o.kind !== "skip" && !same(o) && (
                    <button type="button" onClick={() => onApply(o)}
                      className="rounded px-1 text-[13px] font-medium text-accent-ink hover:underline focus-visible:outline-2 focus-visible:outline-accent">
                      Plan
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
