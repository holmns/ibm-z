import { lookupActivity } from "@/lib/lookup";
import { ServiceError } from "@/lib/openrouter";

export async function POST(request: Request) {
  let text: unknown;
  try {
    text = (await request.json())?.text;
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  if (typeof text !== "string" || !text.trim()) return Response.json({ error: "Describe the activity first." }, { status: 400 });
  if (text.length > 300) return Response.json({ error: "Keep the description under 300 characters." }, { status: 400 });
  try {
    return Response.json(await lookupActivity(text.trim()));
  } catch (e) {
    if (e instanceof ServiceError) return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ error: "The activity database could not be read." }, { status: 500 });
  }
}
