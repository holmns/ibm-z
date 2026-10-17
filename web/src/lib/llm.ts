// Free-text plan -> structured fields with Gemini (GEMINI_API_KEY in web/.env). The model only names the activity,
// its family and the numbers the user typed; the MET always comes from hazewise.db. Without a key, or if the call
// fails, keyword rules (parse.ts) stand in.
import "server-only";
import { allFamilies } from "./activities";
import { parseRules } from "./parse";
import type { Intensity, ParsedText } from "./session";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

type GeminiOut = {
  activity: string;
  family: string;
  search_terms: string;
  intensity: Intensity | "unknown";
  duration_min: number | null;
  distance_km: number | null;
  pace_min_per_km: string | null;
  start_time: string | null;
  day: "today" | "tomorrow" | "unknown";
};

export type LlmParse = ParsedText & { family: string | null; searchTerms: string | null };

function prompt(families: string[]) {
  return [
    "You read one sentence in which someone describes an outdoor exercise session they plan to do in Singapore,",
    "and return its parts as JSON. Copy numbers only when the user wrote them; never guess a duration, distance or pace.",
    "",
    `family: one of ${families.join(", ")}, or "none". Choose a family only when the activity clearly is that sport`,
    "(e.g. Muay Thai -> martial_arts, park gym or fitness corner -> weight_training, PCN ride -> cycling).",
    "Use \"none\" for anything else, including activities you don't recognise.",
    "search_terms: two or three plain English words naming the activity itself, as a sports compendium would list it",
    "(e.g. \"rock climbing\", \"frisbee\", \"kayaking\"). Never substitute a different or similar activity.",
    "intensity: light, moderate, vigorous, or unknown if the user gives no hint (casual/social = light, competitive/",
    "match/sparring/hard = vigorous).",
    "pace_min_per_km: \"m:ss\" for running or walking pace if given. start_time: 24-hour \"HH:MM\" if the user gives a",
    "start time (\"tonight at 8\" -> \"20:00\"). day: today, tomorrow or unknown.",
  ].join("\n");
}

const SCHEMA = {
  type: "OBJECT",
  properties: {
    activity: { type: "STRING" },
    family: { type: "STRING" },
    search_terms: { type: "STRING" },
    intensity: { type: "STRING", enum: ["light", "moderate", "vigorous", "unknown"] },
    duration_min: { type: "NUMBER", nullable: true },
    distance_km: { type: "NUMBER", nullable: true },
    pace_min_per_km: { type: "STRING", nullable: true },
    start_time: { type: "STRING", nullable: true },
    day: { type: "STRING", enum: ["today", "tomorrow", "unknown"] },
  },
  required: ["activity", "family", "search_terms", "intensity", "day"],
};

async function callGemini(text: string, key: string): Promise<GeminiOut> {
  const families = [...allFamilies().keys()];
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: prompt(families) }] },
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: {
        temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA, thinkingConfig: { thinkingBudget: 0 },
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const body = await res.json();
  const out = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof out !== "string") throw new Error("Gemini returned no text");
  return JSON.parse(out) as GeminiOut;
}

const num = (x: unknown, lo: number, hi: number) => (typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi ? x : null);

export async function parseText(text: string): Promise<LlmParse> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return { ...parseRules(text, "GEMINI_API_KEY is not set, so keywords were matched instead."), family: null, searchTerms: null };
  try {
    const g = await callGemini(text, key);
    const families = allFamilies();
    return {
      activity: (g.activity || text).trim(),
      family: families.has(g.family) ? g.family : null,
      searchTerms: g.search_terms?.trim() || null,
      intensity: g.intensity === "unknown" ? null : g.intensity,
      minutes: num(g.duration_min, 1, 600),
      distanceKm: num(g.distance_km, 0.1, 100),
      pace: g.pace_min_per_km && /^\d{1,2}:[0-5]\d$/.test(g.pace_min_per_km) ? g.pace_min_per_km : null,
      startTime: g.start_time && /^([01]\d|2[0-3]):[0-5]\d$/.test(g.start_time) ? g.start_time : null,
      day: g.day === "unknown" ? null : g.day,
      source: "gemini",
      note: null,
    };
  } catch (e) {
    console.error("Gemini parse failed:", e);
    return { ...parseRules(text, "The language model could not be reached, so keywords were matched instead."), family: null, searchTerms: null };
  }
}
