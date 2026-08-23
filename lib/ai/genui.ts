/**
 * Generative UI — consumer-side validation for the `lightchain.genui.v1`
 * contract (lightchain-agents/research/ai-1-generative-ui-contract.md §3).
 *
 * The worker ships JSON data only, never HTML/JS, so the XSS surface is zero
 * by construction — but the payload is still untrusted model output. This
 * module is the contract's validate step: a fully-typed component tree comes
 * out, or null and the renderer falls back to a raw card (the contract's
 * validate→fallback policy — refuse, never guess).
 *
 * v1 is deliberately small (stat / table / chart / markdown + children
 * composition) and frozen: extensions land as v2, never by mutating v1, so
 * unknown component names are rejected here.
 *
 * The renderer is gated by NEXT_PUBLIC_ENABLE_GENUI — the worker-side opt-in
 * wiring (envelope `genui` field) is Phase-2, so no frames exist yet; the
 * flag lets ops force-disable the display path without a deploy. Default on:
 * rendering frames that only exist if a worker opted in is harmless, and the
 * renderer must activate the day the contract is enabled.
 */

export const GENUI_SCHEMA = "lightchain.genui.v1";
export const GENUI_ARTIFACT_TYPE = "genui";

export const GENUI_LIMITS = {
  /** Contract: tables paginate beyond 50 rows. */
  maxTableRows: 50,
  /** Pathological nesting protection for the recursive tree walk. */
  maxDepth: 8,
  maxChildren: 32,
  /** Line/bar series sanity cap — dashboards belong in the artifact store. */
  maxChartPoints: 200,
} as const;

export type GenuiStatProps = {
  label: string;
  value: string | number;
  unit?: string;
  trend?: string;
};
export type GenuiTableProps = {
  columns: { key: string; label: string }[];
  rows: (string | number)[][];
};
export type GenuiChartProps = {
  kind: "line" | "bar";
  x: (string | number)[];
  series: { name: string; data: number[] }[];
};
export type GenuiMarkdownProps = { body: string };

export type GenuiNode = {
  component: "stat" | "table" | "chart" | "markdown";
  props:
    | GenuiStatProps
    | GenuiTableProps
    | GenuiChartProps
    | GenuiMarkdownProps;
  children: GenuiNode[];
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const isCell = (v: unknown): v is string | number =>
  typeof v === "string" || typeof v === "number";

function asStatProps(props: unknown): GenuiStatProps | null {
  if (!isObj(props)) {
    return null;
  }
  if (typeof props.label !== "string" || !isCell(props.value)) {
    return null;
  }
  if (props.unit !== undefined && typeof props.unit !== "string") {
    return null;
  }
  if (props.trend !== undefined && typeof props.trend !== "string") {
    return null;
  }
  return {
    label: props.label,
    value: props.value,
    unit: props.unit as string | undefined,
    trend: props.trend as string | undefined,
  };
}

function asTableProps(props: unknown): GenuiTableProps | null {
  if (!isObj(props)) {
    return null;
  }
  const { columns, rows } = props;
  if (!Array.isArray(columns) || columns.length === 0) {
    return null;
  }
  if (
    !columns.every(
      (c) =>
        isObj(c) && typeof c.key === "string" && typeof c.label === "string"
    )
  ) {
    return null;
  }
  if (!Array.isArray(rows) || rows.length > GENUI_LIMITS.maxTableRows) {
    return null;
  }
  // Row width must match the header exactly — a mismatch is malformed model
  // output, and rendering it would mean guessing which cells go where.
  if (
    !rows.every(
      (r) =>
        Array.isArray(r) &&
        r.length === columns.length &&
        r.every((cell) => isCell(cell))
    )
  ) {
    return null;
  }
  return {
    columns: columns as { key: string; label: string }[],
    rows: rows as (string | number)[][],
  };
}

function asChartProps(props: unknown): GenuiChartProps | null {
  if (!isObj(props)) {
    return null;
  }
  if (props.kind !== "line" && props.kind !== "bar") {
    return null;
  }
  const { x, series } = props;
  if (
    !Array.isArray(x) ||
    x.length === 0 ||
    x.length > GENUI_LIMITS.maxChartPoints ||
    !x.every((v) => isCell(v))
  ) {
    return null;
  }
  if (!Array.isArray(series) || series.length === 0) {
    return null;
  }
  // Numbers only, and every series must span exactly the x axis.
  if (
    !series.every(
      (s) =>
        isObj(s) &&
        typeof s.name === "string" &&
        Array.isArray(s.data) &&
        s.data.length === x.length &&
        s.data.every((d) => typeof d === "number")
    )
  ) {
    return null;
  }
  return {
    kind: props.kind,
    x: x as (string | number)[],
    series: series as { name: string; data: number[] }[],
  };
}

function asMarkdownProps(props: unknown): GenuiMarkdownProps | null {
  if (!isObj(props) || typeof props.body !== "string") {
    return null;
  }
  return { body: props.body };
}

/**
 * Validates one node and its children against `lightchain.genui.v1`.
 * Returns null on any violation — the caller falls back, never guesses.
 */
export function validateGenuiTree(
  payload: unknown,
  depth = 0
): GenuiNode | null {
  if (depth > GENUI_LIMITS.maxDepth || !isObj(payload)) {
    return null;
  }
  const { component, props, children } = payload;

  let validatedProps: GenuiNode["props"] | null = null;
  switch (component) {
    case "stat":
      validatedProps = asStatProps(props);
      break;
    case "table":
      validatedProps = asTableProps(props);
      break;
    case "chart":
      validatedProps = asChartProps(props);
      break;
    case "markdown":
      validatedProps = asMarkdownProps(props);
      break;
    default:
      // v1 is frozen; unknown components are a version the consumer predates.
      return null;
  }
  if (!validatedProps) {
    return null;
  }

  let validatedChildren: GenuiNode[] = [];
  if (children !== undefined) {
    if (
      !Array.isArray(children) ||
      children.length > GENUI_LIMITS.maxChildren
    ) {
      return null;
    }
    validatedChildren = [];
    for (const child of children) {
      const node = validateGenuiTree(child, depth + 1);
      if (!node) {
        return null;
      }
      validatedChildren.push(node);
    }
  }

  return {
    component: component as GenuiNode["component"],
    props: validatedProps,
    children: validatedChildren,
  };
}

/** True when an artifact descriptor is a genui frame. */
export function isGenuiDescriptor(descriptor: {
  artifactType: string;
  schema: string;
}): boolean {
  return (
    descriptor.artifactType === GENUI_ARTIFACT_TYPE &&
    descriptor.schema === GENUI_SCHEMA
  );
}

/**
 * Display-path gate. Default ON — the frames can only exist if a worker
 * opted in, so rendering them is correct the day the contract goes live; the
 * flag exists to force-disable the display path without a redeploy.
 */
export const GENUI_RENDERER_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_GENUI !== "false";
