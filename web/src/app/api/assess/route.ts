import { OpenMeteoError } from "@/lib/openmeteo";
import { assessPlan, InputError } from "@/lib/plan";
import type { AssessRequest } from "@/lib/types";

export async function POST(request: Request) {
  let body: AssessRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  try {
    return Response.json(await assessPlan(body));
  } catch (e) {
    if (e instanceof InputError) return Response.json({ error: e.message }, { status: 400 });
    if (e instanceof OpenMeteoError) return Response.json({ error: `Forecast service: ${e.message}` }, { status: 502 });
    console.error(e);
    return Response.json({ error: "The forecast service could not be reached. Try again in a minute." }, { status: 502 });
  }
}
