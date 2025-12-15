"use client";

import { type ReactNode, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useChatVisibility } from "@/hooks/use-chat-visibility";
import { cn } from "@/lib/utils";
import { ChevronDown, Globe, Lock, LucideIcon, LucideProps } from "lucide-react";

export type VisibilityType = "private" | "public";

const visibilities: Array<{
  id: VisibilityType;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    id: "private",
    label: "Private",
    description: "Only you can access this chat",
    icon: Lock ,
  },
  {
    id: "public",
    label: "Public",
    description: "Anyone with the link can access this chat",
    icon: Globe,
  },
];

export function VisibilitySelector({
  chatId,
  className,
  selectedVisibilityType,
}: {
  chatId: string;
  selectedVisibilityType: VisibilityType;
} & React.ComponentProps<typeof Button>) {
  const [open, setOpen] = useState(false);

  const { visibilityType, setVisibilityType } = useChatVisibility({
    chatId,
    initialVisibilityType: selectedVisibilityType,
  });

  const selectedVisibility = useMemo(
    () => visibilities.find((visibility) => visibility.id === visibilityType),
    [visibilityType]
  );

  return (
    <DropdownMenu onOpenChange={setOpen} open={open}>
      <DropdownMenuTrigger
        asChild
        className={cn(
          "w-fit data-[state=open]:bg-surface-base-extraLight",
          className
        )}
      >
        <Button
          className="hidden group focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 md:flex h-9 px-2 border-surface-base-extraLight bg-surface-base-faint text-content-default hover:bg-surface-base-extraLight"
          data-testid="visibility-selector"
          variant="outline"
        >
          {selectedVisibility && (
            <selectedVisibility.icon className="size-4" />
          )}
          <span className="md:sr-only">{selectedVisibility?.label}</span>
          <ChevronDown className="size-4 transition-transform duration-100 group-data-[state=open]:rotate-180" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="min-w-[300px]">
        {visibilities.map((visibility) => (
          <DropdownMenuItem
            className="group/item flex flex-row items-center justify-between gap-4"
            data-active={visibility.id === visibilityType}
            data-testid={`visibility-selector-item-${visibility.id}`}
            key={visibility.id}
            onSelect={() => {
              setVisibilityType(visibility.id);
              setOpen(false);
            }}
          >
            <div className="flex items-start gap-2.5">
              <visibility.icon className="size-4 translate-y-1 text-content-soft" />
                <div className="flex flex-col items-start gap-1">
                <h6 className="text-base font-medium text-content-ultra">{visibility.label}</h6>
                {visibility.description && (
                  <p className="text-content-medium text-sm">
                    {visibility.description}
                  </p>
                )}
              </div>
              <div className="absolute right-2.5 top-2.5 group-data-[active=true]/item:opacity-100 size-4 rounded-full border-3 group-data-[active=true]/item:border-4 border-transparency-dark-mode-24 group-data-[active=true]/item:border-surface-base-brand-default">
              </div>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
