// A planned session is either a run (pace and distance, the running model) or any other activity (a Compendium
// code and minutes, the MET model). Shared by the server and the dashboard.
import { fmtShort } from "./num";
import type { Plan } from "./ve";

export type Intensity = "light" | "moderate" | "vigorous";
export const INTENSITIES: Intensity[] = ["light", "moderate", "vigorous"];

// code is null when the text matched nothing; the server then returns the forecast without a dose
export type ActivityPlan = {
  kind: "activity";
  text: string;
  code: string | null;
  family: string | null;
  intensity: Intensity | null;
  minutes: number;
};
export type SessionPlan = Plan | ActivityPlan;

export function isActivityPlan(p: SessionPlan | null | undefined): p is ActivityPlan {
  return (p as ActivityPlan | null | undefined)?.kind === "activity";
}

export type ActivityLevel = { code: string; name: string; met: number };

export type ActivityInfo = {
  code: string;
  name: string;
  met: number;
  majorHeading: string;
  indoorOnly: boolean;
  family: string | null;
  familyName: string | null;
  intensity: Intensity | null;
  matchedBy: "family" | "search";
  levels: Record<Intensity, ActivityLevel> | null;
};

export type ParsedText = {
  intensity: Intensity | null;
  minutes: number | null;
  distanceKm: number | null;
  pace: string | null;
  startTime: string | null; // "HH:MM", only when the text names one
  day: "today" | "tomorrow" | null;
};

export type ActivityLookup = {
  text: string;
  parsed: ParsedText;
  kind: "run" | "activity" | "not-found";
  match: ActivityInfo | null;
  similarity: number; // cosine between the text's embedding and the closest activity's
  note: string | null;
};

// "run" or "session", for copy that works for both
export function noun(plan: SessionPlan) {
  return isActivityPlan(plan) ? "session" : "run";
}

export function activityTitle(a: ActivityInfo) {
  return a.familyName ?? a.name;
}

export function describePlan(plan: SessionPlan, activity: ActivityInfo | null) {
  if (!isActivityPlan(plan)) return `${fmtShort(plan.distanceKm)} km at ${plan.pace} per km`;
  const what = activity ? activityTitle(activity) : plan.text;
  return `${what}${plan.intensity ? `, ${plan.intensity}` : ""}, ${fmtShort(plan.minutes)} min`;
}
