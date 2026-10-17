import { describe, expect, it } from "vitest";
import { parseRules } from "../parse";

describe("keyword parsing of a plan", () => {
  it.each([
    ["badminton doubles for 90 min", { minutes: 90, intensity: null }],
    ["casual badminton 1.5 hours", { minutes: 90, intensity: "light" }],
    ["Muay Thai sparring 1h30", { minutes: 90, intensity: "vigorous" }],
    ["an hour of park gym", { minutes: 60 }],
    ["10 km run tonight at 8pm at 7:00/km", { distanceKm: 10, pace: "7:00", startTime: "20:00", day: "today" }],
    ["10 km run at East Coast Park tonight at 8pm at 7 min/km", { distanceKm: 10, pace: "7:00", minutes: null, startTime: "20:00" }],
    ["easy 5k, 6.5 minutes per km", { distanceKm: 5, pace: "6:30", minutes: null, intensity: "light" }],
    ["half marathon tomorrow at 6:30", { distanceKm: 21.1, pace: null, startTime: "06:30", day: "tomorrow" }],
    ["5k at a pace of 5:30", { distanceKm: 5, pace: "5:30", startTime: null }],
    ["tai chi", { minutes: null, distanceKm: null, pace: null, startTime: null, intensity: null }],
  ])("%s", (text, want) => {
    expect(parseRules(text)).toMatchObject(want);
  });
});
