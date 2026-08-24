import { describe, expect, it } from "vitest";
import { AUTO_MODEL_ID, routePrompt } from "./auto-route";

describe("routePrompt", () => {
  it("routes an attached image to the vision model above every other signal", () => {
    const route = routePrompt({
      prompt: "```ts\nconst x = 1\n``` what does this chart show?",
      hasImage: true,
    });
    expect(route).toEqual({
      modelId: "qwen3-vl-8b",
      reason: "image attached",
    });
  });

  it("routes fenced code to the coder", () => {
    const route = routePrompt({
      prompt: "Explain this:\n```python\ndef f():\n    pass\n```",
      hasImage: false,
    });
    expect(route.modelId).toBe("qwen3-coder-30b");
    expect(route.reason).toBe("code detected");
  });

  it("routes stack traces and file paths to the coder", () => {
    expect(
      routePrompt({
        prompt: "TypeError: cannot read properties of undefined",
        hasImage: false,
      }).modelId
    ).toBe("qwen3-coder-30b");
    expect(
      routePrompt({
        prompt: "why does lib/session.ts throw here?",
        hasImage: false,
      }).modelId
    ).toBe("qwen3-coder-30b");
  });

  it("routes code-worded prose to the coder", () => {
    const route = routePrompt({
      prompt: "Write a function that debounces a callback",
      hasImage: false,
    });
    expect(route.modelId).toBe("qwen3-coder-30b");
  });

  it("routes very long prompts to the long-context model", () => {
    const route = routePrompt({
      prompt: `Summarize this document.\n\n${"lorem ipsum ".repeat(400)}`,
      hasImage: false,
    });
    expect(route).toEqual({
      modelId: "qwen3.8-27b",
      reason: "long prompt",
    });
  });

  it("falls back to the fastest warm model for everyday prompts", () => {
    const route = routePrompt({
      prompt: "What's a good way to organize my week?",
      hasImage: false,
    });
    expect(route).toEqual({
      modelId: "llama3-8b",
      reason: "fastest warm model",
    });
  });

  it("keeps the auto sentinel id out of the chatModels namespace", () => {
    expect(AUTO_MODEL_ID).toBe("auto");
  });
});
