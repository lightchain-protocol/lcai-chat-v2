import { describe, expect, it } from "vitest";
import {
  buildPromptEnvelope,
  checkImageBudget,
  estimateBase64Bytes,
  MAX_TOTAL_IMAGE_BYTES,
  PROMPT_ENVELOPE_VERSION,
  serializePrompt,
  stripDataUrlPrefix,
} from "./prompt-envelope";

describe("buildPromptEnvelope", () => {
  // A text-only prompt keeps the pre-envelope wire format so the bytes going
  // on chain for the common case are unchanged, and so an older worker that
  // knows nothing about envelopes still reads it correctly.
  it("leaves a text-only prompt as a bare string", () => {
    const built = buildPromptEnvelope("what is 2+2?", []);
    expect(built).toBe("what is 2+2?");
    expect(serializePrompt(built)).toBe("what is 2+2?");
  });

  it("wraps a prompt carrying images in a versioned envelope", () => {
    const built = buildPromptEnvelope("what is this?", ["aGVsbG8="]);
    expect(built).toEqual({
      v: PROMPT_ENVELOPE_VERSION,
      text: "what is this?",
      images: ["aGVsbG8="],
    });

    const parsed = JSON.parse(serializePrompt(built));
    expect(parsed.v).toBe(1);
    expect(parsed.images).toEqual(["aGVsbG8="]);
  });
});

describe("stripDataUrlPrefix", () => {
  it("removes a data URL header", () => {
    expect(stripDataUrlPrefix("data:image/jpeg;base64,QUJD")).toBe("QUJD");
  });

  it("passes bare base64 through untouched", () => {
    expect(stripDataUrlPrefix("QUJD")).toBe("QUJD");
  });
});

describe("estimateBase64Bytes", () => {
  it("accounts for padding", () => {
    // "QQ==" is one byte, "QUJD" is three.
    expect(estimateBase64Bytes("QQ==")).toBe(1);
    expect(estimateBase64Bytes("QUJD")).toBe(3);
  });
});

describe("checkImageBudget", () => {
  it("accepts an empty attachment set", () => {
    expect(checkImageBudget([])).toBeNull();
  });

  // The prompt blob is hard-capped at 126,972 bytes and oversize fails the
  // whole job after the consumer has been charged, so this has to reject
  // before submission rather than after.
  it("rejects a set that would not fit one blob", () => {
    const oversized = "A".repeat(
      Math.ceil((MAX_TOTAL_IMAGE_BYTES * 4) / 3) + 8
    );
    const message = checkImageBudget([oversized]);
    expect(message).toContain("over the");
  });

  it("accepts a set comfortably inside the budget", () => {
    expect(checkImageBudget(["A".repeat(1000)])).toBeNull();
  });
});
