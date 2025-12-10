import type { ComponentProps } from "react";
import { type SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { SidebarLeftIcon } from "./icons";
import { Button } from "./ui/button";

export function SidebarToggle({
  className,
}: ComponentProps<typeof SidebarTrigger>) {
  const { toggleSidebar } = useSidebar();

  return (
    <Button
      className={cn("h-8 px-2 md:h-fit md:px-2 bg-surface-base-faint text-content-default", className)}
      data-testid="sidebar-toggle-button"
      onClick={toggleSidebar}
      variant="outline"
    >
      <SidebarLeftIcon size={16} />
    </Button>
  );
}
