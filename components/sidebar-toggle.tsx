import type { ComponentProps } from "react";
import { type SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { SidebarLeftIcon } from "./icons";
import { Button } from "./ui/button";
import { PanelRight } from "lucide-react";

export function SidebarToggle({
  className,
}: ComponentProps<typeof SidebarTrigger>) {
  const { toggleSidebar } = useSidebar();

  return (
    <Button
      className={cn("w-9 h-9 p-1 border-surface-base-extraLight bg-surface-base-faint text-content-default hover:bg-surface-base-extraLight", className)}
      data-testid="sidebar-toggle-button"
      onClick={toggleSidebar}
      variant="outline"
    >
      <PanelRight className="size-4.5!" />
    </Button>
  );
}
