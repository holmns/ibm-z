"use client";

import { factorReasonText, fmt, pmReasonText } from "@/lib/format";
import { LEVEL_RANK, neaBand } from "@/lib/risk";
import { fmtDayTime, fmtTime } from "@/lib/time";
import type { AssessResponse, OptionRow } from "@/lib/types";
import { Card, StatusIcon, StatusPill } from "./ui";

function suggestion(r: AssessResponse): { text: string; option?: OptionRow } {
  const planned = r.planned;
  const alts = r.options.filter((o) => o.kind !== "planned" && o.kind !== "skip");
  // the lowest level, then the option nearest the planned start, so tomorrow beats a better day later in the week
  const gap = (o: OptionRow) => Math.abs(o.start - planned.start);
  const best = [...alts].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || gap(a) - gap(b) || a.runUg - b.runUg)[0];
  if (planned.level === "Low") return { text: "Good to go. Nothing in the forecast calls for a change." };
  if (best && LEVEL_RANK[best.level] < LEVEL_RANK[planned.level]) {
    const what = best.kind === "best-start" ? `Starting ${fmtDayTime(best.start, r.timezone)}`
      : best.kind === "shorter" ? "Running half the distance" : "Slowing down by 1 min/km";
    return { text: `${what} brings it down to ${best.level}.`, option: best };
  }
  if (r.skip.level === "High") {
    return { text: "Even without the run, today's air scores High. Train indoors or pick another day." };
  }
  // name what holds the level up: shortening only helps when PM2.5 is the reason
  if (LEVEL_RANK[planned.factors.level] >= LEVEL_RANK[planned.pmLevel]) {
    const kinds = planned.factors.reasons.map((x) => x.kind);
    const what = kinds.includes("heat") ? "Heat" : kinds.includes("uv") ? "UV" : "Rain";
    return { text: `${what} keeps every start in the forecast at ${planned.level} or above. A shaded or indoor venue helps more than a new time.` };
  }
  return {
    text: `No start in the forecast scores lower than ${planned.level}. ` +
      `Halving the distance cuts the run's dose to ${fmt(planned.runUg / 2)} µg.`,
  };
}

export function Verdict({ r, onApply }: { r: AssessResponse; onApply: (o: OptionRow) => void }) {
  const p = r.planned;
  const f = p.factors;
  const s = suggestion(r);
  const factorValues = [
    f.apparentTempC !== null && `feels like ${fmt(f.apparentTempC, 1)}°C`,
    f.uvIndex !== null && `UV ${fmt(f.uvIndex, 1)}`,
    f.precipProbPct !== null && `${fmt(f.precipProbPct)}% chance of rain`,
  ].filter(Boolean).join(", ");

  return (
    <Card className="overflow-hidden">
      <div className="px-5 pt-5 pb-4 sm:px-6">
        <div className="flex items-center gap-3">
          <StatusIcon level={p.level} size={34} />
          <h1 className="text-[34px] leading-none font-semibold tracking-[-0.02em] text-ink">{p.level} risk</h1>
        </div>
        <p className="mt-3 text-sm leading-5 text-ink-2">
          {r.place.name}, {fmtDayTime(p.start, r.timezone)} to {fmtTime(p.end, r.timezone)}.{" "}
          {fmt(r.plan.distanceKm, r.plan.distanceKm % 1 ? 1 : 0)} km at {r.plan.pace} per km
          {r.group === "vulnerable" ? ", vulnerable thresholds." : "."}
        </p>
      </div>
      <div className="grid border-t border-line md:grid-cols-2">
        <div className="px-5 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[13px] font-semibold text-ink">PM2.5 breathed in</h2>
            <StatusPill level={p.pmLevel} size="sm" />
          </div>
          <ul className="mt-2 space-y-1 text-sm leading-5 text-ink">
            {p.pmReasons.map((x, i) => <li key={i}>{pmReasonText(x)}</li>)}
          </ul>
          <p className="mt-2 text-xs leading-[18px] text-ink-2">
            Air during the run averages {fmt(p.runPmMean)} µg/m³, worst hour {fmt(p.runPmMaxHour)}, NEA{" "}
            {neaBand(p.runPmMaxHour)}. The day averages {fmt(p.dayPmMean)}.
          </p>
        </div>
        <div className="border-t border-line px-5 py-4 sm:px-6 md:border-t-0 md:border-l">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[13px] font-semibold text-ink">Heat, UV and rain</h2>
            <StatusPill level={f.level} size="sm" />
          </div>
          <ul className="mt-2 space-y-1 text-sm leading-5 text-ink">
            {f.reasons.length ? f.reasons.map((x, i) => <li key={i}>{factorReasonText(x)}</li>)
              : <li>Nothing here raises the level.</li>}
          </ul>
          <p className="mt-2 text-xs leading-[18px] text-ink-2">
            Worst hour of the run{factorValues ? `, ${factorValues}` : ""}.
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-3 border-t border-line bg-surface-2 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-sm leading-5 text-ink">{s.text}</p>
        {s.option && (
          <button
            type="button"
            onClick={() => onApply(s.option!)}
            className="h-8 shrink-0 self-start rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink transition-colors hover:border-axis sm:self-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Plan this instead
          </button>
        )}
      </div>
    </Card>
  );
}

function Tile({ label, value, unit, children }: { label: string; value: string; unit: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5 shadow-[var(--shadow)]">
      <div className="text-[13px] text-ink-2">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-[26px] leading-8 font-semibold tracking-[-0.01em] text-ink">{value}</span>
        <span className="text-sm text-ink-2">{unit}</span>
      </div>
      <div className="mt-1 space-y-0.5 text-xs leading-[18px] text-ink-2">{children}</div>
    </div>
  );
}

export function StatTiles({ r }: { r: AssessResponse }) {
  const p = r.planned;
  const v = p.ve;
  const vulnerable = r.group === "vulnerable";
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Tile label="Inhaled during the run" value={fmt(p.runUg)} unit="µg">
        <div className="tnum">80% range {fmt(r.band.p10.runUg)} to {fmt(r.band.p90.runUg)}</div>
        <div>{fmt(p.runShareOfDay * 100)}% of the day&apos;s dose</div>
      </Tile>
      <Tile label="Day-equivalent PM2.5" value={fmt(p.cEq, 1)} unit="µg/m³">
        <div className="tnum">80% range {fmt(r.band.p10.cEq, 1)} to {fmt(r.band.p90.cEq, 1)}</div>
        <div>{fmt(p.hq, 1)} times the WHO daily guideline</div>
      </Tile>
      <Tile label="If you skip the run" value={fmt(r.skip.ug)} unit="µg">
        <div className="flex items-center gap-1.5"><StatusIcon level={r.skip.level} size={12} />{r.skip.level} from the day&apos;s air alone</div>
        {/* skipping still breathes through the run's hour at the ordinary rate, so this is less than the run's own dose */}
        <div>The run adds {fmt(p.runUg + p.restUg - r.skip.ug)} µg to the day</div>
      </Tile>
      <Tile label="Breathing during the run" value={fmt(p.veUsed, 1)} unit="L/min">
        <div className="tnum">
          {vulnerable ? "Top of the 80% range, " : "80% range "}
          {fmt(v.veP10, 1)} to {fmt(v.veP90, 1)}
        </div>
        <div>{fmt((p.veUsed * v.minutes) / 1000, 2)} m³ of air, model {v.variant}</div>
      </Tile>
    </div>
  );
}
