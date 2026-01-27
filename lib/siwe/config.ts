import {
  createSIWEConfig,
  formatMessage,
  type SIWECreateMessageArgs,
  type SIWESession,
  type SIWEVerifyMessageArgs,
} from "@reown/appkit-siwe";
import { getCsrfToken, getSession, signIn, signOut } from "next-auth/react";
import config from "@/config";

export const siweConfig = createSIWEConfig({
  getMessageParams: async () => ({
    domain: typeof window !== "undefined" ? window.location.host : "",
    uri: typeof window !== "undefined" ? window.location.origin : "",
    chains: config.chains.map((chain) => chain.id),
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
    console.log("session in siwe config", session);
    if (!session?.user?.id) {
      return null;
    }

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
