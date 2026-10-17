// Activity lookup in hazewise.db: calculate-ve-others.ipynb §2. Alias, then family name, then full-text search over the
// 2024 Compendium. A family gives the code for the chosen intensity; a search hit gives its one code.
import "server-only";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { INTENSITIES, type ActivityInfo, type Intensity } from "./session";

export type Activity = {
  code: string;
  majorHeading: string;
  met: number;
  name: string;
  indoorOnly: boolean;
  exerciseRelevant: boolean;
};

export type Family = { family: string; displayName: string; levels: Record<Intensity, Activity> };

export type ActivityMatch = Activity & {
  family: string | null;
  familyName: string | null;
  intensity: Intensity | null;
  matchedBy: "family" | "search";
};

// words that describe the session rather than the activity; dropped before full-text search
const STOPWORDS = new Set((
  "a an and at for from go going do doing done i in into my of on or our play playing some the to with we " +
  "class classes session sessions training practice workout morning evening afternoon night today tonight tomorrow " +
  "weekend friends friend group easy light moderate hard vigorous intense casual competitive min mins minute minutes " +
  "hour hours hr hrs km k").split(" "));

type Row = { code: string; major_heading: string; met: number; name: string; indoor_only: number; exercise_relevant: number };
const COLS = "a.code, a.major_heading, a.met, a.name, a.indoor_only, a.exercise_relevant";

let db: DatabaseSync | null = null;
let families: Map<string, Family> | null = null;
let aliases: [string, string][] | null = null;

// the database sits at the repo root, next to the notebooks; HAZEWISE_DB overrides
function open() {
  if (!db) db = new DatabaseSync(process.env.HAZEWISE_DB || path.join(process.cwd(), "..", "hazewise.db"), { readOnly: true });
  return db;
}

const toActivity = (r: Row): Activity => ({
  code: r.code, majorHeading: r.major_heading, met: r.met, name: r.name, indoorOnly: r.indoor_only === 1,
  exerciseRelevant: r.exercise_relevant === 1,
});

export function norm(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean).join(" ");
}

export function searchTerms(text: string) {
  return norm(text).split(" ").filter((w) => w.length > 1 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

const byCode = new Map<string, Activity | null>();

export function activityByCode(code: string): Activity | null {
  if (!byCode.has(code)) {
    const r = open().prepare(`select ${COLS} from activities a where a.code = ?`).get(code) as Row | undefined;
    byCode.set(code, r ? toActivity(r) : null);
  }
  return byCode.get(code)!;
}

export function allFamilies(): Map<string, Family> {
  if (!families) {
    const rows = open().prepare("select family, display_name, light_code, moderate_code, vigorous_code from activity_families")
      .all() as { family: string; display_name: string; light_code: string; moderate_code: string; vigorous_code: string }[];
    families = new Map(rows.map((f) => [f.family, {
      family: f.family, displayName: f.display_name,
      levels: { light: activityByCode(f.light_code)!, moderate: activityByCode(f.moderate_code)!, vigorous: activityByCode(f.vigorous_code)! },
    }]));
  }
  return families;
}

function allAliases() {
  if (!aliases) {
    aliases = (open().prepare("select alias, family from family_aliases").all() as { alias: string; family: string }[])
      .map((a) => [a.alias, a.family]);
  }
  return aliases;
}

// the longest alias or family name that appears as whole words; ties go to the later string, like Python's max()
export function findFamily(text: string): string | null {
  const t = ` ${norm(text)} `;
  const hits: [number, string, string][] = [];
  for (const [a, f] of allAliases()) if (t.includes(` ${norm(a)} `)) hits.push([a.length, a, f]);
  for (const f of allFamilies().keys()) if (t.includes(` ${norm(f)} `)) hits.push([f.length, f, f]);
  if (!hits.length) return null;
  hits.sort((x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0) || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0));
  return hits[hits.length - 1][2];
}

export function ftsSearch(text: string, limit = 5): Activity[] {
  const tokens = searchTerms(text);
  if (!tokens.length) return [];
  const q = tokens.map((w) => `"${w}"`).join(" "); // every term must match
  const rows = open().prepare(
    `select ${COLS} from activities_fts f join activities a on a.code = f.code where activities_fts match ? ` +
    "order by a.exercise_relevant desc, f.rank, a.code limit ?").all(q, limit) as Row[];
  return rows.map(toActivity);
}

export function familyMatch(family: string, intensity: Intensity): ActivityMatch | null {
  const f = allFamilies().get(family);
  if (!f) return null;
  return { ...f.levels[intensity], family, familyName: f.displayName, intensity, matchedBy: "family" };
}

export function codeMatch(code: string): ActivityMatch | null {
  const a = activityByCode(code);
  return a && { ...a, family: null, familyName: null, intensity: null, matchedBy: "search" };
}

// what the dashboard needs to show a match and offer the family's other intensities
export function toInfo(m: ActivityMatch): ActivityInfo {
  const f = m.family ? allFamilies().get(m.family) : undefined;
  const level = (a: Activity) => ({ code: a.code, name: a.name, met: a.met });
  return {
    code: m.code, name: m.name, met: m.met, majorHeading: m.majorHeading, indoorOnly: m.indoorOnly, family: m.family,
    familyName: m.familyName, intensity: m.intensity, matchedBy: m.matchedBy,
    levels: f ? { light: level(f.levels.light), moderate: level(f.levels.moderate), vigorous: level(f.levels.vigorous) } : null,
  };
}

export function resolveActivity(text: string, intensity: Intensity = "moderate"): ActivityMatch | null {
  const inten = INTENSITIES.includes(intensity) ? intensity : "moderate";
  const fam = findFamily(text);
  if (fam) return familyMatch(fam, inten);
  const hits = ftsSearch(text);
  if (hits.length) return { ...hits[0], family: null, familyName: null, intensity: null, matchedBy: "search" };
  return null;
}
