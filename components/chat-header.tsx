"use client";

import {
  CloudUploadIcon,
  Download,
  DownloadIcon,
  Loader,
  Settings2,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { memo, useState } from "react";
import { toast } from "sonner";
import useSWR, { mutate as globalMutate } from "swr";
import { useWindowSize } from "usehooks-ts";
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
import AlertSuccess from "./ui/toast/AlertSuccess";
import AlertError from "./ui/toast/AlertError";
import AlertInfo from "./ui/toast/AlertInfo";

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

      toast.custom(() => (
        <AlertSuccess title='Chat exported successfully!' />
        ));
    } catch (error) {
      console.error("Export error:", error);
      toast.custom(() => (
        <AlertError title='Failed to export chat' />
        ));
    }
  };

  const handleBackup = () => {
    try {
      const responsePromise = fetch(`/api/chat/${chatId}/backup`, {
        method: "POST",
      });

      toast.promise(responsePromise, {
         loading: (
              <AlertInfo
                title="Backing up chat..."
                icon={<Loader className="size-5 animate-spin text-white" />}
              />
            ),

            success: async (response) => {
          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.message || "Failed to backup chat");
          }

          // Revalidate backup status in header
          mutateBackupStatus();

          // Refresh the first page of sidebar history to show backup icon
          await globalMutate("/api/history?limit=20");

          return <AlertInfo
                title={`Chat backed up! CID: ${data.cid.slice(0, 12)}...`}
              /> ;
        },
        error: (
          <AlertError
            title="Failed to backup chat"
          />
        ),
    
        style: {
          background: "transparent",
          padding: 0,
          border: "none",
          boxShadow: "none",
        },
      });
    } catch (error) {
      toast.custom(() => (
        <AlertError title={error instanceof Error ? error?.message : "Failed to backup chat"} />
        ));
    }
  };

  return (
    <header className="sticky top-0 flex items-center gap-2 bg-background px-2 py-3 md:py-4.5 md:px-2">
      <SidebarToggle />

      {(!open || windowWidth < 768) && (
        <Button
          className="order-2 ml-auto h-8 px-2 md:order-1 md:ml-0 md:h-fit md:px-2 bg-surface-base-faint text-content-default"
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
              className="order-3 h-9 px-2 border-surface-base-extraLight bg-surface-base-faint text-content-default hover:bg-surface-base-extraLight data-[state=open]:bg-surface-base-extraLight"
              title="Export, backup, and import options"
              type="button"
              variant="outline"
            >
              <span className="hidden md:inline text-sm leading-0">Export & Backup</span>
              <Download className="size-4.5!" />
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
          className="order-4 h-9 px-2 md:h-fit md:px-2 border-surface-base-extraLight bg-surface-base-faint text-content-default hover:bg-surface-base-extraLight"
          onClick={() => setPromptDialogOpen(true)}
          title="System prompt settings"
          type="button"
          variant="outline"
        >
          <span className="hidden md:inline text-sm leading-0">System Prompt</span>
          <Settings2 className="size-4.5!" />
        </Button>
      )}

      <Dialog onOpenChange={setPromptDialogOpen} open={promptDialogOpen}>
        <DialogContent className="sm:rounded-3xl">
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
            <p className="text-sm mt-3 text-content-default">Pick a preset to customize the assistant’s behavior.</p>
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
