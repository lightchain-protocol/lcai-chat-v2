import { describe, expect, it } from "vitest";
import { isConnectionFailure } from "./connection-failure";

function typeError(message: string): TypeError {
  return new TypeError(message);
}

describe("isConnectionFailure", () => {
  it("recognises every browser's wording for a failed fetch", () => {
    // Chrome, Safari and Firefox each phrase this differently, and matching
    // only one would leave the other two hanging with no message at all.
    expect(isConnectionFailure(typeError("Failed to fetch"))).toBe(true);
    expect(isConnectionFailure(typeError("Load failed"))).toBe(true);
    expect(
      isConnectionFailure(
        typeError("NetworkError when attempting to fetch resource.")
      )
    ).toBe(true);
  });

  it("finds it through a wrapping error", () => {
    // The transport wraps failures before they reach the chat's onError.
    const wrapped = new Error("send failed", {
      cause: typeError("Failed to fetch"),
    });
    expect(isConnectionFailure(wrapped)).toBe(true);
  });

  it("does not mistake a server-sent failure for a connection failure", () => {
    // A 408 or 503 DID reach the server and carries its own accurate copy —
    // claiming "nothing was charged, we couldn't reach the network" there
    // would be wrong on both counts.
    expect(isConnectionFailure(new Error("no_worker_available"))).toBe(false);
    expect(isConnectionFailure(typeError("x is not a function"))).toBe(false);
  });

  it("survives a self-referencing cause chain", () => {
    const a = new Error("a");
    (a as { cause?: unknown }).cause = a;
    expect(() => isConnectionFailure(a)).not.toThrow();
    expect(isConnectionFailure(a)).toBe(false);
  });

  it("handles non-errors", () => {
    for (const value of [null, undefined, "Failed to fetch", 42]) {
      expect(isConnectionFailure(value)).toBe(false);
    }
  });
});
