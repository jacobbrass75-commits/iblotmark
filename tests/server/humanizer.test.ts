import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { anthropicCreate } = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: anthropicCreate,
    };
  },
}));

describe("humanizer", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    // Vite loads local .env files for tests. Never let a unit test make a
    // paid provider request just because the developer has real keys set.
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects empty text", async () => {
    const { humanizeText } = await import("../../server/humanizer");

    await expect(humanizeText("   ")).rejects.toThrow("Text is required");
  });

  it("rejects oversized text", async () => {
    const { MAX_HUMANIZER_TEXT_LENGTH, humanizeText } = await import("../../server/humanizer");

    await expect(humanizeText("a".repeat(MAX_HUMANIZER_TEXT_LENGTH + 1))).rejects.toThrow(
      `Text exceeds ${MAX_HUMANIZER_TEXT_LENGTH} character limit`
    );
  });

  it("requires at least one provider key", async () => {
    const { humanizeText } = await import("../../server/humanizer");

    await expect(humanizeText("Hello world")).rejects.toThrow(
      "No humanizer provider key configured"
    );
  });

  it("falls back to Anthropic when Gemini fails", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => "rate limited",
      })
    );
    anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "Humanized output" }],
      usage: { input_tokens: 12, output_tokens: 8 },
    });

    const { humanizeText } = await import("../../server/humanizer");
    const result = await humanizeText("Original text");

    expect(result).toEqual({
      humanizedText: "Humanized output",
      provider: "anthropic",
      model: "claude-opus-4-6",
      tokensUsed: 20,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
  });
});
