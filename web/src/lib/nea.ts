// NEA's latest 24-hour PSI for the region nearest a place, from data.gov.sg: the number Singapore news quotes.
import "server-only";
import type { Psi } from "./types";

const PSI_URL = "https://api-open.data.gov.sg/v2/real-time/api/psi";
// farther than this from every region's label point, the place isn't in Singapore
const MAX_DEG = 0.3;

type PsiBody = {
  data?: {
    regionMetadata?: { name: string; labelLocation: { latitude: number; longitude: number } }[];
    items?: { timestamp?: string; updatedTimestamp?: string; readings?: { psi_twenty_four_hourly?: Record<string, number> } }[];
  };
};

let cache: { hour: number; body: Promise<PsiBody> } | null = null;

// null when NEA can't be reached or the place is outside Singapore; the dashboard just leaves PSI out
export async function neaPsi(lat: number, lon: number): Promise<Psi | null> {
  const hour = Math.floor(Date.now() / 3_600_000);
  if (cache?.hour !== hour) {
    const body = fetch(PSI_URL, { cache: "no-store", signal: AbortSignal.timeout(10_000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`data.gov.sg PSI HTTP ${r.status}`))));
    cache = { hour, body };
    body.catch(() => cache?.body === body && (cache = null));
  }
  try {
    const { data } = await cache.body;
    const item = data?.items?.at(-1);
    const readings = item?.readings?.psi_twenty_four_hourly;
    const when = item?.timestamp ?? item?.updatedTimestamp;
    if (!readings || !when) return null;
    let best: { region: string; d: number } | null = null;
    for (const r of data?.regionMetadata ?? []) {
      const d = Math.hypot(r.labelLocation.latitude - lat, r.labelLocation.longitude - lon);
      if (typeof readings[r.name] === "number" && (!best || d < best.d)) best = { region: r.name, d };
    }
    if (!best || best.d > MAX_DEG) return null;
    return { value: readings[best.region], region: best.region, t: Date.parse(when) / 1000 };
  } catch (e) {
    console.error("NEA PSI failed:", e);
    return null;
  }
}
