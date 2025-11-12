import NextAuth, { type DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import { SiweMessage } from "siwe";
import { createUser, getUserByWallet } from "@/lib/db/queries";
import { authConfig } from "./auth.config";

export type UserType = "regular";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      type: UserType;
    } & DefaultSession["user"];
  }

  // biome-ignore lint/nursery/useConsistentTypeDefinitions: "Required"
  interface User {
    id?: string;
    email?: string | null;
    type: UserType;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    type: UserType;
  }
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
      async authorize(credentials: any) {
        try {
          if (!credentials?.message || !credentials?.signature) {
            console.error("Missing message or signature");
            return null;
          }

          const siweMessage = new SiweMessage(credentials.message);
          const { data: fields } = await siweMessage.verify({
            signature: credentials.signature,
          });

          console.log("SIWE verification result:", fields);

          if (!fields) {
            console.error("SIWE verification failed");
            return null;
          }

          const { address } = fields;

          // Get or create user
          const [existingUser] = await getUserByWallet(address);

          if (existingUser) {
            return {
              id: existingUser.id,
              name: existingUser.username || existingUser.wallet_address,
              email: existingUser.wallet_address,
              type: "regular",
            };
          }

          // Create new user
          const [newUser] = await createUser(address);

          return {
            id: newUser.id,
            name: newUser.username || newUser.wallet_address,
            email: newUser.wallet_address,
            type: "regular",
          };
        } catch (error) {
          console.error("SIWE authorization error:", error);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.type = user.type;
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.type = token.type;
      }

      return session;
    },
  },
});
