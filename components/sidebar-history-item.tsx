import { format } from "date-fns";
import { CloudIcon, CopyIcon, ExternalLink, Globe, Loader, Lock, Pencil, ShieldCheckIcon, Trash } from "lucide-react";
import Link from "next/link";
import { memo, useState } from "react";
import { toast } from "sonner";
import { useCopyToClipboard } from "usehooks-ts";
import { useChatVisibility } from "@/hooks/use-chat-visibility";
import type { Chat } from "@/lib/db/schema";
import {
  CheckCircleFillIcon,
  MoreHorizontalIcon,
} from "./icons";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "./ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import AlertError from "./ui/toast/AlertError";
import AlertInfo from "./ui/toast/AlertInfo";
import AlertSuccess from "./ui/toast/AlertSuccess";

const PureChatItem = ({
  chat,
  isActive,
  onDelete,
  setOpenMobile,
  onRename,
}: {
  chat: Chat;
  isActive: boolean;
  onDelete: (chatId: string) => void;
  setOpenMobile: (open: boolean) => void;
  onRename?: (chatId: string, newTitle: string) => void;
}) => {
  const [, copyToClipboard] = useCopyToClipboard();
  const { visibilityType, setVisibilityType } = useChatVisibility({
    chatId: chat.id,
    initialVisibilityType: chat.visibility,
  });

  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [newTitle, setNewTitle] = useState(chat.title);
  const [isRenaming, setIsRenaming] = useState(false);

  const handleRename = () => {
    if (!newTitle.trim()) {
      toast.custom(() => (
        <AlertError title='Title cannot be empty' />
      ));
      return;
    }

    setIsRenaming(true);
    const renamePromise = fetch(`/api/chat?id=${chat.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: newTitle.trim() }),
    });

    toast.promise(renamePromise, {
      loading:
      <AlertInfo
        title="Renaming chat..."
        icon={<Loader className="size-5 animate-spin text-white" />}
      />,

      success: () => {
        setShowRenameDialog(false);
        setIsRenaming(false);
        if (onRename) {
          onRename(chat.id, newTitle.trim());
        }
        return <AlertInfo
        title="Chat renamed successfully"
      /> ;
      },
      error: () => {
        setIsRenaming(false);
        return <AlertError
        title="Failed to rename chat"
      />
      },

      style: {
        background: "transparent",
        padding: 0,
        border: "none",
        boxShadow: "none",
      },

    });
  };

  return (
    <>
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={isActive}>
          <Link
            className="flex items-center gap-2"
            href={`/chat/${chat.id}`}
            onClick={() => setOpenMobile(false)}
          >
            <span className="flex-1 truncate capitalize">{chat.title}</span>
            {chat.ipfsCid && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1">
                    <CloudIcon className="size-3.5 text-blue-500" />
                    {chat.backupEncrypted && (
                      <ShieldCheckIcon className="size-3 text-green-500" />
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-sm" side="right">
                  <div className="space-y-2 text-xs">
                    <div className="font-semibold">IPFS Backup</div>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-muted-foreground">
                          CID:
                        </div>
                        <button
                          className="flex select-none items-center gap-2 hover:text-muted-foreground"
                          onClick={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            await copyToClipboard(chat.ipfsCid || "");
                            toast.custom(() => (
                            <AlertSuccess title='CID copied to clipboard!' />
                            ));
                          }}
                          type="button"
                        >
                          <span className="flex-1 font-mono text-xs">
                            {chat.ipfsCid?.slice(0, 6)}...
                          </span>

                          <CopyIcon className="size-3" />
                        </button>
                      </div>
                      <div>
                        <span className="font-medium text-muted-foreground">
                          Date:
                        </span>{" "}
                        {chat.backedUpAt
                          ? format(new Date(chat.backedUpAt), "MMM d, yyyy")
                          : "N/A"}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="font-medium text-muted-foreground">
                          Status:
                        </span>
                        {chat.backupEncrypted ? (
                          <span className="text-green-500">🔒 Encrypted</span>
                        ) : (
                          <span className="text-yellow-500">🌐 Public</span>
                        )}
                      </div>
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            )}
          </Link>
        </SidebarMenuButton>

        <DropdownMenu modal={true}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction
              className="mr-0.5 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              showOnHover={!isActive}
            >
              <MoreHorizontalIcon />
              <span className="sr-only">More</span>
            </SidebarMenuAction>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" side="bottom">
            <DropdownMenuItem
              className="cursor-pointer"
              onSelect={() => {
                setNewTitle(chat.title);
                setShowRenameDialog(true);
              }}
            >
              <Pencil className="text-content-soft" />
              <span>Rename</span>
            </DropdownMenuItem>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="cursor-pointer">
                <ExternalLink className="text-content-soft" />
                <span>Share</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent sideOffset={10}>
                  <DropdownMenuItem
                    className="cursor-pointer flex-row justify-between"
                    onClick={() => {
                      setVisibilityType("private");
                    }}
                  >
                    <div className="flex flex-row items-center gap-2">
                      <Lock className="text-content-soft" size={12} />
                      <span>Private</span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer flex-row justify-between"
                    onClick={() => {
                      setVisibilityType("public");
                    }}
                  >
                    <div className="flex flex-row items-center gap-2">
                      <Globe className="text-content-soft" />
                      <span>Public</span>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>

            <DropdownMenuItem
              className="cursor-pointer text-content-error-light focus:text-content-error-light"
              onSelect={() => onDelete(chat.id)}
            >
              <Trash className="text-content-error-light" />
              <span>Delete</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>

      <Dialog onOpenChange={setShowRenameDialog} open={showRenameDialog}>
        <DialogContent className="sm:rounded-3xl">
          <DialogHeader>
            <DialogTitle>Rename Chat</DialogTitle>
            <DialogDescription>
              Enter a new title for your chat conversation.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isRenaming) {
                handleRename();
              }
            }}
            placeholder="Enter chat title"
            value={newTitle}
          />
          <DialogFooter className="flex gap-2">
            <Button
              disabled={isRenaming}
              onClick={() => setShowRenameDialog(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={isRenaming || !newTitle.trim()}
              onClick={handleRename}
              type="button"
            >
              {isRenaming ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export const ChatItem = memo(PureChatItem, (prevProps, nextProps) => {
  if (prevProps.isActive !== nextProps.isActive) {
    return false;
  }
  if (prevProps.chat.title !== nextProps.chat.title) {
    return false;
  }
  // Check for backup status changes
  if (prevProps.chat.ipfsCid !== nextProps.chat.ipfsCid) {
    return false;
  }
  if (prevProps.chat.backupEncrypted !== nextProps.chat.backupEncrypted) {
    return false;
  }
  if (prevProps.chat.backedUpAt !== nextProps.chat.backedUpAt) {
    return false;
  }
  return true;
});
