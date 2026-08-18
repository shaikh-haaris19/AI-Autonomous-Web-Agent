import { describe, expect, it, vi } from "vitest";
import { synthesizeAnswer } from "./ollama";

describe("reader-facing synthesis", () => {
  it("returns one answer and one plain-language conclusion from the local model", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: JSON.stringify({ answer: "The policy applies to eligible homes.", conclusion: "Eligible homeowners can use the policy." }) } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await synthesizeAnswer({
      task: "Who can use the policy?",
      interpretation: { objective: "Identify eligibility", constraints: [], outputFormat: "plain language", entities: [], needsComparison: false },
      evidence: [{ claim: "Eligible homeowners can participate.", excerpt: "The program is open to eligible homeowners." }],
    });

    expect(result).toEqual({ answer: "The policy applies to eligible homes.", conclusion: "Eligible homeowners can use the policy." });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).messages[0].content).toContain("Do not mention websites");
    vi.unstubAllGlobals();
  });
});
