"use client";

import { fmt } from "@/lib/format";
import { isActivityPlan, noun } from "@/lib/session";
import { fmtDayTime } from "@/lib/time";
import type { AssessResponse } from "@/lib/types";
import { Card, CardHeader } from "./ui";

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1) + (s.endsWith(".") ? "" : ".");

const OUT_OF_RANGE: Record<string, (v: string) => string> = {
  "speed km/h": (v) => `Your running speed of ${v} km/h`,
  age: (v) => `Your age of ${v}`,
  "weight kg": (v) => `Your weight of ${v} kg`,
  "height cm": (v) => `Your height of ${v} cm`,
  "peak speed km/h": (v) => `The top speed from your best effort, ${v} km/h,`,
  HR: (v) => `Your heart rate at this pace, ${v} bpm,`,
  "VO2 mL/kg/min": (v) => `Your oxygen use of ${v} mL per kg each minute`,
};

// the breathing models' warnings, from the notebooks' wording into plain sentences; null drops one the Limits list
// already says
function plainWarning(w: string): string | null {
  let m = /^goal pace is faster than the best effort predicts for ([\d.]+) km \(([\d:]+) min\/km\)/.exec(w);
  if (m) return `Your goal pace is faster than your best effort suggests you can hold for ${m[1]} km, about ${m[2]} per km. Expect to breathe harder than shown.`;
  if (w.startsWith("HR not used: goal speed")) return "Your heart rate history wasn't used, since those runs were at a different pace.";
  if (w.startsWith("HR not used")) return "Your heart rate history wasn't used.";
  m = /^(.+) ([\d.]+) outside the data \(([\d.]+)-([\d.]+)\)$/.exec(w);
  if (m && OUT_OF_RANGE[m[1]]) {
    return `${OUT_OF_RANGE[m[1]](m[2])} is outside the ${m[3]} to ${m[4]} the model learned from, so treat the estimate as rough.`;
  }
  if (w.startsWith("this activity is usually done indoors")) {
    return "You'd usually do this indoors, where the air is cleaner, so the outdoor forecast overstates the dose.";
  }
  if (w.startsWith("the MET averages play and rest")) return null;
  if (w.startsWith("part of the day is outside the forecast")) {
    return "Part of the day falls outside the forecast, so the nearest forecast hour stands in for it.";
  }
  return sentence(w);
}

export function Notes({ r }: { r: AssessResponse }) {
  const v = r.planned.ve;
  const activity = isActivityPlan(r.plan);
  const n = noun(r.plan);
  const flags = [...v.warnings, ...r.planned.notes].map(plainWarning).filter((w): w is string => w !== null);
  const basis = activity && r.activity && v.met !== undefined
    ? `The 2024 Compendium of Physical Activities rates "${r.activity.name}" at ${fmt(v.met, 1)} MET, so you burn ` +
      `about ${fmt(v.met, 1)} times the energy you do sitting still.`
    : v.variant === "B" && v.vpeakKmh != null && v.vpeakLabMedian !== undefined
      ? `Your best effort suggests a top speed of about ${fmt(v.vpeakKmh, 1)} km/h. The typical runner in the lab data ` +
        `reached ${fmt(v.vpeakLabMedian, 1)}, so the estimate expects you to breathe ` +
        `${v.vpeakKmh < v.vpeakLabMedian ? "a little harder" : "a little easier"} than average at this pace.`
      : v.variant === "C" && v.hrAtPace != null
        ? `Your recent runs put your heart rate at about ${fmt(v.hrAtPace)} bpm at this pace, which fine-tunes the estimate.`
        : "No running history given, so this uses your age, sex, height and weight.";
  return (
    <Card>
      <CardHeader title="How this is worked out" />
      <div className="grid gap-x-8 gap-y-5 border-t border-line px-5 py-4 text-[13px] leading-5 text-ink-2 lg:grid-cols-2">
        <div className="space-y-2">
          <h3 className="font-semibold text-ink">Personal air quality</h3>
          <p>
            {activity
              ? "The activity's MET from the 2024 Compendium of Physical Activities and your weight give your oxygen use. A model fitted on 981 treadmill tests turns that and your profile into the air you breathe each minute."
              : "Your pace, distance and profile give the air you breathe each minute, from a model fitted on 992 treadmill tests."}{" "}
            Multiplying by the forecast PM2.5, minute by minute, gives the micrograms the {n} puts in your lungs.
          </p>
          <p>
            Your day&apos;s PM2.5 adds the {n} to the rest of the day and spreads it over the {fmt(r.planned.vDayM3, 1)} m³
            of air a person your age breathes on an ordinary day. It&apos;s the all-day air level that would give the
            same dose without the {n}. Low is under 37.5 µg/m³ and High is 75 or more, set from WHO&apos;s 24-hour air
            targets. For vulnerable groups the lines are 25 and 50.
          </p>
        </div>
        <div className="space-y-2">
          <h3 className="font-semibold text-ink">Heat, UV and rain</h3>
          <p>
            Each is scored at its worst hour during the {n}. A feels-like temperature of 32°C is Medium and 35°C is
            High. UV of 6 or more is Medium. A 50% chance of rain is Medium. UV of 8 with a 70% chance of rain makes
            both High. The overall level is the worst of air, heat, UV and rain.
          </p>
          <p>These levels are planning rules built from WHO and NEA figures. No agency publishes them for exercise.</p>
        </div>
        <div className="space-y-2">
          <h3 className="font-semibold text-ink">Breathing estimate</h3>
          <ul className="space-y-1">
            <li>{basis}</li>
            {activity && (
              <li>
                {v.bandKind === "gait"
                  ? "The likely range is this method's error on the treadmill tests."
                  : "The likely range adds 25% either way to the treadmill error, since a real session's effort varies around the Compendium average."}
              </li>
            )}
            {flags.map((w) => <li key={w} className="text-danger-ink">{w}</li>)}
          </ul>
        </div>
        <div className="space-y-2">
          <h3 className="font-semibold text-ink">Limits</h3>
          <ul className="list-disc space-y-1 pl-4">
            {r.pmSource === "google"
              ? <li>PM2.5 starts from station readings, but about 10 hours out it eases back to a global model that misses haze, so a plan days ahead can come out low.</li>
              : <li>The PM2.5 forecast comes from a grid about 45 km wide, so all of Singapore shares one or two cells and local plumes don&apos;t show. In haze it reads low.</li>}
            <li>Heat raises breathing too, and the model was fitted on lab runs of about 11 minutes, so hot or long sessions likely come out low.</li>
            {activity && <li>A MET is an average over play and rest. Stop-start sports breathe harder in bursts, so their dose likely comes out low.</li>}
            <li>Not medical advice. Follow NEA advisories, heat warnings and lightning alerts.</li>
          </ul>
        </div>
      </div>
      <p className="border-t border-line px-5 py-3 text-xs leading-[18px] text-ink-2">
        Weather data by <a className="underline decoration-axis underline-offset-2 hover:text-ink" href="https://open-meteo.com/">Open-Meteo.com</a>.
        {r.pmSource === "google" ? "PM2.5 from Google's Air Quality API" : "PM2.5 from the Copernicus Atmosphere Monitoring Service, CAMS"}
        {r.psi ? ", PSI from NEA" : ""}. Places from OneMap, venues from data.gov.sg.
        Forecast fetched {fmtDayTime(r.fetchedAt, r.timezone)}, PM2.5 runs to {fmtDayTime(r.pmHorizon, r.timezone)}.
      </p>
    </Card>
  );
}
