/**
 * Agent mode — consumer-side mapping of tool_call/tool_result artifact
 * frames into a step timeline (wire conventions pinned by
 * lightchain-agents/research/ai-1-agent-mode-design.md §4).
 *
 * Agent mode itself is Phase-2 contract-gated (a tool loop cannot fit the
 * 120 s completionTimeout), so no composer entry point ships — this module
 * only renders the artifact conventions, which are live today. tool_call and
 * tool_result frames pair by `id`; a call with no result yet is "running",
 * a result with ok:false is "failed" (including the worker's terminal
 * spend_guard frame, which the design says accompanies a settled partial
 * answer).
 *
 * The spend counter is display-only: envelope v3 (agent.maxToolCalls /
 * maxToolBytes / allowedTools / maxWallMs) doesn't exist yet, so the caps
 * shown are the design doc's defaults, labeled as such.
 */

import type { ArtifactDescriptor } from "../protocol/audio-stream";

export const TOOL_CALL_SCHEMA = "lightchain.agent.tool_call.v1";
export const TOOL_RESULT_SCHEMA = "lightchain.agent.tool_result.v1";

/** Envelope v3 defaults from the design doc §5 — display-only placeholders. */
export const AGENT_SPEND_DEFAULTS = {
  maxToolCalls: 8,
  maxToolBytes: 256 * 1024,
} as const;

export type ToolCallPayload = {
  id: string;
  tool: string;
  arguments: unknown;
  callIndex: number;
};

export type ToolResultPayload = {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
  durationMs?: number;
  bytesIn?: number;
  bytesOut?: number;
};

export type AgentStep = {
  id: string;
  callIndex: number;
  tool: string;
  arguments: unknown;
  state: "running" | "done" | "failed";
  result?: unknown;
  error?: string;
  durationMs?: number;
  bytesIn?: number;
  bytesOut?: number;
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const optNumber = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

export function parseToolCall(payload: unknown): ToolCallPayload | null {
  if (!isObj(payload)) {
    return null;
  }
  if (
    typeof payload.id !== "string" ||
    payload.id.length === 0 ||
    typeof payload.tool !== "string" ||
    payload.tool.length === 0 ||
    typeof payload.callIndex !== "number" ||
    !Number.isInteger(payload.callIndex) ||
    payload.callIndex < 0
  ) {
    return null;
  }
  return {
    id: payload.id,
    tool: payload.tool,
    arguments: payload.arguments,
    callIndex: payload.callIndex,
  };
}

export function parseToolResult(payload: unknown): ToolResultPayload | null {
  if (!isObj(payload)) {
    return null;
  }
  if (typeof payload.id !== "string" || payload.id.length === 0) {
    return null;
  }
  if (typeof payload.ok !== "boolean") {
    return null;
  }
  if (payload.error !== undefined && typeof payload.error !== "string") {
    return null;
  }
  return {
    id: payload.id,
    ok: payload.ok,
    result: payload.result,
    error: payload.error as string | undefined,
    durationMs: optNumber(payload.durationMs),
    bytesIn: optNumber(payload.bytesIn),
    bytesOut: optNumber(payload.bytesOut),
  };
}

/** True when a descriptor is one of the two agent-mode artifact schemas. */
export function isAgentDescriptor(descriptor: {
  artifactType: string;
  schema: string;
}): boolean {
  return (
    (descriptor.artifactType === "tool_call" &&
      descriptor.schema === TOOL_CALL_SCHEMA) ||
    (descriptor.artifactType === "tool_result" &&
      descriptor.schema === TOOL_RESULT_SCHEMA)
  );
}

/**
 * Folds a message's artifact descriptors into ordered timeline steps:
 * tool_call/tool_result pairs joined by id, sorted by callIndex, a call with
 * no result left "running". Malformed frames are dropped, not guessed at —
 * the same refuse-don't-guess rule as every artifact renderer.
 */
export function buildAgentTimeline(
  descriptors: ArtifactDescriptor[]
): AgentStep[] {
  const calls = new Map<string, ToolCallPayload>();
  const results = new Map<string, ToolResultPayload>();

  for (const d of descriptors) {
    if (d.artifactType === "tool_call" && d.schema === TOOL_CALL_SCHEMA) {
      const call = parseToolCall(d.payload);
      if (call) {
        calls.set(call.id, call);
      }
    } else if (
      d.artifactType === "tool_result" &&
      d.schema === TOOL_RESULT_SCHEMA
    ) {
      const result = parseToolResult(d.payload);
      if (result) {
        results.set(result.id, result);
      }
    }
  }

  return [...calls.values()]
    .sort((a, b) => a.callIndex - b.callIndex)
    .map((call) => {
      const result = results.get(call.id);
      return {
        id: call.id,
        callIndex: call.callIndex,
        tool: call.tool,
        arguments: call.arguments,
        state: result ? (result.ok ? "done" : "failed") : "running",
        result: result?.result,
        error: result?.error,
        durationMs: result?.durationMs,
        bytesIn: result?.bytesIn,
        bytesOut: result?.bytesOut,
      } satisfies AgentStep;
    });
}

/** Display-only spend rollup; caps shown against the design-doc defaults. */
export function spendSummary(steps: AgentStep[]): {
  calls: number;
  bytes: number;
} {
  return {
    calls: steps.length,
    bytes: steps.reduce(
      (sum, s) => sum + (s.bytesIn ?? 0) + (s.bytesOut ?? 0),
      0
    ),
  };
}
