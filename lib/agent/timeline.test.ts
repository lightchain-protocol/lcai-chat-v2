import { describe, expect, it } from "vitest";
import type { ArtifactDescriptor } from "../protocol/audio-stream";
import {
  buildAgentTimeline,
  isAgentDescriptor,
  parseToolCall,
  parseToolResult,
  spendSummary,
} from "./timeline";

const frame = (
  artifactType: string,
  schema: string,
  payload: unknown
): ArtifactDescriptor => ({ artifactType, schema, payload, settled: false });

const CALL = "lightchain.agent.tool_call.v1";
const RESULT = "lightchain.agent.tool_result.v1";

const call = (id: string, callIndex: number, tool = "web_fetch") =>
  frame("tool_call", CALL, {
    id,
    tool,
    arguments: { url: "https://x" },
    callIndex,
  });
const okResult = (id: string, extra: Record<string, unknown> = {}) =>
  frame("tool_result", RESULT, {
    id,
    ok: true,
    result: { bytes: 10 },
    durationMs: 120,
    bytesIn: 64,
    bytesOut: 512,
    ...extra,
  });

describe("parseToolCall / parseToolResult", () => {
  it("accepts well-formed payloads", () => {
    expect(
      parseToolCall({
        id: "c1",
        tool: "web_fetch",
        arguments: {},
        callIndex: 0,
      })
    ).toMatchObject({ id: "c1", tool: "web_fetch", callIndex: 0 });
    expect(
      parseToolResult({ id: "c1", ok: false, error: "spend_guard" })
    ).toMatchObject({ id: "c1", ok: false, error: "spend_guard" });
  });

  it("rejects malformed payloads", () => {
    expect(parseToolCall({ id: "c1", tool: "t", callIndex: -1 })).toBeNull();
    expect(parseToolCall({ id: "", tool: "t", callIndex: 0 })).toBeNull();
    expect(parseToolCall({ id: "c1", callIndex: 0 })).toBeNull();
    expect(parseToolResult({ id: "c1" })).toBeNull();
    expect(parseToolResult({ id: "c1", ok: "yes" })).toBeNull();
    expect(parseToolResult(null)).toBeNull();
  });
});

describe("buildAgentTimeline", () => {
  it("pairs calls with results by id and orders by callIndex", () => {
    const steps = buildAgentTimeline([
      call("b", 1),
      okResult("a"),
      call("a", 0),
      okResult("b"),
    ]);
    expect(steps.map((s) => s.id)).toEqual(["a", "b"]);
    expect(steps.every((s) => s.state === "done")).toBe(true);
    expect(steps[0].durationMs).toBe(120);
  });

  it("leaves an unanswered call running", () => {
    const steps = buildAgentTimeline([call("a", 0)]);
    expect(steps[0].state).toBe("running");
  });

  it("marks ok:false results failed, preserving the spend_guard error", () => {
    const steps = buildAgentTimeline([
      call("a", 0),
      frame("tool_result", RESULT, {
        id: "a",
        ok: false,
        error: "spend_guard",
      }),
    ]);
    expect(steps[0].state).toBe("failed");
    expect(steps[0].error).toBe("spend_guard");
  });

  it("drops malformed frames and non-agent artifacts instead of guessing", () => {
    const steps = buildAgentTimeline([
      call("a", 0),
      frame("tool_call", CALL, { id: "broken" }),
      frame("genui", "lightchain.genui.v1", { component: "stat" }),
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0].id).toBe("a");
  });
});

describe("spendSummary", () => {
  it("rolls up call count and tool I/O bytes", () => {
    const steps = buildAgentTimeline([
      call("a", 0),
      okResult("a"),
      call("b", 1),
      okResult("b", { bytesIn: 128, bytesOut: 256 }),
    ]);
    expect(spendSummary(steps)).toEqual({
      calls: 2,
      bytes: 64 + 512 + 128 + 256,
    });
  });
});

describe("isAgentDescriptor", () => {
  it("matches both agent schemas and nothing else", () => {
    expect(isAgentDescriptor({ artifactType: "tool_call", schema: CALL })).toBe(
      true
    );
    expect(
      isAgentDescriptor({ artifactType: "tool_result", schema: RESULT })
    ).toBe(true);
    expect(isAgentDescriptor({ artifactType: "tool_call", schema: "v2" })).toBe(
      false
    );
    expect(isAgentDescriptor({ artifactType: "genui", schema: CALL })).toBe(
      false
    );
  });
});
