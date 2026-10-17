// Free text -> an activity in hazewise.db. Gemini (or keyword rules) reads the text; the database decides the match:
// the model's family first, then its search words, then the user's own words.
import "server-only";
import { familyMatch, resolveActivity, toInfo, type ActivityMatch } from "./activities";
import { parseText } from "./llm";
import type { ActivityLookup } from "./session";

export async function lookupActivity(text: string): Promise<ActivityLookup> {
  const { family, searchTerms, ...parsed } = await parseText(text);
  const intensity = parsed.intensity ?? "moderate";
  let m: ActivityMatch | null = family ? familyMatch(family, intensity) : null;
  for (const q of [searchTerms, parsed.activity, text]) {
    if (m) break;
    if (q) m = resolveActivity(q, intensity);
  }
  if (!m) return { text, parsed, kind: "not-found", match: null };
  return { text, parsed, kind: m.family === "running" ? "run" : "activity", match: toInfo(m) };
}
