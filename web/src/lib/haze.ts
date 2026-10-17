// The warning for a plan far enough ahead that the PM2.5 forecast has stopped following the readings.
import { fmt } from "./format";
import { NEA_BANDS, psiBand } from "./risk";
import type { Conditions } from "./types";

// past about 10 hours Google's forecast eases back to a global model that misses haze, so a plan further out than
// 12 hours gets a warning while there is haze now: PSI above 100, or PM2.5 above NEA's normal band
const FORECAST_TRUST_H = 12;
const NEA_NORMAL_TOP = NEA_BANDS[0][0];

export function hazeWarning(r: Conditions, start: number) {
  const hazy = (r.psi && r.psi.value > 100) || (r.pmNow && r.pmNow.pm25 > NEA_NORMAL_TOP);
  if (!hazy || start - r.fetchedAt <= FORECAST_TRUST_H * 3600) return null;
  const now = r.psi ? `NEA's 24-hour PSI for the ${r.psi.region} is ${r.psi.value}, ${psiBand(r.psi.value)}`
    : `PM2.5 here is ${fmt(r.pmNow!.pm25)} µg/m³`;
  return `Haze now: ${now}. Forecasts more than ${FORECAST_TRUST_H} hours out tend to miss haze, so check again closer to the time.`;
}
