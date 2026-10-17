"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { applyLookup, defaultForm, defaultStart, needsLookup, startInstant, toRequest, type FormState } from "@/lib/form";
import { isActivityPlan, type ActivityLookup } from "@/lib/session";
import { fmtDayTime, localDateKey, pad, wallParts } from "@/lib/time";
import type { AssessResult, NotFoundResponse, OptionRow, VenuesRequest } from "@/lib/types";
import { ConditionsChart } from "./conditions-chart";
import { Notes } from "./notes";
import { OptionsTable } from "./options-table";
import { PlanForm } from "./plan-form";
import { StartTimesChart } from "./start-times-chart";
import { Card, Spinner } from "./ui";
import { Venues, type VenuesState } from "./venues";
import { StatTiles, Verdict } from "./verdict";

const STORAGE_KEY = "hazewise.plan.v2";

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

async function fetchLookup(text: string): Promise<ActivityLookup | { error: string }> {
  try {
    const res = await fetch("/api/activity", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }),
    });
    const body = await res.json();
    return res.ok ? (body as ActivityLookup) : { error: body.error ?? "The activity lookup failed." };
  } catch {
    return { error: "Could not reach the server to look up the activity." };
  }
}

// the activity text matched nothing: say so, and still show the forecast with the planned window
function NotFound({ r }: { r: NotFoundResponse }) {
  return (
    <>
      <Card className="px-5 py-5 sm:px-6">
        <h1 className="text-[22px] leading-7 font-semibold tracking-[-0.01em] text-ink">Activity not found</h1>
        <p className="mt-2 text-sm leading-5 text-ink-2">
          Nothing in the activity database matches “{r.query}”, so there is no breathing estimate, dose or risk level.
          The forecast for {r.place.name} below still applies. Try the sport&apos;s common name, such as “badminton”,
          “Muay Thai” or “park gym”.
        </p>
      </Card>
      <ConditionsChart timeline={r.timeline} tz={r.timezone} runStart={r.start} runEnd={r.end} placeName={r.place.name}
        label="Your session" />
    </>
  );
}

export function Dashboard() {
  // rendered on the client only (see dashboard-loader), so saved inputs can seed the first render
  const [form, setForm] = useState<FormState>(() => loadSaved() ?? defaultForm());
  const [result, setResult] = useState<AssessResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookupPending, setLookupPending] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [venues, setVenues] = useState<VenuesState>({ status: "loading" });
  const [lastKey, setLastKey] = useState<string | null>(null);
  const seq = useRef(0);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  // free text -> an activity in the database; the form takes the match and any numbers the text gave
  const lookup = useCallback(async (f: FormState): Promise<FormState | null> => {
    setLookupPending(true);
    setLookupError(null);
    const l = await fetchLookup(f.activityText.trim());
    setLookupPending(false);
    if ("error" in l) {
      setLookupError(l.error);
      return null;
    }
    // only if the text wasn't edited again while the lookup ran
    setForm((cur) => (cur.activityText === f.activityText ? applyLookup(cur, l) : cur));
    return applyLookup(f, l);
  }, []);

  const run = useCallback(async (f0: FormState) => {
    let f = f0;
    if (needsLookup(f)) {
      const g = await lookup(f);
      if (!g) return;
      f = g;
    }
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
      const r = body as AssessResult;
      setResult(r);
      setLastKey(JSON.stringify(req));
      save(f);
      if (!r.found) return;
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
  }, [lookup]);

  const initial = useRef(form);
  useEffect(() => {
    run(initial.current);
  }, [run]);

  const withStart = (f: FormState, t: number, tz: string): FormState => {
    const p = wallParts(t, tz);
    return { ...f, day: localDateKey(t, tz), time: `${pad(p.hour)}:${pad(p.minute)}` };
  };

  const pickStart = (t: number) => {
    if (!result?.found) return;
    const f = withStart(form, t, result.timezone);
    setForm(f);
    run(f);
  };

  const apply = (o: OptionRow) => {
    if (!result?.found || !o.plan) return;
    const p = o.plan;
    const changed: FormState = !isActivityPlan(p) ? { ...form, pace: p.pace, distanceKm: String(p.distanceKm) } : {
      ...form, minutes: String(p.minutes),
      activity: form.activity.kind === "activity" && p.intensity ? { ...form.activity, intensity: p.intensity } : form.activity,
    };
    const f = withStart(changed, o.start, result.timezone);
    setForm(f);
    run(f);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="mx-auto w-full max-w-[1320px] px-4 py-5 sm:px-6 sm:py-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <div className="flex items-baseline gap-3">
          <span className="text-lg font-semibold tracking-[-0.01em] text-ink">HazeWise</span>
          <span className="text-sm text-ink-2">Run and activity risk planner</span>
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
            dirty={result !== null && lastKey !== null && JSON.stringify(toRequest(form)) !== lastKey}
            onLookup={() => lookup(form)} lookupPending={lookupPending} lookupError={lookupError} />
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
          {result && !result.found && (
            <div className={`space-y-4 transition-opacity duration-200 ${pending ? "pointer-events-none opacity-55" : ""}`}>
              <NotFound r={result} />
            </div>
          )}
          {result?.found && (
            <div className={`space-y-4 transition-opacity duration-200 ${pending ? "pointer-events-none opacity-55" : ""}`}>
              <Verdict r={result} onApply={apply} />
              <StatTiles r={result} />
              <ConditionsChart timeline={result.timeline} tz={result.timezone} runStart={result.planned.start}
                runEnd={result.planned.end} placeName={result.place.name}
                label={isActivityPlan(result.plan) ? "Your session" : "Your run"} />
              <StartTimesChart byStart={result.byStart} t0={result.timeline[0].t} t1={result.timeline[result.timeline.length - 1].t}
                tz={result.timezone} planned={result.planned.start} plannedLevel={result.planned.level} onPick={pickStart}
                noun={isActivityPlan(result.plan) ? "session" : "run"} />
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
