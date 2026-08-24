import { describe, expect, it } from "vitest";
import {
  GENUI_LIMITS,
  GENUI_SCHEMA,
  isGenuiDescriptor,
  validateGenuiTree,
} from "./genui";

describe("validateGenuiTree", () => {
  it("accepts a minimal stat card", () => {
    const node = validateGenuiTree({
      component: "stat",
      props: { label: "TVL", value: 1234.5, unit: "LCAI", trend: "up" },
    });
    expect(node).toMatchObject({
      component: "stat",
      props: { label: "TVL", value: 1234.5, unit: "LCAI", trend: "up" },
      children: [],
    });
  });

  it("accepts a table with matching row widths", () => {
    const node = validateGenuiTree({
      component: "table",
      props: {
        columns: [
          { key: "model", label: "Model" },
          { key: "fee", label: "Fee" },
        ],
        rows: [
          ["llama3-8b", 0.001],
          ["qwen3-8b", 0.02],
        ],
      },
    });
    expect(node?.component).toBe("table");
  });

  it("rejects a table with ragged rows rather than guessing cells", () => {
    expect(
      validateGenuiTree({
        component: "table",
        props: {
          columns: [
            { key: "a", label: "A" },
            { key: "b", label: "B" },
          ],
          rows: [["only-one-cell"]],
        },
      })
    ).toBeNull();
  });

  it("enforces the 50-row table cap", () => {
    const columns = [{ key: "n", label: "N" }];
    const rows = Array.from(
      { length: GENUI_LIMITS.maxTableRows + 1 },
      (_, i) => [i]
    );
    expect(
      validateGenuiTree({ component: "table", props: { columns, rows } })
    ).toBeNull();
  });

  it("accepts a line chart with aligned series", () => {
    const node = validateGenuiTree({
      component: "chart",
      props: {
        kind: "line",
        x: ["Mon", "Tue"],
        series: [{ name: "jobs", data: [3, 5] }],
      },
    });
    expect(node?.component).toBe("chart");
  });

  it("rejects charts with misaligned or non-numeric series", () => {
    expect(
      validateGenuiTree({
        component: "chart",
        props: { kind: "bar", x: [1, 2], series: [{ name: "s", data: [1] }] },
      })
    ).toBeNull();
    expect(
      validateGenuiTree({
        component: "chart",
        props: {
          kind: "bar",
          x: [1, 2],
          series: [{ name: "s", data: [1, "two"] }],
        },
      })
    ).toBeNull();
    expect(
      validateGenuiTree({
        component: "chart",
        props: { kind: "pie", x: [1], series: [{ name: "s", data: [1] }] },
      })
    ).toBeNull();
  });

  it("rejects components outside the frozen v1 set", () => {
    expect(validateGenuiTree({ component: "form", props: {} })).toBeNull();
  });

  it("validates children recursively and caps depth", () => {
    const node = validateGenuiTree({
      component: "markdown",
      props: { body: "# Report" },
      children: [{ component: "stat", props: { label: "x", value: 1 } }],
    });
    expect(node?.children).toHaveLength(1);

    // One invalid child poisons the whole tree — no partial guessing.
    expect(
      validateGenuiTree({
        component: "markdown",
        props: { body: "x" },
        children: [{ component: "stat", props: { label: "x" } }],
      })
    ).toBeNull();

    // Deeper than the depth cap.
    let deep: Record<string, unknown> = {
      component: "markdown",
      props: { body: "leaf" },
    };
    for (let i = 0; i < GENUI_LIMITS.maxDepth + 2; i++) {
      deep = { component: "markdown", props: { body: "n" }, children: [deep] };
    }
    expect(validateGenuiTree(deep)).toBeNull();
  });

  it("rejects non-object payloads and missing props", () => {
    expect(validateGenuiTree("stat")).toBeNull();
    expect(validateGenuiTree({ component: "stat" })).toBeNull();
    expect(validateGenuiTree(null)).toBeNull();
  });
});

describe("isGenuiDescriptor", () => {
  it("matches only the genui artifact type + v1 schema pair", () => {
    expect(
      isGenuiDescriptor({ artifactType: "genui", schema: GENUI_SCHEMA })
    ).toBe(true);
    expect(
      isGenuiDescriptor({
        artifactType: "genui",
        schema: "lightchain.genui.v2",
      })
    ).toBe(false);
    expect(
      isGenuiDescriptor({ artifactType: "tool_call", schema: GENUI_SCHEMA })
    ).toBe(false);
  });
});
