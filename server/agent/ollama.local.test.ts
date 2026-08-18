import { describe, expect, it, vi } from "vitest";
import { checkLocalOllamaHealth, getOllamaConfig, isExplicitLocalRuntime, isLocalRequestHost } from "./ollama";

describe("local-only Ollama integration", () => {
  it("defaults to the standard Windows-local Ollama endpoint and configurable model", () => {
    const config = getOllamaConfig();
    expect(config.url).toBe("http://127.0.0.1:11434");
    expect(config.model.length).toBeGreaterThan(2);
  });

  it("recognizes localhost requests while rejecting hosted request hosts", () => {
    expect(isLocalRequestHost("localhost:3000")).toBe(true);
    expect(isLocalRequestHost("127.0.0.1:3000")).toBe(true);
    expect(isLocalRequestHost("agent.example.com")).toBe(false);
  });

  it("does not call Ollama unless both the runtime flag and localhost host are present", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("LOCAL_WINDOWS_RUNTIME", "false");
    const health = await checkLocalOllamaHealth("localhost:3000");

    expect(health.checked).toBe(false);
    expect(health.available).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(isExplicitLocalRuntime()).toBe(false);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
