import { afterEach, describe, expect, it, vi } from "vitest";
import { embed } from "../embed";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("embed", () => {
  it("needs OPENROUTER_API_KEY", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    await expect(embed("tai chi")).rejects.toMatchObject({ status: 503 });
  });

  it("asks for text-embedding-3-large and keeps the vector", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: [{ index: 0, embedding: [0.6, 0.8] }] }));
    vi.stubGlobal("fetch", fetch);
    expect(await embed("frisbee")).toEqual([0.6, 0.8]);
    expect(await embed("frisbee")).toEqual([0.6, 0.8]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string))
      .toEqual({ model: "openai/text-embedding-3-large", input: "frisbee", encoding_format: "float" });
  });

  it("answers 502 when OpenRouter fails", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));
    await expect(embed("kayaking")).rejects.toMatchObject({ status: 502 });
  });
});
