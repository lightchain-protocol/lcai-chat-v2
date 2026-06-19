"use client";

import { useDisconnect } from "@reown/appkit/react";
import { ChevronsUpDown, LogOut, Zap } from "lucide-react";
import Image from "next/image";
import type { User } from "next-auth";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton } from "@/components/ui/sidebar";
import { EnableDelegationDialog } from "./enable-delegation-dialog";
import { LoaderIcon } from "./icons";
import AlertError from "./ui/toast/AlertError";
import AlertSuccess from "./ui/toast/AlertSuccess";

export function SidebarUserNav({ user }: { user: User }) {
  const { status } = useSession();
  const { disconnect } = useDisconnect();
  const [delegationOpen, setDelegationOpen] = useState(false);
  const isWalletUser = Boolean(user.walletAddress);

  const displayIdentity = user.walletAddress ?? user.username ?? "Guest";
  const formattedIdentity =
    displayIdentity.length > 12
      ? `${displayIdentity.slice(0, 6)}...${displayIdentity.slice(-4)}`
      : displayIdentity;

  const handleSignOut = async () => {
    try {
      // Disconnecting the wallet triggers AppKit's signOutOnDisconnect,
      // which calls our SIWE signOut callback (clears NextAuth session).
      // The SIWESessionSync component handles the soft refresh via DOM event.
      await disconnect();

      toast.custom((id) => (
        <AlertSuccess id={id} title="Successfully signed out!" />
      ));
    } catch (_error) {
      toast.custom((id) => (
        <AlertError id={id} title="Failed to sign out. Please try again." />
      ));
    }
  };

  return (
    <SidebarMenu>
      <div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {status === "loading" ? (
              <SidebarMenuButton className="h-10 justify-between data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
                <div className="flex flex-row gap-2">
                  <div className="size-6 animate-pulse rounded-full bg-zinc-500/30" />
                  <span className="animate-pulse rounded-md bg-zinc-500/30 text-transparent">
                    Loading auth status
                  </span>
                </div>
                <div className="animate-spin text-zinc-500">
                  <LoaderIcon />
                </div>
              </SidebarMenuButton>
            ) : (
              <SidebarMenuButton
                className="h-10 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                data-testid="user-nav-button"
              >
                <Image
                  alt={formattedIdentity ?? "User Avatar"}
                  className="rounded-full"
                  height={24}
                  src={`https://avatar.vercel.sh/${displayIdentity}`}
                  width={24}
                />
                <span className="truncate" data-testid="user-username">
                  {formattedIdentity}
                </span>
                <ChevronsUpDown className="ml-auto" />
              </SidebarMenuButton>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-popper-anchor-width)"
            data-testid="user-nav-menu"
            side="top"
          >
            {isWalletUser && (
              <DropdownMenuItem asChild data-testid="user-nav-item-delegation">
                <button
                  className="w-full cursor-pointer font-medium"
                  onClick={() => setDelegationOpen(true)}
                  type="button"
                >
                  <Zap size={18} />
                  Gasless mode
                </button>
              </DropdownMenuItem>
            )}
            {/* <DropdownMenuSeparator /> */}
            <DropdownMenuItem asChild data-testid="user-nav-item-auth">
              <button
                className="w-full cursor-pointer font-medium"
                onClick={handleSignOut}
                type="button"
              >
                <LogOut size={18} />
                Disconnect & Sign out
              </button>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {isWalletUser && delegationOpen && (
        <EnableDelegationDialog
          onOpenChange={setDelegationOpen}
          open={delegationOpen}
        />
      )}
    </SidebarMenu>
  );
}
