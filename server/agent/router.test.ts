import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

vi.mock("../db", () => ({
  createResearchRun: vi.fn(async (snapshot) => snapshot),
  updateResearchRun: vi.fn(async (snapshot) => snapshot),
  getResearchRun: vi.fn(async () => null),
}));

import { appRouter } from "../routers";

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("agent tRPC procedures", () => {
  it("creates and retrieves a structured research run", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const created = await caller.agent.create({ task: "Compare current public renewable-energy policies in California." });
    const retrieved = await caller.agent.get({ runId: created.id });

    expect(created.status).toBe("queued");
    expect(retrieved.originalRequest).toContain("renewable-energy policies");
    expect(retrieved.activities[0]?.message).toBe("Research run created.");
  });

  it("pauses a high-impact request until explicit confirmation is supplied", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const created = await caller.agent.create({ task: "Research the lowest price and purchase the best option." });
    const paused = await caller.agent.execute({ runId: created.id });

    expect(paused.status).toBe("needs_confirmation");
    expect(paused.phase).toBe("needs_confirmation");
    expect(paused.confirmation).toMatchObject({ action: "purchase", required: true });
  });
});
