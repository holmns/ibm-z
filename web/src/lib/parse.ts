// Keyword parsing of a free-text plan, used when no Gemini key is set or the call fails. It pulls out the numbers
// and an intensity word; the activity itself is left to the database lookup, which works on the whole text.
import type { Intensity, ParsedText } from "./session";

const LIGHT = /\b(easy|light|gentle|casual|social|leisurely|leisure|slow|relaxed|recreational|beginner)\b/;
const VIGOROUS = /\b(hard|vigorous|intense|intensive|competitive|fast|match|race|racing|sparring|tempo|all[- ]out)\b/;
const MODERATE = /\b(moderate|steady|medium|normal)\b/;

export function intensityOf(text: string): Intensity | null {
  const t = text.toLowerCase();
  return LIGHT.test(t) ? "light" : VIGOROUS.test(t) ? "vigorous" : MODERATE.test(t) ? "moderate" : null;
}

export function minutesOf(text: string): number | null {
  const t = text.toLowerCase();
  const hm = t.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b\s*(?:and\s*)?(?:(\d+)\s*(?:m|min|mins|minute|minutes)?\b)?/);
  if (hm) return Math.round(Number(hm[1]) * 60 + (hm[2] ? Number(hm[2]) : 0));
  const compact = t.match(/\b(\d+)h(\d{1,2})\b/);
  if (compact) return Number(compact[1]) * 60 + Number(compact[2]);
  const m = t.match(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/);
  if (m) return Math.round(Number(m[1]));
  if (/\bhalf an hour\b/.test(t)) return 30;
  if (/\b(an|one) hour\b/.test(t)) return 60;
  return null;
}

export function distanceOf(text: string): number | null {
  const t = text.toLowerCase();
  const km = t.match(/(\d+(?:\.\d+)?)\s*(?:km|k|kilometres|kilometers)\b/);
  if (km) return Number(km[1]);
  if (/\bhalf[- ]marathon\b/.test(t)) return 21.1;
  if (/\bmarathon\b/.test(t)) return 42.2;
  return null;
}

// only a time followed by /km or "per km", or after "pace", so "at 8:00" stays a start time
export function paceOf(text: string): string | null {
  const t = text.toLowerCase();
  const m = t.match(/(\d{1,2}:[0-5]\d)\s*(?:min(?:utes)?\s*)?(?:\/|per\s*)\s*(?:km|k)\b/) ?? t.match(/\bpace\s*(?:of\s*)?(\d{1,2}:[0-5]\d)\b/);
  return m ? m[1] : null;
}

export function startOf(text: string): Pick<ParsedText, "startTime" | "day"> {
  const t = text.toLowerCase();
  const day = /\btomorrow\b/.test(t) ? "tomorrow" : /\b(today|tonight|this (morning|afternoon|evening))\b/.test(t) ? "today" : null;
  const m = t.match(/\bat\s+(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?\b(?!\s*(?:\/|per)\s*k)/);
  if (!m || (!m[2] && !m[3])) return { startTime: null, day };
  let h = Number(m[1]);
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (!m[3] && /\b(tonight|evening)\b/.test(t) && h < 12) h += 12;
  if (h > 23) return { startTime: null, day };
  return { startTime: `${String(h).padStart(2, "0")}:${m[2] ?? "00"}`, day };
}

export function parseRules(text: string, note: string | null = null): ParsedText {
  return {
    activity: text.trim(), intensity: intensityOf(text), minutes: minutesOf(text), distanceKm: distanceOf(text),
    pace: paceOf(text), ...startOf(text), source: "rules", note,
  };
}
