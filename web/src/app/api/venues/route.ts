import { InputError } from "@/lib/plan";
import type { VenuesRequest } from "@/lib/types";
import { alternativeVenues } from "@/lib/venues";

export async function POST(request: Request) {
  let body: VenuesRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  try {
    const venues = await alternativeVenues(body.lat, body.lon, body.start, body, Boolean(body.preferIndoor));
    return Response.json({ venues, preferIndoor: Boolean(body.preferIndoor) });
  } catch (e) {
    if (e instanceof InputError) return Response.json({ error: e.message }, { status: 400 });
    console.error(e);
    return Response.json({ error: "Venue data is unavailable right now." }, { status: 502 });
  }
}
