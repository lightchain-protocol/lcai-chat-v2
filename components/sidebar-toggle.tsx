import { PanelRight } from "lucide-react";
import type { ComponentProps } from "react";
import { type SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

export function SidebarToggle({
  className,
}: ComponentProps<typeof SidebarTrigger>) {
  const { toggleSidebar } = useSidebar();

  return (
    <Button
      className={cn(
        "h-9 w-9 border-surface-base-extraLight bg-surface-base-faint p-1 text-content-default hover:bg-surface-base-extraLight",
        className
      )}
      data-testid="sidebar-toggle-button"
      onClick={toggleSidebar}
      variant="outline"
    >
      <PanelRight className="size-4.5!" />
    </Button>
  );
}
