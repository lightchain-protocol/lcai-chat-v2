import {
  createSIWEConfig,
  formatMessage,
  type SIWECreateMessageArgs,
  type SIWESession,
  type SIWEVerifyMessageArgs,
} from "@reown/appkit-siwe";
import { getCsrfToken, getSession, signIn, signOut } from "next-auth/react";
import { lcaiTestnet } from "../wagmi";

export const siweConfig = createSIWEConfig({
  getMessageParams: async () => ({
    domain: typeof window !== "undefined" ? window.location.host : "",
    uri: typeof window !== "undefined" ? window.location.origin : "",
    chains: [lcaiTestnet.id],
    statement: "Sign in with Lightchain AI to LCAI Chat",
  }),

  createMessage: ({ address, ...args }: SIWECreateMessageArgs) =>
    formatMessage(args, address),

  getNonce: async () => {
    const nonce = await getCsrfToken();
    if (!nonce) {
      throw new Error("Failed to get nonce!");
    }

    return nonce;
  },

  getSession: async () => {
    const session = await getSession();
    if (!session?.user?.email) {
      return null;
    }

    return {
      address: session.user.email as `0x${string}`,
      chainId: lcaiTestnet.id,
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
        // Refresh the page after successful sign-in
        window.location.reload();
        return true;
      }

      return false;
    } catch (_error) {
      return false;
    }
  },
  signOut: async () => {
    try {
      // Sign out from NextAuth
      await signOut({
        redirect: false,
      });

      // Refresh the page to show the greeting/connect button again
      window.location.reload();

      return true;
    } catch (_error) {
      return false;
    }
  },
});
