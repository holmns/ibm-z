import { ServiceError } from "@/lib/openrouter";
import { summarize } from "@/lib/summary";
import type { SummaryFacts } from "@/lib/types";

export async function POST(request: Request) {
  let facts: unknown;
  try {
    facts = (await request.json())?.facts;
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  if (!facts || typeof facts !== "object" || Array.isArray(facts) || JSON.stringify(facts).length > 4000) {
    return Response.json({ error: "Send the assessment's facts." }, { status: 400 });
  }
  try {
    return Response.json({ summary: await summarize(facts as SummaryFacts) });
  } catch (e) {
    if (e instanceof ServiceError) return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ error: "The summary could not be written." }, { status: 500 });
  }
}
