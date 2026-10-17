// Plain-language text for the dashboard.
import type { FactorReason } from "./factors";
import type { Level, PmReason } from "./risk";

export const WMO_CODES: Record<number, string> = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Rime fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Dense drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
  61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
  71: "Slight snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains", 80: "Slight showers", 81: "Showers",
  82: "Violent showers", 85: "Snow showers", 86: "Snow showers", 95: "Thunderstorm", 96: "Thunderstorm with hail",
  99: "Thunderstorm with hail",
};

const WHO_NAMES: Record<string, string> = {
  "WHO guideline": "the WHO 24-hour guideline", "WHO IT-4": "WHO interim target 4", "WHO IT-3": "WHO interim target 3",
  "WHO IT-2": "WHO interim target 2", "WHO IT-1": "WHO's loosest interim target",
};

export function fmt(x: number | null | undefined, digits = 0) {
  if (x === null || x === undefined || !Number.isFinite(x)) return "–";
  return x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function pmReasonText(r: PmReason) {
  if (r.kind === "day-equivalent") {
    return r.tier
      ? `Day-equivalent PM2.5 is ${fmt(r.cEq)} µg/m³, above ${r.tier.value}, ${WHO_NAMES[r.tier.name]}.`
      : `Day-equivalent PM2.5 is ${fmt(r.cEq)} µg/m³, within the WHO 24-hour guideline of 15.`;
  }
  return `One hour of the run reaches ${fmt(r.pm)} µg/m³, NEA ${r.band}. That makes it High on its own.`;
}

export function factorReasonText(r: FactorReason) {
  switch (r.kind) {
    case "heat":
      return `Feels like ${fmt(r.value)}°C, ${r.severity}.`;
    case "uv":
      return `UV index ${fmt(r.value)}, ${r.severity}.`;
    case "rain":
      return `${fmt(r.value)}% chance of rain.`;
    case "thunderstorm":
      return "Thunderstorm forecast during the run. Check NEA lightning alerts before you go.";
  }
}

export const LEVEL_TEXT: Record<Level, string> = { Low: "Low", Medium: "Medium", High: "High" };
