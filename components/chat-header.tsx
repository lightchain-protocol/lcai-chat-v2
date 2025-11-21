"use client";

import {
  CloudUploadIcon,
  DownloadIcon,
  MoonIcon,
  Settings2,
  SunIcon,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { memo, useState } from "react";
import { toast } from "sonner";
import useSWR, { mutate as globalMutate } from "swr";
import { useIsClient, useWindowSize } from "usehooks-ts";
import { SidebarToggle } from "@/components/sidebar-toggle";
import { SystemPromptEditor } from "@/components/system-prompt-editor";
import { SystemPromptSelector } from "@/components/system-prompt-selector";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PlusIcon } from "./icons";
import { useSidebar } from "./ui/sidebar";
import { VisibilitySelector, type VisibilityType } from "./visibility-selector";

const FILENAME_REGEX = /filename="(.+)"/;

function PureChatHeader({
  chatId,
  selectedVisibilityType,
  isReadonly,
  systemPromptId,
  onSystemPromptChange,
}: {
  chatId: string;
  selectedVisibilityType: VisibilityType;
  isReadonly: boolean;
  systemPromptId?: string;
  onSystemPromptChange?: (promptId: string, prompt: string) => void;
}) {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { open } = useSidebar();

  const { width: windowWidth } = useWindowSize();

  const { setTheme, resolvedTheme } = useTheme();
  const isClient = useIsClient();

  const [promptDialogOpen, setPromptDialogOpen] = useState(false);
  const [editorDialogOpen, setEditorDialogOpen] = useState(false);

  // Fetch backup status using SWR
  const { data: backupStatus, mutate: mutateBackupStatus } = useSWR<{
    backedUp: boolean;
    cid: string | null;
    encrypted: boolean;
  }>(chatId ? `/api/chat/${chatId}/backup` : null, async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) return null;
    return response.json();
  });

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

  const handleBackup = () => {
    try {
      const responsePromise = fetch(`/api/chat/${chatId}/backup`, {
        method: "POST",
      });

      toast.promise(responsePromise, {
        loading: "Backing up chat...",
        success: async (response) => {
          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.message || "Failed to backup chat");
          }

          // Revalidate backup status in header
          mutateBackupStatus();

          // Refresh the first page of sidebar history to show backup icon
          await globalMutate("/api/history?limit=20");

          return `Chat backed up! CID: ${data.cid.slice(0, 12)}...`;
        },
        error: "Failed to backup chat",
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to backup chat"
      );
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="order-3 h-8 px-2 md:h-fit md:px-2"
              title="Export, backup, and import options"
              type="button"
              variant="outline"
            >
              <span className="hidden md:inline">Export & Backup</span>
              <DownloadIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleExportChat}>
              <DownloadIcon className="mr-2 size-4" />
              Export as JSON
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleBackup}>
              <CloudUploadIcon className="mr-2 size-4" />
              Backup to IPFS
              {backupStatus?.backedUp && (
                <span className="ml-auto text-muted-foreground text-xs">✓</span>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {!isReadonly && onSystemPromptChange && (
        <Button
          className="order-4 h-8 px-2 md:h-fit md:px-2"
          onClick={() => setPromptDialogOpen(true)}
          title="System prompt settings"
          type="button"
          variant="outline"
        >
          <span className="hidden md:inline">System Prompt</span>
          <Settings2 />
        </Button>
      )}

      <Button
        className="order-5 h-8 px-2 md:ml-auto md:h-fit md:px-2"
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

      <Dialog onOpenChange={setPromptDialogOpen} open={promptDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>System Prompt Settings</DialogTitle>
            <DialogDescription>
              Choose a personality or create a custom prompt for the AI.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <SystemPromptSelector
              onChange={(promptId, prompt) => {
                onSystemPromptChange?.(promptId, prompt);
                setPromptDialogOpen(false);
                toast.success("System prompt updated");
              }}
              onCreateNew={() => {
                setPromptDialogOpen(false);
                setEditorDialogOpen(true);
              }}
              value={systemPromptId}
            />
          </div>
        </DialogContent>
      </Dialog>

      <SystemPromptEditor
        onOpenChange={setEditorDialogOpen}
        onSave={() => {
          // Refresh will happen in the selector component
        }}
        open={editorDialogOpen}
      />
    </header>
  );
}

export const ChatHeader = memo(PureChatHeader, (prevProps, nextProps) => {
  return (
    prevProps.chatId === nextProps.chatId &&
    prevProps.selectedVisibilityType === nextProps.selectedVisibilityType &&
    prevProps.isReadonly === nextProps.isReadonly &&
    prevProps.systemPromptId === nextProps.systemPromptId
  );
});
