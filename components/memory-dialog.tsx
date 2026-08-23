"use client";

import type { DialogProps } from "@radix-ui/react-dialog";
import { Brain, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MEMORY_LIMITS, type MemoryStore } from "@/lib/memory";
import { cn } from "@/lib/utils";

/**
 * Private memory settings (protocol mode only).
 *
 * The privacy story is stated plainly here because the feature's value
 * depends on it: entries live in this browser's localStorage, are injected
 * into the user's own prompts inside the encrypted envelope only, and never
 * touch chat history, the chain, or any server-side profile. Default OFF.
 */
export function MemoryDialog({
  store,
  onToggle,
  onAdd,
  onRemove,
  onClear,
  ...dialogProps
}: DialogProps & {
  store: MemoryStore;
  onToggle: (enabled: boolean) => void;
  onAdd: (text: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState("");

  const submitDraft = () => {
    if (!draft.trim()) {
      return;
    }
    onAdd(draft);
    setDraft("");
  };

  return (
    <Dialog {...dialogProps}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto rounded-3xl! bg-surface-elevation-light p-0 sm:max-w-md"
        hideClose
      >
        <div className="relative overflow-hidden p-6 sm:p-8">
          <div className="-top-24 -right-20 absolute z-[-1] size-48 rounded-full bg-surface-base-brand-strong opacity-20 blur-[100px]" />

          <DialogClose asChild>
            <button
              aria-label="Close"
              className="absolute top-4 right-4 rounded-full p-1 text-content-soft hover:bg-surface-base-faint"
              type="button"
            >
              <X className="size-5" />
            </button>
          </DialogClose>

          <DialogHeader>
            <DialogTitle asChild>
              <h4 className="-tracking-[0.2px] flex items-center gap-2 font-semibold text-content-strong text-xl leading-[1.2]">
                <Brain className="size-5" />
                Private memory
              </h4>
            </DialogTitle>
            <DialogDescription className="-tracking-[0.16px] mt-1 text-base text-content-default">
              Facts the model should keep in mind — stored only on this device.
            </DialogDescription>
          </DialogHeader>

          <div className="my-6 h-px w-full bg-bdr-light" />

          <p className="mb-4 text-content-soft text-xs leading-relaxed">
            Entries never leave this browser except prepended to your own
            prompts inside the same encrypted envelope as the message itself.
            They are not written to chat history, not on chain, and there is no
            server-side profile. Off by default; turning it off stops injection
            but keeps the entries.
          </p>

          <div className="mb-5 flex items-center justify-between rounded-2xl border border-bdr-light bg-surface-base-subtle p-3">
            <div>
              <p className="text-content-default text-sm">
                {store.enabled ? "Memory is on" : "Memory is off"}
              </p>
              <p className="text-content-light text-xs">
                {store.enabled
                  ? "Prepended to every new prompt before encryption."
                  : "Nothing is injected into your prompts."}
              </p>
            </div>
            <Button
              className="shrink-0"
              onClick={() => onToggle(!store.enabled)}
              size="sm"
              variant={store.enabled ? "outline" : "default"}
            >
              {store.enabled ? "Turn off" : "Turn on"}
            </Button>
          </div>

          <div className="mb-4 flex gap-2">
            <Input
              maxLength={MEMORY_LIMITS.maxEntryChars}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitDraft();
                }
              }}
              placeholder={`One fact, up to ${MEMORY_LIMITS.maxEntryChars} chars`}
              value={draft}
            />
            <Button
              className="shrink-0"
              disabled={!draft.trim()}
              onClick={submitDraft}
              size="sm"
            >
              <Plus className="size-4" />
            </Button>
          </div>

          {store.entries.length > 0 ? (
            <div className="flex max-h-[220px] flex-col gap-1 overflow-y-auto">
              {store.entries.map((entry) => (
                <div
                  className="group flex items-start justify-between gap-2 rounded-xl border border-bdr-light px-3 py-2"
                  key={entry.id}
                >
                  <p className="min-w-0 break-words text-content-default text-sm">
                    {entry.text}
                  </p>
                  <button
                    aria-label="Remove entry"
                    className="shrink-0 rounded p-0.5 text-content-light hover:text-content-soft"
                    onClick={() => onRemove(entry.id)}
                    type="button"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-content-light text-sm">
              Nothing remembered yet.
            </p>
          )}

          {store.entries.length > 0 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-content-light text-xs">
                {store.entries.length}/{MEMORY_LIMITS.maxEntries} entries
              </p>
              <button
                className={cn(
                  "text-content-light text-xs underline hover:text-content-soft"
                )}
                onClick={onClear}
                type="button"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
