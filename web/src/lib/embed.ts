// Text -> vector with the model that filled activities.embedding (create-embedding.py): OpenAI's
// text-embedding-3-large through OpenRouter.
import "server-only";
import { openrouter } from "./openrouter";

export const EMBEDDING_MODEL = "openai/text-embedding-3-large";

// the same few texts come back often (the default "Running", a re-run lookup), so keep recent vectors
const CACHE_SIZE = 500;
const cache = new Map<string, number[]>();

export async function embed(text: string): Promise<number[]> {
  const hit = cache.get(text);
  if (hit) return hit;
  const v = await openrouter("embeddings", { model: EMBEDDING_MODEL, input: text, encoding_format: "float" },
    "activity search", 12_000, (r) => {
      const e = r.data?.[0]?.embedding;
      return Array.isArray(e) && e.length && e.every(Number.isFinite) ? (e as number[]) : null;
    });
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
  cache.set(text, v);
  return v;
}
