// Free text -> an activity in hazewise.db. Keyword rules (parse.ts) read the numbers, start time and intensity; the
// text's embedding finds the closest Compendium activity (activities.ts).
import "server-only";
import { LOOSE_SIMILARITY, matchVector, toInfo } from "./activities";
import { embed } from "./embed";
import { parseRules } from "./parse";
import type { ActivityLookup } from "./session";

export async function lookupActivity(text: string): Promise<ActivityLookup> {
  const parsed = parseRules(text);
  const { match, similarity } = matchVector(await embed(text), parsed.intensity);
  if (!match) return { text, parsed, kind: "not-found", match: null, similarity, note: null };
  const note = similarity < LOOSE_SIMILARITY
    ? "This is the closest activity in the database, but not a close one. Check it, or try the sport's common name."
    : null;
  return { text, parsed, kind: match.family === "running" ? "run" : "activity", match: toInfo(match), similarity, note };
}
