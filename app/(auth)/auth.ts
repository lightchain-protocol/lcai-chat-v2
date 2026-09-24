import NextAuth, { type DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import { refreshConsumerToken } from "@/lib/siwe/refresh";
import { authConfig } from "./auth.config";

// Server-side fetch from inside the Next.js container: prefer the internal
// compose-DNS URL. The public URL (localhost:8090) does not route to
// consumer-api from within the frontend container.
const consumerApiBaseUrl =
  process.env.CONSUMER_API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_CONSUMER_API_URL;

export type UserType = {
  id: string;
  username?: string | null;
  walletAddress: `0x${string}`;
  type: "regular";
  token: string;
};

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: UserType & DefaultSession["user"];
  }

  interface User extends UserType {}
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT, UserType {}
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      id: "siwe",
      name: "Ethereum",
      credentials: {
        message: {
          label: "Message",
          type: "text",
          placeholder: "0x0",
        },
        signature: {
          label: "Signature",
          type: "text",
          placeholder: "0x0",
        },
      },
      async authorize(credentials) {
        try {
          if (!credentials?.message || !credentials?.signature) {
            console.error("Missing message or signature");
            return null;
          }

          if (!consumerApiBaseUrl) {
            console.error("Consumer API URL is not configured");
            return null;
          }

          const response = await fetch(
            `${consumerApiBaseUrl}/api/auth/verify`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                message: credentials.message,
                signature: credentials.signature,
              }),
            }
          );

          if (!response.ok) {
            throw new Error("Consumer auth verify failed");
          }

          const payload = (await response.json()) as {
            success: boolean;
            address?: string;
            token?: string;
            user?: UserType;
          };

          if (!payload.success || !payload.user || !payload.token) {
            throw new Error("Failed to verify message!");
          }

          return {
            id: payload.user.id,
            username: payload.user.username ?? null,
            walletAddress: payload.user.walletAddress,
            type: payload.user.type,
            token: payload.token,
          };
        } catch (error) {
          console.error("SIWE authorization error:", error);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id as string;
        token.walletAddress = user.walletAddress as `0x${string}`;
        token.username = user.username as string;
        token.token = user.token as string;
        token.type = user.type;
        return token;
      }

      // This session outlives the consumer-api token inside it by weeks. The
      // client asks for an update whenever that token is due (see
      // SIWESessionSync), and that is the one path that writes the renewed
      // token back into the cookie, so no other read of the session tries:
      // auth() inside a server component cannot set cookies and would only
      // spend a request per render. A refusal leaves the old token in place;
      // the chat asks for a signature once it stops working.
      if (
        trigger === "update" &&
        typeof token.token === "string" &&
        consumerApiBaseUrl
      ) {
        const fresh = await refreshConsumerToken(
          token.token,
          consumerApiBaseUrl
        );
        if (fresh) {
          token.token = fresh;
        }
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.walletAddress = token.walletAddress;
        session.user.username = token.username || token.walletAddress;
        session.user.type = token.type;
        session.user.token = token.token;
      }

      return session;
    },
  },
});
