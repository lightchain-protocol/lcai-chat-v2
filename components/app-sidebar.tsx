"use client";

import { CloudDownloadIcon, UploadIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "next-auth";
import { useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { MoreHorizontalIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { ImportChatDialog } from "@/components/import-chat-dialog";
import { RestoreFromIPFSDialog } from "@/components/restore-from-ipfs-dialog";
import {
  getChatHistoryPaginationKey,
  SidebarHistory,
} from "@/components/sidebar-history";
import { SidebarUserNav } from "@/components/sidebar-user-nav";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

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
      loading: "Deleting all chats...",
      success: () => {
        mutate(unstable_serialize(getChatHistoryPaginationKey));
        router.push("/");
        setShowDeleteAllDialog(false);
        return "All chats deleted successfully";
      },
      error: "Failed to delete all chats",
    });
  };

  return (
    <>
      <Sidebar className="group-data-[side=left]:border-r-0">
        <SidebarHeader>
          <SidebarMenu>
            <div className="flex flex-row items-center justify-between">
              <Link
                className="flex flex-row items-center gap-3"
                href="/"
                onClick={() => {
                  setOpenMobile(false);
                }}
              >
                <Image
                  alt="LCAI Logo"
                  className="hidden max-w-[150px] dark:block"
                  height={150}
                  priority={true}
                  src={"/images/logo/logo.svg"}
                  unoptimized={false}
                  width={150}
                />
                <Image
                  alt="LCAI Logo Dark"
                  className="max-w-[150px] dark:hidden"
                  height={150}
                  priority={true}
                  src={"/images/logo/logo-dark.svg"}
                  unoptimized={false}
                  width={150}
                />
              </Link>
              <div className="flex flex-row gap-1">
                {user && (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          className="h-8 p-1 md:h-fit md:p-2"
                          onClick={() => {
                            setOpenMobile(false);
                            router.push("/");
                            router.refresh();
                          }}
                          type="button"
                          variant="ghost"
                        >
                          <PlusIcon />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent align="end" className="hidden md:block">
                        New Chat
                      </TooltipContent>
                    </Tooltip>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          className="h-8 p-1 md:h-fit md:p-2"
                          type="button"
                          variant="ghost"
                        >
                          <MoreHorizontalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          className="flex items-center gap-2"
                          onSelect={() => setShowImportDialog(true)}
                        >
                          <UploadIcon className="size-4" />
                          Import from JSON
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="flex items-center gap-2"
                          onSelect={() => setShowRestoreDialog(true)}
                        >
                          <CloudDownloadIcon className="size-4" />
                          Restore from IPFS
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="flex items-center gap-2 text-red-600 focus:text-red-700"
                          onSelect={() => setShowDeleteAllDialog(true)}
                        >
                          <TrashIcon />
                          Delete All Chats
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
              </div>
            </div>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarHistory user={user} />
        </SidebarContent>
        <SidebarFooter>
          {user &&
            !hasActiveSubscription.isLoading &&
            hasActiveSubscription.data && (
              <button
                className="group relative flex w-full items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/50 px-2 py-2 transition-colors hover:bg-zinc-900/50"
                type="button"
              >
                <div className="absolute top-0 left-0 h-full w-full rounded-xl bg-[linear-gradient(90deg,rgba(112,100,233,0.15)_0%,rgba(22,22,26,0)_17.36%)]" />
                <div className="flex items-center gap-3">
                  <div className="h-4 w-0.5 rounded-full bg-primary" />
                  <div className="flex items-center divide-x">
                    <div className="pr-2 font-semibold text-sm text-white">
                      Tier {activeSubscription.data?.tier || "Pro"}
                    </div>
                    <div className="pl-2 text-left">
                      <div className="text-xs text-zinc-400">
                        Subscription expires
                      </div>
                      <div className="font-medium text-sm text-zinc-300">
                        {formatDate(activeSubscription.data?.expiryTimestamp)}
                      </div>
                    </div>
                  </div>
                </div>
                {/* <ChevronRightIcon className="size-5 text-zinc-400 transition-transform group-hover:translate-x-0.5" /> */}
              </button>
            )}
          {user && <SidebarUserNav user={user} />}
        </SidebarFooter>
      </Sidebar>

      <AlertDialog
        onOpenChange={setShowDeleteAllDialog}
        open={showDeleteAllDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all chats?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete all
              your chats and remove them from our servers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAll}>
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
