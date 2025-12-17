"use client";

import { ChevronsUpDown, LogOut } from "lucide-react";
import Image from "next/image";
import type { User } from "next-auth";
import { signOut, useSession } from "next-auth/react";
import { useDisconnect } from "wagmi";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { LoaderIcon } from "./icons";
import { toast } from 'sonner'
import AlertError from "./ui/toast/AlertError";
import AlertSuccess from "./ui/toast/AlertSuccess";

export function SidebarUserNav({ user }: { user: User }) {
  const { status } = useSession();
  const { disconnectAsync } = useDisconnect();

  const formattedUsername = user.username
    ? `${user.username.slice(0, 6)}...${user.username.slice(-4)}`
    : "Guest";

  const handleSignOut = async () => {
    try {
      // Disconnect wallet
      await disconnectAsync();

      // Sign out from NextAuth
      await signOut({
        redirect: false,
      });

      // Show success message

      toast.custom((id) => (
      <AlertSuccess id={id} title='Successfully signed out!' />
      ));

      // Refresh page to show greeting/connect button
      window.location.reload();
    } catch (_error) {
      toast.custom((id) => (
      <AlertError id={id} title='Failed to sign out. Please try again.' />
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
                  alt={formattedUsername ?? "User Avatar"}
                  className="rounded-full"
                  height={24}
                  src={`https://avatar.vercel.sh/${user.username}`}
                  width={24}
                />
                <span className="truncate" data-testid="user-username">
                  {formattedUsername}
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
    </SidebarMenu>
  );
}
