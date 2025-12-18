"use client";

import {
  CloudDownloadIcon,
  Loader,
  MessageSquarePlus,
  Trash,
  UploadIcon,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { User } from "next-auth";
import { useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { ChatSearch } from "@/components/chat-search";
import { MoreHorizontalIcon } from "@/components/icons";
import { ImportChatDialog } from "@/components/import-chat-dialog";
import { RestoreFromIPFSDialog } from "@/components/restore-from-ipfs-dialog";
import {
  getChatHistoryPaginationKey,
  SidebarHistory,
} from "@/components/sidebar-history";
import { SidebarUserNav } from "@/components/sidebar-user-nav";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  useSidebar,
} from "@/components/ui/sidebar";
import useSubscription from "@/hooks/use-subscription";
import { formatDate } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import AlertError from "./ui/toast/AlertError";
import AlertInfo from "./ui/toast/AlertInfo";

export function AppSidebar({ user }: { user: User | undefined }) {
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const { mutate } = useSWRConfig();
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const { hasActiveSubscription, activeSubscription } = useSubscription();

  const handleDeleteAll = () => {
    const deletePromise = fetch("/api/history", {
      method: "DELETE",
    });

    toast.promise(deletePromise, {
      loading: (
        <AlertInfo
          icon={<Loader className="size-5 animate-spin text-white" />}
          title="Deleting all chats..."
        />
      ),

      success: () => {
        mutate(unstable_serialize(getChatHistoryPaginationKey));
        router.push("/");
        setShowDeleteAllDialog(false);
        return <AlertInfo title="All chats deleted successfully" />;
      },

      error: <AlertError title="Failed to delete all chats" />,

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
      <Sidebar className="group-data-[side=left]:border-r-0">
        <SidebarHeader>
          <SidebarMenu>
            <div className="relative flex items-center justify-between gap-3 border-bdr-light border-b p-4">
              <div className="flex items-center gap-2.5">
                <Image
                  alt="LCAI Logon Icon"
                  className="size-9"
                  height={36}
                  priority={true}
                  src={"/images/logo/logo-only.svg"}
                  width={36}
                />
                <div className="flex flex-col gap-0.5">
                  <span className="whitespace-nowrap font-semibold text-content-primary text-sm">
                    Lightchain AI
                  </span>
                  <span className="-tracking-[0.12px] whitespace-nowrap text-content-default text-xs">
                    Decentralized AI Chat
                  </span>
                </div>
              </div>

              <div className="flex flex-row gap-1">
                <Button
                  className={`h-8.5 w-8.5 ${
                    user ? "text-content-default" : "text-content-extraLight"
                  }`}
                  disabled={!user}
                  onClick={() => {
                    setOpenMobile(false);
                    router.push("/");
                    router.refresh();
                  }}
                  type="button"
                  variant="ghost"
                >
                  <MessageSquarePlus size={20} />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      className={`h-8.5 w-8.5 text-content-default hover:bg-surface-base-faint hover:text-content-default data-[state=open]:bg-surface-base-faint ${
                        user
                          ? "text-content-default"
                          : "text-content-extraLight"
                      }`}
                      disabled={!user}
                      type="button"
                      variant="ghost"
                    >
                      <MoreHorizontalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="space-y-1"
                    sideOffset={10}
                  >
                    <DropdownMenuItem
                      className="flex items-center gap-2 text-content-ultra"
                      onSelect={() => setShowImportDialog(true)}
                    >
                      <UploadIcon className="size-4 text-content-soft" />
                      Import from JSON
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="flex items-center gap-2 text-content-ultra"
                      onSelect={() => setShowRestoreDialog(true)}
                    >
                      <CloudDownloadIcon className="size-4 text-content-soft" />
                      Restore from IPFS
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="flex items-center gap-2 text-content-error-light focus:text-content-error-light"
                      onSelect={() => setShowDeleteAllDialog(true)}
                    >
                      <Trash className="size-4 text-content-error-light" />
                      Delete All Chats
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <ChatSearch />
          <SidebarHistory user={user} />
        </SidebarContent>

        {user && (
          <div className="flex flex-col gap-2 border-bdr-light border-t px-4 py-4">
            {user &&
              !hasActiveSubscription.isLoading &&
              hasActiveSubscription.data && (
                <button
                  className="group relative flex w-full items-center justify-between rounded-xl border px-2 py-2 transition-colors"
                  type="button"
                >
                  <div className="absolute top-0 left-0 h-full w-full rounded-xl bg-[linear-gradient(90deg,rgba(112,100,233,0.15)_0%,rgba(22,22,26,0)_17.36%)]" />
                  <div className="flex items-center gap-3">
                    <div className="h-4 w-0.5 rounded-full bg-primary" />
                    <div className="flex items-center divide-x">
                      <h6 className="pr-2 font-semibold text-content-strong text-sm">
                        Tier {activeSubscription.data?.tier || "Pro"}
                      </h6>
                      <div className="pl-2 text-left">
                        <span className="mb-1 block text-content-strong text-xs">
                          Subscription expires
                        </span>
                        <span className="block font-semibold text-content-default text-xs">
                          {formatDate(activeSubscription.data?.expiryTimestamp)}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              )}
            {user && <SidebarUserNav user={user} />}
          </div>
        )}
      </Sidebar>

      <AlertDialog
        onOpenChange={setShowDeleteAllDialog}
        open={showDeleteAllDialog}
      >
        <AlertDialogContent className="sm:rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all chats?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete all
              your chats and remove them from our servers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-surface-base-error-default hover:bg-surface-base-error-default/90"
              onClick={handleDeleteAll}
            >
              Delete All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ImportChatDialog
        onOpenChange={setShowImportDialog}
        open={showImportDialog}
      />

      <RestoreFromIPFSDialog
        onOpenChange={setShowRestoreDialog}
        open={showRestoreDialog}
      />
    </>
  );
}
