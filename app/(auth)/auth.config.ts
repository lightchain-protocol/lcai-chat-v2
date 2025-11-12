import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  trustHost: true,
  pages: {
    signIn: "/",
    newUser: "/",
  },
  providers: [
    // added later in auth.ts since it uses siwe which is only compatible with Node.js
    // while this file is also used in non-Node.js environments
  ],
  callbacks: {},
} satisfies NextAuthConfig;
