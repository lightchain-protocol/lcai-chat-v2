import { describe, expect, it } from "vitest";
import {
  chatModels,
  formatFee,
  groupModelsBySpecialty,
  modelSpecialty,
  modelSupportsImages,
  SPECIALTY_ORDER,
  starterPrompts,
} from "./models";

describe("modelSupportsImages", () => {
  it("allows the vision model", () => {
    expect(modelSupportsImages("qwen3-vl-8b")).toBe(true);
  });

  // Attaching an image to a text-only model spends blob budget the consumer
  // pays for on bytes the model cannot read.
  it("rejects text-only models and unknown ids", () => {
    expect(modelSupportsImages("llama3-8b")).toBe(false);
    expect(modelSupportsImages("does-not-exist")).toBe(false);
    expect(modelSupportsImages(undefined)).toBe(false);
  });
});

describe("groupModelsBySpecialty", () => {
  it("covers every catalogued model exactly once", () => {
    const grouped = groupModelsBySpecialty();
    const seen = grouped.flatMap((g) => g.models.map((m) => m.id));
    expect(seen.sort()).toEqual(chatModels.map((m) => m.id).sort());
  });

  it("keeps groups in the declared display order", () => {
    const grouped = groupModelsBySpecialty();
    const order = grouped.map((g) => g.specialty);
    expect(order).toEqual(SPECIALTY_ORDER.filter((s) => order.includes(s)));
  });

  it("drops empty groups when filtering", () => {
    const codingOnly = chatModels.filter(
      (m) => modelSpecialty(m.id) === "Coding"
    );
    const grouped = groupModelsBySpecialty(codingOnly);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].specialty).toBe("Coding");
  });
});

describe("formatFee", () => {
  // Fees are small fractions; a fixed-decimal render would show 0.0500.
  it("trims trailing zeros", () => {
    expect(formatFee(0.05)).toBe("0.05 LCAI");
    expect(formatFee(0.001)).toBe("0.001 LCAI");
    expect(formatFee(1)).toBe("1 LCAI");
  });
});

describe("starterPrompts", () => {
  it("matches the suggestion set to what the model is for", () => {
    expect(starterPrompts("qwen3-vl-8b").join(" ")).toContain("image");
    expect(starterPrompts("qwen3-coder-30b").join(" ")).toContain("function");
  });

  it("falls back to general prompts for an unknown model", () => {
    expect(starterPrompts(undefined)).toEqual(starterPrompts("llama3-8b"));
    expect(starterPrompts("nonexistent")).toEqual(starterPrompts("llama3-8b"));
  });
});
