"use client";

import { fmt } from "@/lib/format";
import { isActivityPlan, noun } from "@/lib/session";
import { fmtDayTime } from "@/lib/time";
import type { AssessResponse } from "@/lib/types";
import { Card, CardHeader } from "./ui";

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1) + (s.endsWith(".") ? "" : ".");

export function Notes({ r }: { r: AssessResponse }) {
  const v = r.planned.ve;
  const flags = [...v.warnings, ...r.planned.notes];
  const activity = isActivityPlan(r.plan);
  const n = noun(r.plan);
  return (
    <Card>
      <CardHeader title="How this is worked out" />
      <div className="grid gap-x-8 gap-y-5 border-t border-line px-5 py-4 text-[13px] leading-5 text-ink-2 lg:grid-cols-2">
        <div className="space-y-2">
          <h3 className="font-semibold text-ink">PM2.5 breathed in</h3>
          <p>
            {activity
              ? "The activity's MET from the 2024 Compendium of Physical Activities gives your oxygen use, MET × 3.5 × your weight, and a model fitted on 981 treadmill tests turns oxygen use and your profile into the air you breathe per minute."
              : "Pace, distance and your profile give the air you breathe per minute, from a model fitted on 992 treadmill tests."}{" "}
            Air times the forecast PM2.5, minute by minute, gives the micrograms the {n} puts in your lungs.
          </p>
          <p>
            That dose plus the rest of the day&apos;s becomes a day-equivalent PM2.5. It is the 24-hour level at which
            an ordinary day for your age, {fmt(r.planned.vDayM3, 1)} m³ of air, would take in the same amount, so WHO
            24-hour targets apply to it. Low is under 37.5 µg/m³ and High is 75 and up, or 25 and 50 for
            vulnerable groups. Any hour of the {n} in NEA Band III or worse makes it High.
          </p>
        </div>
        <div className="space-y-2">
          <h3 className="font-semibold text-ink">Heat, UV and rain</h3>
          <p>
            The worst hour the {n} touches is scored. Feels-like temperature of 32°C or more is Medium and 35°C is High.
            UV of 6 or more is Medium, and UV 8 with a 70% chance of rain is High. A 50% chance of rain is Medium.
            The overall level is the worse of the two scores.
          </p>
          <p>These levels are planning rules built from WHO and NEA figures. No agency publishes them for exercise.</p>
        </div>
        <div className="space-y-2">
          <h3 className="font-semibold text-ink">{v.variant === "MET" ? "Breathing from the activity's MET" : `Breathing model ${v.variant}`}</h3>
          <ul className="space-y-1">
            {v.notes.map((n) => <li key={n}>{sentence(n)}</li>)}
            {v.variant === "B" && v.notes.some((n) => n.startsWith("HR at pace")) && (
              <li>With a best effort given, heart rate is shown for reference only. It made the estimate worse in testing.</li>
            )}
            {flags.map((n) => <li key={n} className="text-danger-ink">{sentence(n)}</li>)}
            {!activity && !v.notes.length && !flags.length && <li>No running history, so the estimate uses your profile only.</li>}
            {activity && (
              <li>
                {v.bandKind === "gait"
                  ? "The 80% range is the error of this method measured on the treadmill tests."
                  : "The 80% range adds an assumed ±25% to the treadmill error, since a session's real intensity varies around the Compendium average."}
              </li>
            )}
          </ul>
        </div>
        <div className="space-y-2">
          <h3 className="font-semibold text-ink">Limits</h3>
          <ul className="list-disc space-y-1 pl-4">
            <li>The PM2.5 forecast comes from a grid about 45 km wide, so all of Singapore shares one or two cells and local plumes don&apos;t show.</li>
            <li>Heat raises breathing too, and the model was fitted on lab runs of about 11 minutes, so hot or long sessions likely come out low.</li>
            {activity && <li>A MET is an average over play and rest. Stop-start sports breathe harder in bursts, so their dose likely comes out low.</li>}
            <li>Not medical advice. Follow NEA advisories, heat warnings and lightning alerts.</li>
          </ul>
        </div>
      </div>
      <p className="border-t border-line px-5 py-3 text-xs leading-[18px] text-ink-2">
        Weather data by <a className="underline decoration-axis underline-offset-2 hover:text-ink" href="https://open-meteo.com/">Open-Meteo.com</a>.
        Air quality from the Copernicus Atmosphere Monitoring Service, CAMS. Places from OneMap, venues from data.gov.sg.
        Forecast fetched {fmtDayTime(r.fetchedAt, r.timezone)}, PM2.5 runs to {fmtDayTime(r.pmHorizon, r.timezone)}.
      </p>
    </Card>
  );
}
