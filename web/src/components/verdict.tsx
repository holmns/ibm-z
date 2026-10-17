"use client";

import { useEffect, useState, type ReactNode } from "react";
import { HEAT_HOT, HEAT_VERY_HOT, RAIN_ELEVATED, UV_HIGH } from "@/lib/factors";
import { fmt } from "@/lib/format";
import { hazeWarning } from "@/lib/haze";
import { LEVEL_RANK, LEVELS, neaBand, type Level } from "@/lib/risk";
import { describePlan, isActivityPlan, noun } from "@/lib/session";
import { fmtDayTime, fmtTime } from "@/lib/time";
import type { AssessResponse, OptionRow, SummaryFacts } from "@/lib/types";
import { RangeStrip, ZoneMeter } from "./meters";
import { Card, StatusIcon, StatusPill } from "./ui";

type FactorKey = "air" | "heat" | "uv" | "rain";
const FACTOR_NAMES: Record<FactorKey, string> = { air: "personal air quality", heat: "heat", uv: "UV", rain: "rain" };

export function factorLevels(r: AssessResponse): Record<FactorKey, Level> {
  const p = r.planned;
  return { air: p.pmLevel, ...p.factors.parts };
}

function joinNames(keys: FactorKey[]) {
  const names = keys.map((k) => FACTOR_NAMES[k]);
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// "Band II Elevated" -> "elevated"
const neaWord = (pm: number) => neaBand(pm).replace(/^Band [IV]+ /, "").toLowerCase();

export const CAMS_NOTE = "Google's air quality data is unavailable, so PM2.5 comes from the CAMS model, which reads low in haze.";

export function Caution({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 flex gap-2 text-[13px] leading-5 text-ink">
      <span className="mt-0.5"><StatusIcon level="Medium" size={15} /></span>
      <span>{children}</span>
    </p>
  );
}

function suggestion(r: AssessResponse): { text: string; option?: OptionRow } {
  const planned = r.planned;
  const n = noun(r.plan);
  const activity = isActivityPlan(r.plan);
  const alts = r.options.filter((o) => o.kind !== "planned" && o.kind !== "skip");
  // the lowest level, then the option nearest the planned start, so tomorrow beats a better day later in the week
  const gap = (o: OptionRow) => Math.abs(o.start - planned.start);
  const best = [...alts].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || gap(a) - gap(b) || a.runUg - b.runUg)[0];
  if (planned.level === "Low") return { text: "Good to go. Nothing in the forecast calls for a change." };
  if (best && LEVEL_RANK[best.level] < LEVEL_RANK[planned.level]) {
    const what = best.kind === "best-start" ? `Starting ${fmtDayTime(best.start, r.timezone)}`
      : best.kind === "shorter" ? (activity ? "Halving the time" : "Running half the distance")
        : best.kind === "easier" && isActivityPlan(best.plan) ? `Dropping to ${best.plan.intensity} intensity`
          : "Slowing down by 1 min/km";
    return { text: `${what} brings it down to ${best.level}.`, option: best };
  }
  if (r.skip.level === "High") {
    return { text: `Even without the ${n}, today's air scores High. Train indoors or pick another day.` };
  }
  const levels = factorLevels(r);
  const holding = (["heat", "uv", "rain"] as const).filter((k) => levels[k] === planned.level);
  if (holding.length) {
    return {
      text: `${cap(joinNames(holding))} keeps every start in the forecast at ${planned.level} or above. ` +
        "A shaded or indoor venue helps more than a new time.",
    };
  }
  return {
    text: `No start in the forecast scores lower than ${planned.level}. ` +
      `Halving the ${activity ? "time" : "distance"} cuts the ${n}'s dose to ${fmt(planned.runUg / 2)} µg.`,
  };
}

function summaryFacts(r: AssessResponse, drivers: FactorKey[], suggestionText: string, caveat: string | null): SummaryFacts {
  const p = r.planned;
  const f = p.factors;
  const levels = factorLevels(r);
  const [lowCut, highCut] = LEVELS[r.group].map(([top]) => top);
  return {
    level: p.level, raisedBy: p.level === "Low" ? [] : drivers.map((k) => FACTOR_NAMES[k]), activity: noun(r.plan),
    plan: describePlan(r.plan, r.activity), place: r.place.name,
    when: `${fmtDayTime(p.start, r.timezone)} to ${fmtTime(p.end, r.timezone)}`, thresholds: r.group,
    air: {
      level: levels.air, dayPm25: `${fmt(p.cEq)} µg/m³`, lowBelow: `${fmt(lowCut, lowCut % 1 ? 1 : 0)} µg/m³`,
      highFrom: `${fmt(highCut)} µg/m³`, sessionAvgPm25: `${fmt(p.runPmMean)} µg/m³`,
      neaRating: neaWord(p.runPmMaxHour),
    },
    heat: { level: levels.heat, feelsLike: f.apparentTempC === null ? null : `${fmt(f.apparentTempC, 1)}°C` },
    uv: { level: levels.uv, index: f.uvIndex === null ? null : fmt(f.uvIndex, f.uvIndex % 1 ? 1 : 0) },
    rain: {
      level: levels.rain, chanceOfRain: f.precipProbPct === null ? null : `${fmt(f.precipProbPct)}%`,
      thunderstormForecast: f.thunderstorm,
    },
    dose: { duringSession: `${fmt(p.runUg)} µg`, addedToDay: `${fmt(p.runUg + p.restUg - r.skip.ug)} µg` },
    suggestion: suggestionText, forecastCaveat: caveat,
  };
}

// a language model's read of the facts on the card, in place of the plain "Raised by" line; a placeholder of the
// same two lines holds the space while it's written, and the plain line comes back if it fails
function Summary({ facts, fallback }: { facts: SummaryFacts; fallback: string }) {
  const body = JSON.stringify({ facts });
  const [done, setDone] = useState<{ body: string; text: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/summary", { method: "POST", headers: { "content-type": "application/json" }, body })
      .then((res) => (res.ok ? res.json() : null))
      .then((b) => live && setDone({ body, text: typeof b?.summary === "string" ? b.summary : null }))
      .catch(() => live && setDone({ body, text: null }));
    return () => {
      live = false;
    };
  }, [body]);
  if (done?.body !== body) {
    return (
      <div className="mt-3 max-w-[66ch]" aria-busy="true" aria-label="Writing a summary">
        {["w-full", "w-3/5"].map((w) => (
          <div key={w} className="flex h-6 items-center"><div className={`h-3.5 ${w} animate-pulse rounded bg-surface-2`} /></div>
        ))}
      </div>
    );
  }
  return done.text
    ? <p className="mt-3 max-w-[66ch] text-[15px] leading-6 text-ink">{done.text}</p>
    : <p className="mt-3 text-sm leading-5 text-ink">{fallback}</p>;
}

function FactorCell({ title, level, value, unit, caption, meter, children }: {
  title: string; level: Level; value: string; unit: string; caption: string; meter: ReactNode; children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 bg-surface px-5 py-4 sm:px-6">
      {/* four across, "Personal air quality" takes two lines, so every header does and the values line up */}
      <div className="flex items-center justify-between gap-2 xl:min-h-10">
        <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
        <StatusPill level={level} size="sm" />
      </div>
      <div>
        <div className="flex items-baseline gap-1">
          <span className="text-[26px] leading-8 font-semibold tracking-[-0.01em] text-ink">{value}</span>
          {unit && <span className="text-sm text-ink-2">{unit}</span>}
        </div>
        <div className="text-xs text-ink-2">{caption}</div>
      </div>
      {meter}
      <p className="text-[13px] leading-5 text-ink-2">{children}</p>
    </div>
  );
}

export function Verdict({ r, onApply }: { r: AssessResponse; onApply: (o: OptionRow) => void }) {
  const p = r.planned;
  const f = p.factors;
  const s = suggestion(r);
  const n = noun(r.plan);
  const levels = factorLevels(r);
  const drivers = (Object.keys(levels) as FactorKey[]).filter((k) => levels[k] === p.level);
  const [lowCut, highCut] = LEVELS[r.group].map(([top]) => top);
  const pmMax = Math.max(highCut * 4 / 3, r.band.p90.cEq * 1.1, p.cEq * 1.1);
  const haze = hazeWarning(r, p.start);

  return (
    <Card className="overflow-hidden">
      <div className="px-5 pt-5 pb-4 sm:px-6">
        <div className="flex items-center gap-3">
          <StatusIcon level={p.level} size={34} />
          <h1 className="text-[34px] leading-none font-semibold tracking-[-0.02em] text-ink">{p.level} risk</h1>
        </div>
        <Summary facts={summaryFacts(r, drivers, s.text, haze)}
          fallback={p.level === "Low" ? "Nothing in the forecast raises it." : `Raised by ${joinNames(drivers)}.`} />
        <p className="mt-1 text-sm leading-5 text-ink-2">
          {r.place.name}, {fmtDayTime(p.start, r.timezone)} to {fmtTime(p.end, r.timezone)}.{" "}
          {describePlan(r.plan, r.activity)}
          {r.group === "vulnerable" ? ", with the stricter levels for vulnerable groups." : "."}
        </p>
        {r.pmSource === "cams" && <Caution>{CAMS_NOTE}</Caution>}
        {haze && <Caution>{haze}</Caution>}
      </div>

      {/* hairlines between cells at every breakpoint: the grid's 1px gaps show its border-coloured background */}
      <div className="grid gap-px border-t border-line bg-[var(--border)] sm:grid-cols-2 xl:grid-cols-4">
        <FactorCell title="Personal air quality" level={levels.air} value={fmt(p.cEq)} unit="µg/m³" caption={`Your day's PM2.5, ${n} included`}
          meter={<ZoneMeter label={`Your day's PM2.5 ${fmt(p.cEq)} µg/m³`} domain={[0, pmMax]} value={p.cEq}
            band={[r.band.p10.cEq, r.band.p90.cEq]}
            zones={[{ to: lowCut, level: "Low" }, { to: highCut, level: "Medium" }, { to: Infinity, level: "High" }]}
            ticks={[{ v: lowCut, label: fmt(lowCut, lowCut % 1 ? 1 : 0) }, { v: highCut, label: fmt(highCut) }]} />}>
          {`Air during the ${n} averages ${fmt(p.runPmMean)} µg/m³, which NEA rates ${neaWord(p.runPmMaxHour)}.`}
        </FactorCell>

        <FactorCell title="Heat" level={levels.heat} value={fmt(f.apparentTempC, 1)} unit="°C" caption="Feels like, at its hottest"
          meter={f.apparentTempC !== null && (
            <ZoneMeter label={`Feels like ${fmt(f.apparentTempC, 1)}°C`} domain={[26, 40]} value={f.apparentTempC}
              zones={[{ to: HEAT_HOT, level: "Low" }, { to: HEAT_VERY_HOT, level: "Medium" }, { to: Infinity, level: "High" }]}
              ticks={[{ v: HEAT_HOT, label: `${HEAT_HOT}°` }, { v: HEAT_VERY_HOT, label: `${HEAT_VERY_HOT}°` }]} />
          )}>
          {f.apparentTempC === null ? "No forecast for these hours."
            : levels.heat === "High" ? "Very hot for hard exercise. Heat strain comes on fast."
              : levels.heat === "Medium" ? "Hot. Expect to slow down and sweat more than usual."
                : `Under ${HEAT_HOT}°C, where heat starts to count.`}
        </FactorCell>

        <FactorCell title="UV" level={levels.uv} value={fmt(f.uvIndex, f.uvIndex !== null && f.uvIndex % 1 ? 1 : 0)} unit=""
          caption="UV index, at its highest"
          meter={f.uvIndex !== null && (
            <ZoneMeter label={`UV index ${fmt(f.uvIndex, 1)}`} domain={[0, 12]} value={f.uvIndex}
              zones={[{ to: UV_HIGH, level: "Low" }, { to: Infinity, level: f.combo ? "High" : "Medium" }]}
              ticks={[{ v: UV_HIGH, label: String(UV_HIGH) }]} />
          )}>
          {f.uvIndex === null ? "No forecast for these hours."
            : f.combo ? "Strong sun with rain likely too. Together they make it High."
              : f.uvIndex < 1 ? `The sun is down or weak for the whole ${n}.`
                : f.uvIndex < UV_HIGH ? "Moderate sun." : "Strong sun. Cover up and use sunscreen."}
        </FactorCell>

        <FactorCell title="Rain" level={levels.rain} value={fmt(f.precipProbPct)} unit="%" caption="Chance of rain, at its highest"
          meter={f.precipProbPct !== null && (
            <ZoneMeter label={`${fmt(f.precipProbPct)}% chance of rain`} domain={[0, 100]} value={f.precipProbPct}
              zones={[{ to: RAIN_ELEVATED, level: "Low" }, { to: Infinity, level: f.combo ? "High" : "Medium" }]}
              ticks={[{ v: RAIN_ELEVATED, label: `${RAIN_ELEVATED}%` }]} />
          )}>
          {f.precipProbPct === null ? "No forecast for these hours."
            : f.combo ? "Rain likely while the sun is strong. Together they make it High."
              : f.precipProbPct >= 70 ? "Rain is very likely." : f.precipProbPct >= RAIN_ELEVATED ? "Rain is likely."
                : "Rain is unlikely."}
          {f.thunderstorm && " A thunderstorm is forecast, so check NEA lightning alerts."}
        </FactorCell>
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

function Swatch({ color, opacity = 1 }: { color: string; opacity?: number }) {
  return <span className="inline-block size-2.5 shrink-0 rounded-[2px]" style={{ background: color, opacity }} />;
}

function DayBar({ label, parts, total, max }: {
  label: string; parts: { v: number; color: string; opacity?: number }[]; total: number; max: number;
}) {
  const shown = parts.filter((x) => x.v > 0);
  return (
    <>
      <span className="text-[13px] text-ink-2">{label}</span>
      <div className="flex h-4 gap-0.5" role="img" aria-label={`${label}, ${fmt(total)} µg`}>
        {shown.map((x, i) => (
          <div key={i} className={`h-full ${i === shown.length - 1 ? "rounded-r" : ""}`}
            style={{ width: `${(x.v / max) * 100}%`, minWidth: 2, background: x.color, opacity: x.opacity ?? 1 }} />
        ))}
      </div>
      <span className="text-right text-sm font-semibold text-ink tnum">{fmt(total)} µg</span>
    </>
  );
}

export function DoseCard({ r }: { r: AssessResponse }) {
  const p = r.planned;
  const n = noun(r.plan);
  const activity = isActivityPlan(r.plan);
  const minutes = Math.round(p.ve.minutes);
  const restingLmin = (p.vDayM3 / 1440) * 1000;
  const withRun = p.runUg + p.restUg;
  const atRest = Math.max(0, r.skip.ugInRunSlot);
  const max = Math.max(withRun, r.skip.ug, 1);
  const REST = "var(--muted)";
  return (
    <Card>
      <div className="px-5 pt-4 pb-1 sm:px-6">
        <h2 className="text-[15px] font-semibold leading-6 text-ink">PM2.5 you breathe in</h2>
      </div>
      <div className="grid gap-x-10 gap-y-6 px-5 pt-3 pb-5 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)]">
        <div>
          <div className="text-[13px] text-ink-2">During the {n}</div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-[30px] leading-9 font-semibold tracking-[-0.01em] text-ink">{fmt(p.runUg)}</span>
            <span className="text-sm text-ink-2">µg</span>
          </div>
          <div className="mt-2 max-w-80">
            <RangeStrip lo={r.band.p10.runUg} hi={r.band.p90.runUg} value={p.runUg} unit=" µg"
              label={`Likely between ${fmt(r.band.p10.runUg)} and ${fmt(r.band.p90.runUg)} µg`} />
          </div>
          <p className="mt-3 text-[13px] leading-5 text-ink-2">
            You breathe {fmt(p.veUsed)} litres a minute {activity ? "during the session" : "while running"}, about {fmt(p.veUsed / restingLmin)} times your
            average over a day{r.group === "vulnerable" ? ". Vulnerable settings take the high end of the likely range" : ""}.
          </p>
        </div>
        <div>
          <div className="text-[13px] text-ink-2">Your whole day</div>
          <div className="mt-2.5 grid grid-cols-[6.5rem_minmax(0,1fr)_4.5rem] items-center gap-x-3 gap-y-2.5">
            <DayBar label={`With the ${n}`} total={withRun} max={max}
              parts={[{ v: p.restUg, color: REST }, { v: p.runUg, color: "var(--accent)" }]} />
            <DayBar label="If you skip it" total={r.skip.ug} max={max}
              parts={[{ v: p.restUg, color: REST }, { v: atRest, color: "var(--accent)", opacity: 0.35 }]} />
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2 tnum">
            <span className="inline-flex items-center gap-1.5"><Swatch color={REST} />Rest of the day, {fmt(p.restUg)} µg</span>
            <span className="inline-flex items-center gap-1.5"><Swatch color="var(--accent)" />Your {n}, {fmt(p.runUg)} µg</span>
            <span className="inline-flex items-center gap-1.5">
              <Swatch color="var(--accent)" opacity={0.35} />Same {minutes} min at rest, {fmt(atRest)} µg
            </span>
          </div>
          <p className="mt-3 text-[13px] leading-5 text-ink-2">
            The {n} adds <span className="font-semibold text-ink">{fmt(withRun - r.skip.ug)} µg</span> to your day. That&apos;s
            the {fmt(p.runUg)} µg you breathe {activity ? "in the session" : "running"}, less the {fmt(atRest)} µg you&apos;d breathe anyway sitting out
            those {minutes} minutes.
          </p>
        </div>
      </div>
    </Card>
  );
}
