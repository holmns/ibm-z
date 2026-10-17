// Calls to OpenRouter, keyed by OPENROUTER_API_KEY in web/.env. Any failure comes back as a ServiceError carrying
// the status the API route answers with.
import "server-only";

export class ServiceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

// the parts of an embeddings or chat completions reply that the app reads
export type OpenRouterReply = {
  data?: { embedding?: unknown }[];
  choices?: { message?: { content?: unknown } }[];
};

// what: the feature, as the user would name it ("activity search"); pick returns null if the reply is unusable
export async function openrouter<T>(path: string, body: object, what: string, timeoutMs: number,
  pick: (reply: OpenRouterReply) => T | null): Promise<T> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new ServiceError(`${what[0].toUpperCase()}${what.slice(1)} is not set up: OPENROUTER_API_KEY is missing from web/.env.`, 503);
  try {
    const res = await fetch(`https://openrouter.ai/api/v1/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const out = pick(await res.json());
    if (out === null) throw new Error("the reply had nothing usable");
    return out;
  } catch (e) {
    console.error(`OpenRouter ${path} failed:`, e);
    throw new ServiceError(`The ${what} service could not be reached. Try again in a moment.`, 502);
  }
}
