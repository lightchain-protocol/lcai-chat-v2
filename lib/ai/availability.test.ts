import { describe, expect, it } from "vitest";
import { availabilityOf } from "./availability";

describe("availabilityOf", () => {
  it("stays unknown with too little data", () => {
    expect(availabilityOf("m", {})).toBe("unknown");
    expect(availabilityOf("m", { m: ["completed", "completed"] })).toBe(
      "unknown"
    );
  });

  it("reads good on a clean window", () => {
    expect(
      availabilityOf("m", { m: ["completed", "completed", "completed"] })
    ).toBe("good");
  });

  it("reads shaky when the latest outcome failed", () => {
    expect(
      availabilityOf("m", { m: ["completed", "completed", "failed"] })
    ).toBe("shaky");
  });

  it("reads shaky at 40% failures even when the latest succeeded", () => {
    expect(
      availabilityOf("m", {
        m: ["failed", "completed", "failed", "completed", "completed"],
      })
    ).toBe("shaky");
  });

  it("recovers to good once failures age out of the window", () => {
    expect(
      availabilityOf("m", {
        m: ["failed", "completed", "completed", "completed", "completed"],
      })
    ).toBe("good");
  });
});
