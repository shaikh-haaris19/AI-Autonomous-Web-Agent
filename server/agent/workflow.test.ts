import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  createResearchRun: vi.fn(async (snapshot) => snapshot),
  updateResearchRun: vi.fn(async (snapshot) => snapshot),
  getResearchRun: vi.fn(async () => null),
}));

import { createRun, executeRun } from "./workflow";
import * as webTools from "./webTools";

describe("query routing: local model decides web search vs. direct answer", () => {
  beforeEach(() => {
    // No local Ollama runtime is available in the test environment, so interpretTask,
    // createPlan, and answerDirectly all fail over to their deterministic fallbacks -
    // this exercises the same fallback heuristics a disconnected local runtime would hit.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network disabled in tests");
      }),
    );
  });

  it("answers a calculation directly and never calls the web-search tool", async () => {
    const webSearchSpy = vi.spyOn(webTools, "webSearch");

    const run = await createRun("What is 482 * 17?");
    const result = await executeRun(run.id);

    expect(result.status).toBe("completed");
    expect(result.interpretation?.needsWebSearch).toBe(false);
    expect(result.plan.map((step) => step.tool)).toEqual(["answer_directly"]);
    expect(result.sources).toEqual([]);
    expect(webSearchSpy).not.toHaveBeenCalled();
  });

  it("still routes a time-sensitive question through the web-search plan", async () => {
    const webSearchSpy = vi.spyOn(webTools, "webSearch").mockImplementation(async () => {
      throw new Error("network disabled in tests");
    });

    const run = await createRun("What is the current price of gold today?");
    const result = await executeRun(run.id);

    expect(result.interpretation?.needsWebSearch).toBe(true);
    expect(result.plan.some((step) => step.tool === "web_search")).toBe(true);
    expect(webSearchSpy).toHaveBeenCalled();
  });
});
