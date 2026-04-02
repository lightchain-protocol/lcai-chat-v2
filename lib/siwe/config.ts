import {
  createSIWEConfig,
  formatMessage,
  type SIWECreateMessageArgs,
  type SIWESession,
  type SIWEVerifyMessageArgs,
} from "@reown/appkit-siwe";
import { getSession, signIn, signOut } from "next-auth/react";
import config from "@/config";
import { resolveApiUrl } from "../utils";

/**
 * Custom DOM event dispatched after SIWE sign-in or sign-out completes.
 * The SIWESessionSync component listens for this to trigger a soft refresh.
 */
function dispatchSessionChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("siwe-session-changed"));
  }
}

export const siweConfig = createSIWEConfig({
  getMessageParams: async () => ({
    domain: typeof window !== "undefined" ? window.location.host : "",
    uri: typeof window !== "undefined" ? window.location.origin : "",
    chains: config.chains.map((chain) => chain.id),
    statement: "Sign in with Lightchain AI to LCAI Chat",
  }),

  createMessage: ({ address, ...args }: SIWECreateMessageArgs) =>
    formatMessage(args, address),

  getNonce: async (address) => {
    const response = await fetch(
      `${resolveApiUrl("/api/auth/challenge")}?address=${address}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "include",
      }
    );

    if (!response.ok) {
      throw new Error("Failed to get challenge!");
    }
    const data = await response.json();

    if (!data.nonce) {
      throw new Error("Failed to get nonce!");
    }

    return data.nonce;
  },

  getSession: async () => {
    const session = await getSession();
    if (!session?.user?.id) {
      return null;
    }

    localStorage.setItem("user-token", session.user.token);

    return {
      address: session.user.walletAddress,
      chainId: config.chains[0].id,
    } as SIWESession;
  },

  verifyMessage: async ({ message, signature }: SIWEVerifyMessageArgs) => {
    try {
      const success = await signIn("siwe", {
        message,
        redirect: false,
        signature,
        callbackUrl: "/",
      });

      if (success?.ok) {
        dispatchSessionChanged();
        return true;
      }

      return false;
    } catch (_error) {
      return false;
    }
  },
  signOut: async () => {
    try {
      await signOut({ redirect: false });
      dispatchSessionChanged();
      return true;
    } catch (_error) {
      return false;
    }
  },
});
