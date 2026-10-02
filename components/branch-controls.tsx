"use client";

import { ChevronLeft, ChevronRight, GitFork, Plus } from "lucide-react";
import { Action } from "./elements/actions";

export type BranchControlsData = {
  /** Non-null once this message anchors branches: which tail is on screen. */
  nav: { index: number; count: number } | null;
  /** False on the last message — there is no tail to preserve yet. */
  canFork: boolean;
  onFork: () => void;
  onSwitch: (index: number) => void;
  onAdd: () => void;
};

/**
 * Fork + sibling navigator for conversation branching. Branches are a
 * device-local view over the flat message list (lib/branches.ts), so the
 * tooltips say where the data lives rather than implying anything syncs.
 */
export function BranchControls({ branch }: { branch: BranchControlsData }) {
  const nav = branch.nav;
  return (
    <>
      {branch.canFork && (
        <Action
          data-testid="message-fork"
          onClick={branch.onFork}
          tooltip="Fork from here — keeps the current continuation as a switchable branch (stored on this device)"
        >
          <GitFork />
        </Action>
      )}
      {nav && (
        <div className="flex items-center gap-0.5 text-content-light text-xs">
          <Action
            className="size-7 p-1"
            disabled={nav.index === 0}
            onClick={() => branch.onSwitch(nav.index - 1)}
            tooltip="Previous branch"
          >
            <ChevronLeft />
          </Action>
          <span className="min-w-7 text-center tabular-nums">
            {nav.index + 1}/{nav.count}
          </span>
          <Action
            className="size-7 p-1"
            disabled={nav.index === nav.count - 1}
            onClick={() => branch.onSwitch(nav.index + 1)}
            tooltip="Next branch"
          >
            <ChevronRight />
          </Action>
          <Action
            className="size-7 p-1"
            onClick={branch.onAdd}
            tooltip="New branch from here"
          >
            <Plus />
          </Action>
        </div>
      )}
    </>
  );
}
