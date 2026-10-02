"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { setAuthToken } from "@/lib/http";
import { isRefreshDue } from "@/lib/siwe/refresh";

/** How often a visible tab checks whether its token is due for renewal. */
const RENEW_CHECK_MS = 5 * 60 * 1000;

/**
 * Renderless bridge component that listens for the "siwe-session-changed"
 * DOM event (dispatched by siweConfig after sign-in/sign-out) and triggers
 * a soft refresh — updating the NextAuth session and re-rendering Server
 * Components without a full page reload.
 *
 * It also keeps the consumer-api token alive. Whenever the session's token
 * is due for renewal (see lib/siwe/refresh.ts) it asks for a session update,
 * which is where the jwt callback exchanges it, and copies whatever token the
 * session then holds into localStorage, where requests read it.
 */
export function SIWESessionSync() {
  const { data, update } = useSession();
  const router = useRouter();
  const token = data?.user?.token;
  const lastRenewTryAt = useRef(0);

  useEffect(() => {
    if (token) {
      setAuthToken(token);
    }
  }, [token]);

  // Checked at load, on a timer and on wake, only while the tab is visible,
  // and at most once per interval: a refused renewal leaves the token as it
  // was, which re-runs this effect, so without the cap it would loop.
  useEffect(() => {
    if (!token) {
      return;
    }
    const renewIfDue = () => {
      if (document.visibilityState !== "visible" || !isRefreshDue(token)) {
        return;
      }
      if (Date.now() - lastRenewTryAt.current < RENEW_CHECK_MS) {
        return;
      }
      lastRenewTryAt.current = Date.now();
      update();
    };
    renewIfDue();
    const timer = setInterval(renewIfDue, RENEW_CHECK_MS);
    document.addEventListener("visibilitychange", renewIfDue);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", renewIfDue);
    };
  }, [token, update]);

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
