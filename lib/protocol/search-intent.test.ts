import { describe, expect, it } from "vitest";
import { needsFreshInformation, shouldSearch } from "./search-intent";

describe("needsFreshInformation", () => {
  it.each([
    "What is the latest version of Next.js?",
    "who is the current president of France",
    "bitcoin price today",
    "How much does a Tesla Model 3 cost?",
    "any news on the port strike",
    "what's new in Python 3.14",
    "who won the game last night",
    "weather in Tokyo tomorrow",
    "GPT-5 release date",
    "search the web for rust async runtimes",
    "what happened in 2026",
    "is GitHub down",
  ])("searches for %j", (prompt) => {
    expect(needsFreshInformation(prompt)).toBe(true);
  });

  it.each([
    "hi",
    "thanks!",
    "good morning",
    "2 + 2",
    "(15 * 3) / 5 =",
    "write a function that reverses a linked list",
    "refactor this component to use hooks",
    "explain this error",
    "translate the following to Spanish",
    "summarize this article for me",
    "what does this code do",
    "who are you",
    "what can you do",
    "are you an AI",
  ])("declines %j", (prompt) => {
    expect(needsFreshInformation(prompt)).toBe(false);
  });

  // The prompt that first exposed the problem: it reads as a live question
  // but is about the assistant, and searching returned five results about
  // other people's models.
  it("declines a question about the assistant's own speed", () => {
    expect(needsFreshInformation("How quick does this model respond")).toBe(
      false
    );
  });

  it("declines anything containing a fenced code block", () => {
    const prompt = "why is this slow?\n```js\nfor (;;) {}\n```";
    expect(needsFreshInformation(prompt)).toBe(false);
  });

  // A decline signal and a fresh signal in the same prompt resolves to no
  // search, because the material to work on is already in the prompt.
  it("prefers the decline when both signals are present", () => {
    expect(
      needsFreshInformation("rewrite this paragraph to sound more current")
    ).toBe(false);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(needsFreshInformation("   LATEST NEWS ON AI   ")).toBe(true);
  });

  it("declines an empty prompt", () => {
    expect(needsFreshInformation("")).toBe(false);
    expect(needsFreshInformation("   ")).toBe(false);
  });
});

describe("shouldSearch", () => {
  it("always searches when the control is on", () => {
    expect(shouldSearch("on", "hi")).toBe(true);
  });

  it("never searches when the control is off", () => {
    expect(shouldSearch("off", "bitcoin price today")).toBe(false);
  });

  it("defers to the heuristic on auto", () => {
    expect(shouldSearch("auto", "bitcoin price today")).toBe(true);
    expect(shouldSearch("auto", "write me a haiku")).toBe(false);
  });
});
