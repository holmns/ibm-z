// Activity lookup in hazewise.db by embedding: the text's vector against each 2024 Compendium description's
// (activities.embedding, text-embedding-3-large). A family gives the code for the chosen intensity; any other row
// gives its one code.
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

// cosine cut-offs, read off test queries: gibberish ("asdf qwer") scores 0.23 and the weakest real match ("hike bukit
// timah" -> Hiking, cross country) 0.38. Under LOOSE_SIMILARITY the match comes with a note to check it.
export const MIN_SIMILARITY = 0.35;
export const LOOSE_SIMILARITY = 0.45;
// rows this close to the best row count as ties. A family row among them wins, since families carry the three
// intensities ("tennis" -> Tennis, doubles 0.665 vs Tennis, general 0.627; wrong families start near 0.09, "Muay Thai
// class" -> Zumba). Otherwise the row whose effort is the text's intensity, or moderate, wins ("kayaking" ->
// competition 0.712 vs moderate effort 0.671).
const TIE_MARGIN = 0.06;

type Row = { code: string; major_heading: string; met: number; name: string; indoor_only: number; exercise_relevant: number };
const COLS = "a.code, a.major_heading, a.met, a.name, a.indoor_only, a.exercise_relevant";

let db: DatabaseSync | null = null;
let families: Map<string, Family> | null = null;
let familyCodes: Map<string, string> | null = null;
let index: { codes: string[]; efforts: (string | null)[]; dim: number; vectors: Float32Array } | null = null;

// the database sits at the repo root, next to the notebooks; HAZEWISE_DB overrides
function open() {
  if (!db) db = new DatabaseSync(process.env.HAZEWISE_DB || path.join(process.cwd(), "..", "hazewise.db"), { readOnly: true });
  return db;
}

const toActivity = (r: Row): Activity => ({
  code: r.code, majorHeading: r.major_heading, met: r.met, name: r.name, indoorOnly: r.indoor_only === 1,
  exerciseRelevant: r.exercise_relevant === 1,
});

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

// code -> family, for the three codes of every family
function familyOf(code: string) {
  if (!familyCodes) {
    familyCodes = new Map();
    for (const f of allFamilies().values()) for (const a of Object.values(f.levels)) familyCodes.set(a.code, f.family);
  }
  return familyCodes.get(code) ?? null;
}

// every embedding as unit vectors in one array, so a search is one dot product per row
function embeddings() {
  if (!index) {
    const codes: string[] = [];
    const efforts: (string | null)[] = [];
    const vecs: number[][] = [];
    for (const r of open().prepare("select code, effort, embedding from activities where embedding is not null order by code")
      .iterate() as Iterable<{ code: string; effort: string | null; embedding: string }>) {
      codes.push(r.code);
      efforts.push(r.effort);
      vecs.push(JSON.parse(r.embedding));
    }
    if (!vecs.length) throw new Error("hazewise.db has no activity embeddings");
    const dim = vecs[0].length;
    const vectors = new Float32Array(codes.length * dim);
    vecs.forEach((v, i) => {
      if (v.length !== dim) throw new Error(`activity ${codes[i]} has a ${v.length}-dimension embedding, not ${dim}`);
      const n = Math.hypot(...v);
      for (let j = 0; j < dim; j++) vectors[i * dim + j] = v[j] / n;
    });
    index = { codes, efforts, dim, vectors };
  }
  return index;
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

// the closest row to the text's embedding, and its cosine, with ties settled as TIE_MARGIN says. Any row under
// Running, treadmill included, counts as the running family: runs go to the pace model, never to a running MET.
// intensity picks the family's level (moderate if the text named none).
export function matchVector(query: ArrayLike<number>, intensity: Intensity | null = null) {
  const { codes, efforts, dim, vectors } = embeddings();
  if (query.length !== dim) throw new Error(`query embedding has ${query.length} dimensions, the database ${dim}`);
  const inten = intensity && INTENSITIES.includes(intensity) ? intensity : "moderate";
  let n = 0;
  for (let j = 0; j < dim; j++) n += query[j] * query[j];
  n = Math.sqrt(n) || 1;
  const sims = new Float64Array(codes.length);
  let best = 0;
  for (let i = 0; i < codes.length; i++) {
    let sim = 0;
    for (let j = 0, o = i * dim; j < dim; j++) sim += vectors[o + j] * query[j];
    sims[i] = sim / n;
    if (sims[i] > sims[best]) best = i;
  }
  if (sims[best] < MIN_SIMILARITY) return { match: null, similarity: sims[best] };
  const tied = (pred: (i: number) => boolean) => {
    let k = -1;
    for (let i = 0; i < codes.length; i++) if (sims[i] >= sims[best] - TIE_MARGIN && pred(i) && (k < 0 || sims[i] > sims[k])) k = i;
    return k < 0 ? null : k;
  };
  const hit = tied((i) => familyOf(codes[i]) !== null) ?? tied((i) => efforts[i] === inten) ?? best;
  const a = activityByCode(codes[hit])!;
  const family = a.majorHeading === "Running" ? "running" : familyOf(a.code);
  return { match: family ? familyMatch(family, inten) : codeMatch(a.code), similarity: sims[best] };
}
