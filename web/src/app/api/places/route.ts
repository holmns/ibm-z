import type { NextRequest } from "next/server";
import { searchPlaces } from "@/lib/onemap";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return Response.json({ places: [] });
  try {
    return Response.json({ places: await searchPlaces(q) });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Place search is unavailable." }, { status: 502 });
  }
}
