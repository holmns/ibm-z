import { isHeatTile } from "@/lib/airmap";
import { heatTile, secondsToHour } from "@/lib/aqtiles";

export async function GET(_request: Request, ctx: RouteContext<"/api/aq-tiles/[z]/[x]/[y]">) {
  const { z, x, y } = await ctx.params;
  const [zi, xi, yi] = [z, x, y].map(Number);
  if (!isHeatTile(zi, xi, yi)) return Response.json({ error: "No heat map tile there." }, { status: 404 });
  const tile = heatTile(zi, xi, yi);
  if (!tile) return Response.json({ error: "GOOGLE_MAPS_API_KEY is not set." }, { status: 503 });
  try {
    return new Response(await tile, {
      headers: { "content-type": "image/png", "cache-control": `public, max-age=${secondsToHour()}` },
    });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "The heat map is unavailable right now." }, { status: 502 });
  }
}
