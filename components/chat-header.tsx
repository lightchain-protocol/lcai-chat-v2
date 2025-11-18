"use client";

import { DownloadIcon, MoonIcon, SunIcon } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { memo } from "react";
import { toast } from "sonner";
import { useIsClient, useWindowSize } from "usehooks-ts";
import { SidebarToggle } from "@/components/sidebar-toggle";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "./icons";
import { useSidebar } from "./ui/sidebar";
import { VisibilitySelector, type VisibilityType } from "./visibility-selector";

const FILENAME_REGEX = /filename="(.+)"/;

function PureChatHeader({
  chatId,
  selectedVisibilityType,
  isReadonly,
}: {
  chatId: string;
  selectedVisibilityType: VisibilityType;
  isReadonly: boolean;
}) {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { open } = useSidebar();

  const { width: windowWidth } = useWindowSize();

  const { setTheme, resolvedTheme } = useTheme();
  const isClient = useIsClient();

  const toggleTheme = (event: React.MouseEvent<HTMLButtonElement>) => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const currentTheme = resolvedTheme || "light";
    const newMode = currentTheme === "light" ? "dark" : "light";

    if (!document.startViewTransition || prefersReducedMotion) {
      setTheme(newMode);
      return;
    }

    const { clientX: x, clientY: y } = event;
    const root = document.documentElement;

    root.style.setProperty("--x", `${x}px`);
    root.style.setProperty("--y", `${y}px`);

    document.startViewTransition(() => {
      setTheme(newMode);
    });
  };

  const handleExportChat = async () => {
    try {
      const response = await fetch(`/api/chat/${chatId}/export`);

      if (!response.ok) {
        throw new Error("Failed to export chat");
      }

      // Get the filename from Content-Disposition header
      const contentDisposition = response.headers.get("Content-Disposition");
      const filenameMatch = contentDisposition?.match(FILENAME_REGEX);
      const filename = filenameMatch?.[1] || `chat-${chatId}.json`;

      // Download the file
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("Chat exported successfully!");
    } catch (error) {
      console.error("Export error:", error);
      toast.error("Failed to export chat");
    }
  };

  return (
    <header className="sticky top-0 flex items-center gap-2 bg-background px-2 py-1.5 md:px-2">
      <SidebarToggle />

      {(!open || windowWidth < 768) && (
        <Button
          className="order-2 ml-auto h-8 px-2 md:order-1 md:ml-0 md:h-fit md:px-2"
          onClick={() => {
            router.push("/");
            router.refresh();
          }}
          variant="outline"
        >
          <PlusIcon />
          <span className="md:sr-only">New Chat</span>
        </Button>
      )}

      {!isReadonly && (
        <VisibilitySelector
          chatId={chatId}
          className="order-1 md:order-2"
          selectedVisibilityType={selectedVisibilityType}
        />
      )}

      {params.id && (
        <Button
          className="order-3 h-8 px-2 md:h-fit md:px-2"
          onClick={handleExportChat}
          title="Export chat"
          type="button"
          variant="outline"
        >
          <span className="hidden md:inline">Export Chat</span>
          <DownloadIcon />
        </Button>
      )}
      <Button
        className="order-4 h-8 px-2 md:ml-auto md:h-fit md:px-2"
        onClick={toggleTheme}
        type="button"
        variant="outline"
      >
        <span className="sr-only">
          {isClient
            ? `Toggle ${resolvedTheme === "dark" ? "light" : "dark"} mode`
            : "Toggle theme"}
        </span>
        {isClient && resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />}
      </Button>
    </header>
  );
}

export const ChatHeader = memo(PureChatHeader, (prevProps, nextProps) => {
  return (
    prevProps.chatId === nextProps.chatId &&
    prevProps.selectedVisibilityType === nextProps.selectedVisibilityType &&
    prevProps.isReadonly === nextProps.isReadonly
  );
});
