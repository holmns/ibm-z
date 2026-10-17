import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { matchVector } from "../activities";
import type { Intensity } from "../session";

// queries made from the database's own description embeddings, so the ranking rules run without the API
const db = new DatabaseSync(process.env.HAZEWISE_DB || path.join(process.cwd(), "..", "hazewise.db"), { readOnly: true });
const vec = (code: string): number[] =>
  JSON.parse((db.prepare("select embedding from activities where code = ?").get(code) as { embedding: string }).embedding);
const mix = (...parts: [string, number][]) =>
  parts.map(([c, w]) => vec(c).map((x) => x * w)).reduce((a, b) => a.map((x, i) => x + b[i]));

function pick(q: number[], intensity: Intensity | null = null) {
  const m = matchVector(q, intensity).match;
  return m && { code: m.code, family: m.family, intensity: m.intensity };
}

describe("matchVector", () => {
  it("a family row gives the family at the text's intensity, moderate if it names none", () => {
    // Badminton, social singles and doubles is the badminton family's light row
    expect(pick(vec("15030"))).toEqual({ code: "15020", family: "badminton", intensity: "moderate" });
    expect(pick(vec("15030"), "light")).toEqual({ code: "15030", family: "badminton", intensity: "light" });
  });

  it("any other row is its own code, whatever the intensity", () => {
    expect(pick(vec("15252"), "vigorous")).toEqual({ code: "15252", family: null, intensity: null }); // Frisbee golf
  });

  it("a family row just behind the best row takes its place", () => {
    // Tennis, doubles is in no family; mixed with Tennis, general it stays the best row, with a tennis row close behind
    expect(pick(vec("15685"))).toMatchObject({ code: "15685", family: null });
    expect(pick(mix(["15685", 1], ["15675", 0.9]))).toMatchObject({ family: "tennis" });
  });

  it("among other near ties, the row whose effort is the text's intensity wins, moderate if it names none", () => {
    expect(pick(vec("18104"))).toMatchObject({ code: "18104" }); // Kayaking, competition
    const q = mix(["18104", 1], ["18100", 0.8]); // still Kayaking, competition first, Kayaking, moderate effort close
    expect(matchVector(q).match?.code).toBe("18100");
    expect(matchVector(q, "light").match?.code).toBe("18104");
  });

  it("every row under Running is a run, for the pace model", () => {
    expect(pick(vec("12200"))).toMatchObject({ family: "running" }); // Running, marathon
    expect(pick(vec("12410"))).toMatchObject({ family: "running" }); // Running curved treadmill
  });

  it("a text near nothing is not found", () => {
    let x = 1; // a fixed pseudo-random direction, about orthogonal to every description
    const q = vec("15030").map(() => (x = (x * 48271) % 2147483647) / 2147483647 - 0.5);
    const r = matchVector(q);
    expect(r.match).toBeNull();
    expect(r.similarity).toBeLessThan(0.2);
  });

  it("rejects a vector from another model", () => {
    expect(() => matchVector([1, 0, 0])).toThrow(/dimensions/);
  });
});
