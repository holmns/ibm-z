"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { defaultForm, defaultStart, startInstant, toRequest, type FormState } from "@/lib/form";
import { fmtDayTime, localDateKey, pad, wallParts } from "@/lib/time";
import type { AssessResponse, OptionRow, VenuesRequest } from "@/lib/types";
import { ConditionsChart } from "./conditions-chart";
import { Notes } from "./notes";
import { OptionsTable } from "./options-table";
import { PlanForm } from "./plan-form";
import { StartTimesChart } from "./start-times-chart";
import { Card, Spinner } from "./ui";
import { Venues, type VenuesState } from "./venues";
import { StatTiles, Verdict } from "./verdict";

const STORAGE_KEY = "hazewise.plan.v1";

function loadSaved(): FormState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = { ...defaultForm(), ...JSON.parse(raw) } as FormState;
    // a saved start in the past falls back to tonight
    const t = startInstant(saved);
    return t === null || t < Date.now() / 1000 - 1800 ? { ...saved, ...defaultStart() } : saved;
  } catch {
    return null;
  }
}

function save(f: FormState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(f));
  } catch {}
}

export function Dashboard() {
  // rendered on the client only (see dashboard-loader), so saved inputs can seed the first render
  const [form, setForm] = useState<FormState>(() => loadSaved() ?? defaultForm());
  const [result, setResult] = useState<AssessResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [venues, setVenues] = useState<VenuesState>({ status: "loading" });
  const [lastKey, setLastKey] = useState<string | null>(null);
  const seq = useRef(0);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const run = useCallback(async (f: FormState) => {
    const req = toRequest(f);
    if ("error" in req) {
      setError(req.error);
      return;
    }
    const id = ++seq.current;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/assess", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req),
      });
      const body = await res.json();
      if (id !== seq.current) return;
      if (!res.ok) {
        setError(body.error ?? "Something went wrong.");
        return;
      }
      const r = body as AssessResponse;
      setResult(r);
      setLastKey(JSON.stringify(req));
      save(f);
      setVenues({ status: "loading" });
      const vreq: VenuesRequest = {
        lat: f.place.lat, lon: f.place.lon, start: r.planned.start, plan: req.plan, person: req.person,
        history: req.history, group: req.group, indoorRatio: req.indoorRatio,
        preferIndoor: r.planned.level !== "Low" || (r.planned.factors.precipProbPct ?? 0) >= 50,
      };
      fetch("/api/venues", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(vreq) })
        .then(async (vr) => {
          const vb = await vr.json();
          if (id !== seq.current) return;
          setVenues(vr.ok ? { status: "done", venues: vb.venues, preferIndoor: vb.preferIndoor }
            : { status: "error", message: vb.error ?? "Venue data is unavailable right now." });
        })
        .catch(() => id === seq.current && setVenues({ status: "error", message: "Venue data is unavailable right now." }));
    } catch {
      if (id === seq.current) setError("Could not reach the server. Check your connection and try again.");
    } finally {
      if (id === seq.current) setPending(false);
    }
  }, []);

  const initial = useRef(form);
  useEffect(() => {
    run(initial.current);
  }, [run]);

  const withStart = (f: FormState, t: number, tz: string): FormState => {
    const p = wallParts(t, tz);
    return { ...f, day: localDateKey(t, tz), time: `${pad(p.hour)}:${pad(p.minute)}` };
  };

  const pickStart = (t: number) => {
    if (!result) return;
    const f = withStart(form, t, result.timezone);
    setForm(f);
    run(f);
  };

  const apply = (o: OptionRow) => {
    if (!result || !o.plan) return;
    const f = withStart({ ...form, pace: o.plan.pace, distanceKm: String(o.plan.distanceKm) }, o.start, result.timezone);
    setForm(f);
    run(f);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="mx-auto w-full max-w-[1320px] px-4 py-5 sm:px-6 sm:py-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <div className="flex items-baseline gap-3">
          <span className="text-lg font-semibold tracking-[-0.01em] text-ink">HazeWise</span>
          <span className="text-sm text-ink-2">Run risk planner</span>
        </div>
        {result && (
          <span className="text-xs text-ink-2">
            Forecast fetched {fmtDayTime(result.fetchedAt, result.timezone)}, {result.timezone.replace("_", " ")} time
          </span>
        )}
      </header>
      <div className="grid items-start gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside>
          <PlanForm form={form} set={set} onSubmit={() => run(form)} pending={pending}
            dirty={result !== null && lastKey !== null && JSON.stringify(toRequest(form)) !== lastKey} />
        </aside>
        <main className="min-w-0 space-y-4">
          {error && (
            <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-[var(--critical)]/40 bg-[var(--critical-wash)] px-4 py-3 text-sm text-ink">
              <svg width="16" height="16" viewBox="0 0 16 16" className="mt-0.5 shrink-0" aria-hidden>
                <circle cx="8" cy="8" r="7.5" fill="var(--critical)" />
                <path d="M8 4.5v4.2" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
                <circle cx="8" cy="11.3" r="1" fill="#fff" />
              </svg>
              <span>{error}</span>
            </div>
          )}
          {!result && !error && (
            <Card className="flex items-center gap-2.5 px-5 py-6 text-sm text-ink-2">
              <Spinner />
              Checking the forecast for {form.place.name}
            </Card>
          )}
          {result && (
            <div className={`space-y-4 transition-opacity duration-200 ${pending ? "pointer-events-none opacity-55" : ""}`}>
              <Verdict r={result} onApply={apply} />
              <StatTiles r={result} />
              <ConditionsChart timeline={result.timeline} tz={result.timezone} runStart={result.planned.start}
                runEnd={result.planned.end} placeName={result.place.name} />
              <StartTimesChart byStart={result.byStart} t0={result.timeline[0].t} t1={result.timeline[result.timeline.length - 1].t}
                tz={result.timezone} planned={result.planned.start} plannedLevel={result.planned.level} onPick={pickStart} />
              <OptionsTable r={result} onApply={apply} />
              <Venues state={venues} />
              <Notes r={result} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
