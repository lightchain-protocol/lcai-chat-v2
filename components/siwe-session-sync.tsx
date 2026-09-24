"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { setAuthToken } from "@/lib/http";

/**
 * Renderless bridge component that listens for the "siwe-session-changed"
 * DOM event (dispatched by siweConfig after sign-in/sign-out) and triggers
 * a soft refresh — updating the NextAuth session and re-rendering Server
 * Components without a full page reload.
 *
 * It also copies the consumer-api token out of the session whenever it
 * changes: the session route renews that token as it nears its hour (see the
 * jwt callback in auth.ts), and requests read it from localStorage, not from
 * the session.
 */
export function SIWESessionSync() {
  const { data, update } = useSession();
  const router = useRouter();
  const token = data?.user?.token;

  useEffect(() => {
    if (token) {
      setAuthToken(token);
    }
  }, [token]);

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
