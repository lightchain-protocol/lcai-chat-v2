import { describe, expect, it } from "vitest";
import {
  isHexModelId,
  type ResolvableModel,
  resolveModelSelection,
} from "./resolve-model";

const LLAMA_ID =
  "0xf4a414fa51803433e9197f32cda96d5cb2ac8269c481eb0262fe2dd11f428848";
const GPT_ID =
  "0x812058e1dbc4b7ee2b5c8db96cd83bdc110740ae43d3fa4ee116e7e38e2ea802";
const UNSERVED_ID =
  "0x00000000000000000000000000000000000000000000000000000000deadbeef";

const MODELS: ResolvableModel[] = [
  { id: LLAMA_ID, name: "llama3-8b" },
  { id: GPT_ID, name: "gpt-oss:20b" },
];

describe("isHexModelId", () => {
  it("accepts a 32-byte hex id", () => {
    expect(isHexModelId(LLAMA_ID)).toBe(true);
  });

  it("rejects the legacy names the composer can still be holding", () => {
    expect(isHexModelId("llama3-8b")).toBe(false);
    expect(isHexModelId("")).toBe(false);
    expect(isHexModelId("0xabc")).toBe(false);
  });
});

describe("resolveModelSelection", () => {
  it("resolves an id straight through", () => {
    expect(resolveModelSelection(LLAMA_ID, MODELS)?.id).toBe(LLAMA_ID);
  });

  it("resolves the legacy name the first render holds", () => {
    // The regression: no cookie => the page renders with DEFAULT_CHAT_MODEL,
    // which is the name. Sending before /api/models resolved used to throw
    // "not currently available" while llama3-8b had five live workers.
    expect(resolveModelSelection("llama3-8b", MODELS)?.id).toBe(LLAMA_ID);
  });

  it("matches an id whose case drifted", () => {
    expect(resolveModelSelection(LLAMA_ID.toUpperCase(), MODELS)?.id).toBe(
      LLAMA_ID
    );
  });

  it("does not fall back to a name match for an unserved id", () => {
    // Guessing here would send a paid prompt to a model the user never chose.
    expect(resolveModelSelection(UNSERVED_ID, MODELS)).toBeUndefined();
  });

  it("returns undefined for a name nothing serves", () => {
    expect(resolveModelSelection("mistral-7b", MODELS)).toBeUndefined();
  });

  it("returns undefined when the gateway list is empty", () => {
    expect(resolveModelSelection("llama3-8b", [])).toBeUndefined();
  });
});
