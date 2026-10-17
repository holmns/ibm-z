// The sentence or two under the risk title, written by an open-weight model through OpenRouter. The model only
// rephrases facts the dashboard already shows (SummaryFacts), so it never supplies a number of its own.
// SUMMARY_MODEL overrides the model.
import "server-only";
import { openrouter } from "./openrouter";
import type { SummaryFacts } from "./types";

// DeepSeek-V4.1-Flash, open weights. Tried on the same facts: it kept to them in about 1 s, where
// ibm-granite/granite-4.2-8b and nvidia/nemotron-3.5-lightning added advice the report doesn't give.
export const SUMMARY_MODEL = "deepseek/deepseek-v4.1-flash";

const SYSTEM = `You write the short summary under the title of an outdoor exercise risk report for Singapore. The user message is the report's facts as JSON.

Write one or two sentences, 35 words at most, in plain English, to the person doing the activity ("you").
- Say what drives the risk, with its figure, then the most useful thing to do, which is the \`suggestion\` field.
- If \`raisedBy\` is empty, nothing raises the risk. Say the conditions are fine for it, without naming a driver.
- If \`forecastCaveat\` is set, end with a short clause saying there is haze now and to check again nearer the time.
- Use only facts and numbers from the JSON, written as they appear. Never add a number, a health claim or advice that isn't there.
- The risk level, place, time and plan are shown around the summary. Don't repeat them.
- Plain text only: no markdown, emoji, greeting, quotes or dashes.`;

const CACHE_SIZE = 200;
const cache = new Map<string, string>();

// models still slip in a dash or wrapping quotes now and then
export function tidy(text: string) {
  return text.trim().replace(/^["'“]+|["'”]+$/g, "").replace(/\s*[—–]\s*/g, ", ").replace(/\s+/g, " ").trim();
}

export async function summarize(facts: SummaryFacts): Promise<string> {
  const key = JSON.stringify(facts);
  const hit = cache.get(key);
  if (hit) return hit;
  const text = await openrouter("chat/completions", {
    model: process.env.SUMMARY_MODEL?.trim() || SUMMARY_MODEL,
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content: key }],
    temperature: 0.2,
    max_tokens: 160,
    reasoning: { enabled: false },
    provider: { sort: "latency" },
  }, "summary", 20_000, (r) => {
    const c = r.choices?.[0]?.message?.content;
    return typeof c === "string" && tidy(c) ? tidy(c) : null;
  });
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
  cache.set(key, text);
  return text;
}
