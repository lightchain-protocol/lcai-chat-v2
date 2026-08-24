import { describe, expect, it } from "vitest";
import {
  baseModelId,
  fromMaxModelId,
  isMaxModel,
  MAX_TIER_SUFFIX,
  tierOfModelId,
  toMaxModelId,
} from "./heat-tiers";
import {
  type ChatModel,
  effectiveFee,
  hasAnyMaxVariant,
  hasMaxVariant,
  modelSupportsVoice,
  modelSpecialty,
  resolveTierModelId,
} from "./models";

const WITH_MAX: ChatModel[] = [
  { id: "base-8b", name: "base-8b", description: "", fee: 0.02, maxOutputTokens: 2048 },
  { id: "base-8b-max", name: "base-8b-max", description: "", fee: 0.08, maxOutputTokens: 8192 },
];

describe("heat tier id helpers", () => {
  it("round-trips the -max suffix", () => {
    expect(toMaxModelId("llama3-8b")).toBe(`llama3-8b${MAX_TIER_SUFFIX}`);
    expect(fromMaxModelId("llama3-8b-max")).toBe("llama3-8b");
    expect(fromMaxModelId("llama3-8b")).toBeNull();
    expect(isMaxModel("llama3-8b-max")).toBe(true);
    expect(isMaxModel("llama3-8b")).toBe(false);
    expect(baseModelId("llama3-8b-max")).toBe("llama3-8b");
    expect(baseModelId("llama3-8b")).toBe("llama3-8b");
    expect(tierOfModelId("llama3-8b-max")).toBe("max");
    expect(tierOfModelId("llama3-8b")).toBe("standard");
  });
});

describe("catalogue-driven tier resolution", () => {
  it("resolves to the Max id only when the variant exists", () => {
    expect(resolveTierModelId("base-8b", "max", WITH_MAX)).toBe("base-8b-max");
    expect(resolveTierModelId("base-8b", "standard", WITH_MAX)).toBe("base-8b");
    // No Max entry → arming Max is a no-op, never an unknown id.
    expect(resolveTierModelId("other", "max", WITH_MAX)).toBe("other");
  });

  it("reads availability off the catalogue", () => {
    expect(hasMaxVariant("base-8b", WITH_MAX)).toBe(true);
    expect(hasMaxVariant("other", WITH_MAX)).toBe(false);
    expect(hasAnyMaxVariant(WITH_MAX)).toBe(true);
    expect(hasAnyMaxVariant([])).toBe(false);
    // The shipped catalogue has no -max entries yet: everything no-ops.
    expect(hasAnyMaxVariant()).toBe(false);
    expect(resolveTierModelId("llama3-8b", "max")).toBe("llama3-8b");
  });

  it("quotes the fee of the entry that will actually be charged", () => {
    expect(effectiveFee("base-8b", "max", WITH_MAX)).toBe(0.08);
    expect(effectiveFee("base-8b", "standard", WITH_MAX)).toBe(0.02);
    expect(effectiveFee("other", "max", WITH_MAX)).toBeUndefined();
  });

  it("keys traits and capabilities off the base id", () => {
    expect(modelSpecialty("gpt-oss-20b-max")).toBe("General");
    expect(modelSupportsVoice("gpt-oss-20b-max")).toBe(true);
    expect(modelSupportsVoice("llama3-8b-max")).toBe(false);
  });
});
