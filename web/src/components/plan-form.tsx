"use client";

import { Fragment, useMemo, type ReactNode } from "react";
import { fmt } from "@/lib/format";
import { dayOptions, needsLookup, paceInfo, type FormState, type RunRow } from "@/lib/form";
import { activityTitle, INTENSITIES } from "@/lib/session";
import { PlaceSearch } from "./place-search";
import { Field, inputClass, Segmented, Spinner, SuffixInput } from "./ui";

type Props = {
  form: FormState;
  set: (patch: Partial<FormState>) => void;
  onSubmit: () => void;
  pending: boolean;
  dirty: boolean;
  onLookup: () => void;
  lookupPending: boolean;
  lookupError: string | null;
};

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <fieldset className="border-t border-line px-5 py-4 first:border-t-0">
      <div className="mb-3 flex items-baseline justify-between">
        <legend className="text-[13px] font-semibold text-ink">{title}</legend>
        {aside}
      </div>
      <div className="space-y-3">{children}</div>
    </fieldset>
  );
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid h-9 w-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function ColumnLabel({ children }: { children: ReactNode }) {
  return <span className="-mb-0.5 text-xs text-ink-2">{children}</span>;
}

function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-accent-ink transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      {children}
    </button>
  );
}

// what the last lookup matched, and how; a stale lookup says so rather than showing an old match as current
function ActivityStatus({ form, error, pending }: { form: FormState; error: string | null; pending: boolean }) {
  const a = form.activity;
  if (error) return <p role="alert" className="text-xs leading-[18px] text-danger-ink">{error}</p>;
  if (pending) return <p className="text-xs leading-[18px] text-ink-2">Reading the description and searching the activity database…</p>;
  if (needsLookup(form)) {
    return <p className="text-xs leading-[18px] text-ink-2">Press Look up, or Assess, to match this to an activity.</p>;
  }
  const via = a.source === "gemini" ? "Read by Gemini, " : a.source === "rules" ? "Keyword match, " : "";
  return (
    <div className="space-y-1 text-xs leading-[18px]">
      {a.kind === "run" && (
        <p className="text-ink-2">{via}running: uses your pace, distance and running history.</p>
      )}
      {a.kind === "activity" && (
        <p className="text-ink-2">
          {via}matched <span className="font-medium text-ink">{activityTitle(a.info)}</span>:{" "}
          {(a.info.levels?.[a.intensity] ?? a.info).name}, {fmt((a.info.levels?.[a.intensity] ?? a.info).met, 1)} MET
          (Compendium {(a.info.levels?.[a.intensity] ?? a.info).code}).
          {a.info.indoorOnly && " Usually done indoors, so outdoor air overstates the dose."}
        </p>
      )}
      {a.kind === "not-found" && (
        <p className="text-danger-ink">
          Activity not found. Nothing in the activity database matches “{a.text}”. The forecast still shows, without a dose
          or risk level. Try other words, such as the sport&apos;s common name.
        </p>
      )}
      {a.note && <p className="text-muted">{a.note}</p>}
    </div>
  );
}

export function PlanForm({ form, set, onSubmit, pending, dirty, onLookup, lookupPending, lookupError }: Props) {
  const days = useMemo(() => dayOptions(), []);
  const info = paceInfo(form);
  const isRun = form.activity.kind === "run";
  const setRun = (i: number, patch: Partial<RunRow>) =>
    set({ runs: form.runs.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const historyCount = (form.bestEffort ? 1 : 0) + form.runs.length;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="rounded-xl border border-line bg-surface shadow-[var(--shadow)]"
    >
      <Section title="Where and when">
        <Field label="Place">
          <PlaceSearch value={form.place} onChange={(place) => set({ place })} />
        </Field>
        <div className="grid grid-cols-[1fr_7.5rem] gap-3">
          <Field label="Day" htmlFor="day">
            <select id="day" className={`${inputClass} appearance-none bg-[length:12px] bg-[right_12px_center] bg-no-repeat pr-8`}
              style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5l3 3 3-3' fill='none' stroke='%23898781' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")" }}
              value={form.day} onChange={(e) => set({ day: e.target.value })}>
              {!days.some((d) => d.value === form.day) && <option value={form.day}>{form.day}</option>}
              {days.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </Field>
          <Field label="Start" htmlFor="time">
            <input id="time" type="time" step={900} className={`${inputClass} tnum`} value={form.time}
              onChange={(e) => set({ time: e.target.value })} />
          </Field>
        </div>
      </Section>

      <Section title="The activity" aside={isRun && info && (
        <span className="text-xs text-ink-2 tnum">{fmt(info.minutes)} min at {fmt(info.speedKmh, 1)} km/h</span>
      )}>
        <Field label="What are you doing?" htmlFor="activity">
          <div className="flex gap-2">
            <input id="activity" className={inputClass} value={form.activityText} maxLength={300}
              placeholder="Running, badminton doubles, Muay Thai class…"
              onChange={(e) => set({ activityText: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onLookup();
                }
              }} />
            <button type="button" onClick={onLookup} disabled={lookupPending || !form.activityText.trim()}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink transition-colors hover:border-axis disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              {lookupPending && <Spinner />}Look up
            </button>
          </div>
        </Field>
        <ActivityStatus form={form} error={lookupError} pending={lookupPending} />
        {form.activity.kind === "activity" && form.activity.info.levels && (
          <Field label="Intensity">
            <Segmented label="Intensity" value={form.activity.intensity}
              onChange={(intensity) => form.activity.kind === "activity" && set({ activity: { ...form.activity, intensity } })}
              options={INTENSITIES.map((i) => ({ value: i, label: `${i[0].toUpperCase()}${i.slice(1)}` }))} />
          </Field>
        )}
        {isRun ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Distance" htmlFor="distance">
              <SuffixInput id="distance" suffix="km" inputMode="decimal" type="number" step="0.1" min="0.1"
                value={form.distanceKm} onChange={(e) => set({ distanceKm: e.target.value })} />
            </Field>
            <Field label="Pace" htmlFor="pace">
              <SuffixInput id="pace" suffix="/km" placeholder="6:00" value={form.pace}
                onChange={(e) => set({ pace: e.target.value })} />
            </Field>
          </div>
        ) : (
          <Field label="Duration" htmlFor="minutes">
            <SuffixInput id="minutes" suffix="min" inputMode="numeric" type="number" step="5" min="1" max="600"
              value={form.minutes} onChange={(e) => set({ minutes: e.target.value })} />
          </Field>
        )}
      </Section>

      <Section title="About you">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Age" htmlFor="age">
            <SuffixInput id="age" suffix="years" type="number" inputMode="numeric" value={form.age}
              onChange={(e) => set({ age: e.target.value })} className="pr-14" />
          </Field>
          <Field label="Sex">
            <Segmented label="Sex" value={form.sex} onChange={(sex) => set({ sex })}
              options={[{ value: "male", label: "Male" }, { value: "female", label: "Female" }]} />
          </Field>
          <Field label="Height" htmlFor="height">
            <SuffixInput id="height" suffix="cm" type="number" inputMode="numeric" value={form.heightCm}
              onChange={(e) => set({ heightCm: e.target.value })} />
          </Field>
          <Field label="Weight" htmlFor="weight">
            <SuffixInput id="weight" suffix="kg" type="number" inputMode="decimal" value={form.weightKg}
              onChange={(e) => set({ weightKg: e.target.value })} />
          </Field>
        </div>
      </Section>

      {isRun && <details className="group border-t border-line">
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 [&::-webkit-details-marker]:hidden">
          <span className="text-[13px] font-semibold text-ink">
            Running history <span className="font-normal text-ink-2">, optional</span>
          </span>
          <span className="flex items-center gap-2 text-xs text-ink-2">
            {historyCount ? `${historyCount} ${historyCount === 1 ? "entry" : "entries"}` : "none"}
            <svg width="12" height="12" viewBox="0 0 12 12" className="transition-transform group-open:rotate-180" aria-hidden>
              <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </summary>
        <div className="space-y-4 px-5 pb-4">
          <p className="text-xs leading-[18px] text-ink-2">
            A recent race or all-out effort tells the model how fit you are, which narrows the breathing estimate. Runs
            with average heart rate help when there is no best effort.
          </p>
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-ink-2">Best effort</div>
            {form.bestEffort ? (
              <div className="grid grid-cols-[1fr_1fr_1fr_2rem] gap-x-2 gap-y-2">
                <ColumnLabel>Distance, km</ColumnLabel>
                <ColumnLabel>Time</ColumnLabel>
                <span />
                <span />
                <input aria-label="Best effort distance in km" type="number" inputMode="decimal" step="0.1"
                  className={`${inputClass} tnum`} value={form.bestEffort.distanceKm}
                  onChange={(e) => set({ bestEffort: { ...form.bestEffort!, distanceKm: e.target.value } })} />
                <input aria-label="Best effort time" placeholder="25:00" className={`${inputClass} tnum`}
                  value={form.bestEffort.time}
                  onChange={(e) => set({ bestEffort: { ...form.bestEffort!, time: e.target.value } })} />
                <span />
                <RemoveButton label="Remove best effort" onClick={() => set({ bestEffort: null })} />
              </div>
            ) : (
              <AddButton onClick={() => set({ bestEffort: { distanceKm: "5", time: "" } })}>Add best effort</AddButton>
            )}
          </div>
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-ink-2">Recent runs with heart rate</div>
            {form.runs.length > 0 && (
              <div className="grid grid-cols-[1fr_1fr_1fr_2rem] gap-x-2 gap-y-2">
                <ColumnLabel>Distance, km</ColumnLabel>
                <ColumnLabel>Time</ColumnLabel>
                <ColumnLabel>Avg HR, bpm</ColumnLabel>
                <span />
                {form.runs.map((r, i) => (
                  <Fragment key={i}>
                    <input aria-label={`Run ${i + 1} distance in km`} type="number" inputMode="decimal" step="0.1"
                      className={`${inputClass} tnum`} value={r.distanceKm} onChange={(e) => setRun(i, { distanceKm: e.target.value })} />
                    <input aria-label={`Run ${i + 1} time`} placeholder="52:00" className={`${inputClass} tnum`} value={r.time}
                      onChange={(e) => setRun(i, { time: e.target.value })} />
                    <input aria-label={`Run ${i + 1} average heart rate in bpm`} type="number" inputMode="numeric"
                      className={`${inputClass} tnum`} value={r.avgHr} onChange={(e) => setRun(i, { avgHr: e.target.value })} />
                    <RemoveButton label={`Remove run ${i + 1}`} onClick={() => set({ runs: form.runs.filter((_, j) => j !== i) })} />
                  </Fragment>
                ))}
              </div>
            )}
            {form.runs.length < 8 && (
              <div className={form.runs.length ? "mt-1" : ""}>
                <AddButton onClick={() => set({ runs: [...form.runs, { distanceKm: "", time: "", avgHr: "" }] })}>Add run</AddButton>
              </div>
            )}
          </div>
        </div>
      </details>}

      <Section title="Thresholds">
        <Segmented label="Thresholds" value={form.group} onChange={(group) => set({ group })}
          options={[{ value: "general", label: "General" }, { value: "vulnerable", label: "Vulnerable" }]} />
        <p className="text-xs leading-[18px] text-ink-2">
          {form.group === "general"
            ? "Switch to vulnerable for older adults, children, pregnancy, or heart or lung disease."
            : "Stricter levels, and breathing is taken from the top of the estimate's range."}
        </p>
        <Field label="Air for the rest of the day" htmlFor="indoor"
          hint={form.indoorPct === 100 ? "Assumes outdoor air all day, the cautious default."
            : form.indoorPct === 0 ? "Counts only the run, as if the rest of the day's air were perfectly clean."
              : `Assumes the rest of your day is spent in air with ${form.indoorPct}% of outdoor PM2.5.`}>
          <div className="flex items-center gap-3">
            <input id="indoor" type="range" min={0} max={100} step={10} value={form.indoorPct}
              onChange={(e) => set({ indoorPct: Number(e.target.value) })} className="h-9 w-full" />
            <span className="w-11 text-right text-sm text-ink tnum">{form.indoorPct}%</span>
          </div>
        </Field>
      </Section>

      <div className="border-t border-line p-4">
        <button
          type="submit"
          disabled={pending}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-semibold text-white transition-[filter] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-progress disabled:opacity-80"
        >
          {pending && <Spinner />}
          {pending ? "Checking the forecast" : isRun ? "Assess run" : "Assess activity"}
        </button>
        {dirty && !pending && (
          <p className="mt-2.5 text-center text-xs text-ink-2">Inputs changed. The results show your last check.</p>
        )}
      </div>
    </form>
  );
}
