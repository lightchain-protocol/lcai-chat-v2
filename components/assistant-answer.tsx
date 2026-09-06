import { cn } from "@/lib/utils";
import { LCAIIcon } from "./icons";

/**
 * The assistant identity avatar — the LCAI mark in a ringed circle that sits
 * to the left of every assistant answer. Extracted so the normal chat message
 * ({@link ./message.tsx}) and each compare column render the exact same mark;
 * compare answers read as normal chat answers that happen to be side by side.
 */
export function AssistantAvatar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-background p-1 ring-1 ring-border",
        className
      )}
    >
      <LCAIIcon size={14} />
    </div>
  );
}
