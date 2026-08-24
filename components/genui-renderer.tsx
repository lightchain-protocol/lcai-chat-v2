"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import type {
  GenuiChartProps,
  GenuiMarkdownProps,
  GenuiNode,
  GenuiStatProps,
  GenuiTableProps,
} from "@/lib/ai/genui";
import { cn } from "@/lib/utils";
import { Response } from "./elements/response";

/**
 * Renderer for validated `lightchain.genui.v1` trees (validation lives in
 * lib/ai/genui.ts — this component only sees trees that already passed).
 *
 * Charts: no chart runtime exists in the dependency set and the owner barred
 * adding heavy deps, so chart nodes render an honest fallback card instead of
 * a plot — the data is shown as a small table, which keeps the information
 * without pretending to be a chart.
 */

function StatNode({ props }: { props: GenuiStatProps }) {
  const trend =
    props.trend === "up" ? (
      <TrendingUp className="size-3.5 text-emerald-500" />
    ) : props.trend === "down" ? (
      <TrendingDown className="size-3.5 text-rose-500" />
    ) : null;
  return (
    <div className="rounded-xl border border-bdr-light bg-surface-base-subtle/40 p-3">
      <p className="text-content-light text-xs">{props.label}</p>
      <p className="mt-1 flex items-baseline gap-1.5 font-semibold text-content-strong text-xl">
        {props.value}
        {props.unit && (
          <span className="font-normal text-content-soft text-xs">
            {props.unit}
          </span>
        )}
        {trend}
      </p>
    </div>
  );
}

function TableNode({ props }: { props: GenuiTableProps }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-bdr-light">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-bdr-light border-b bg-surface-base-subtle/60">
            {props.columns.map((col) => (
              <th
                className="px-3 py-1.5 text-left font-medium text-content-soft"
                key={col.key}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, rowIndex) => (
            <tr
              className="border-bdr-light border-b last:border-0"
              // biome-ignore lint/suspicious/noArrayIndexKey: genui rows carry no ids; order is the identity.
              key={rowIndex}
            >
              {row.map((cell, cellIndex) => (
                <td
                  className="px-3 py-1.5 text-content-default"
                  // biome-ignore lint/suspicious/noArrayIndexKey: see row key.
                  key={cellIndex}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartNode({ props }: { props: GenuiChartProps }) {
  return (
    <div className="rounded-xl border border-bdr-light border-dashed p-3">
      <p className="mb-2 text-content-light text-xs">
        {props.kind === "line" ? "Line" : "Bar"} chart — chart rendering
        isn&apos;t available in this build, showing the data as a table.
      </p>
      <TableNode
        props={{
          columns: [
            { key: "x", label: "x" },
            ...props.series.map((s) => ({ key: s.name, label: s.name })),
          ],
          rows: props.x.map((x, i) => [
            x,
            ...props.series.map((s) => s.data[i]),
          ]),
        }}
      />
    </div>
  );
}

function GenuiNodeView({ node }: { node: GenuiNode }) {
  return (
    <div className="flex flex-col gap-2">
      {node.component === "stat" && (
        <StatNode props={node.props as GenuiStatProps} />
      )}
      {node.component === "table" && (
        <TableNode props={node.props as GenuiTableProps} />
      )}
      {node.component === "chart" && (
        <ChartNode props={node.props as GenuiChartProps} />
      )}
      {node.component === "markdown" && (
        <Response>{(node.props as GenuiMarkdownProps).body}</Response>
      )}
      {node.children.length > 0 && (
        <div
          className={cn(
            "grid gap-2",
            node.children.length > 1 && "sm:grid-cols-2"
          )}
        >
          {node.children.map((child, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: genui nodes carry no ids; tree position is the identity.
            <GenuiNodeView key={i} node={child} />
          ))}
        </div>
      )}
    </div>
  );
}

export function GenuiRenderer({ node }: { node: GenuiNode }) {
  return (
    <div className="text-content-default" data-testid="genui-renderer">
      <GenuiNodeView node={node} />
    </div>
  );
}
