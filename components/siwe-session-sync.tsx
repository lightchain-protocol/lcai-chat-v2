"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Renderless bridge component that listens for the "siwe-session-changed"
 * DOM event (dispatched by siweConfig after sign-in/sign-out) and triggers
 * a soft refresh — updating the NextAuth session and re-rendering Server
 * Components without a full page reload.
 */
export function SIWESessionSync() {
  const { update } = useSession();
  const router = useRouter();

  useEffect(() => {
    const handler = async () => {
      await update();
      router.refresh();
    };

    window.addEventListener("siwe-session-changed", handler);
    return () => window.removeEventListener("siwe-session-changed", handler);
  }, [update, router]);

  return null;
}
