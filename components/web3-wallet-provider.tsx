"use client";

import { createAppKit } from "@reown/appkit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { type Config, cookieToInitialState, WagmiProvider } from "wagmi";
import { siweConfig } from "@/lib/siwe/config";
import { networks, projectId, wagmiAdapter } from "@/lib/wagmi";

// Set up queryClient
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

// Set up metadata
//
// `url` has to match the origin actually serving the dapp. Wallets check a
// signing request against this value, so a hardcoded production URL while
// running on localhost makes WalletConnect warn and can leave the request
// hanging without ever surfacing in the wallet. Use the live origin in the
// browser; keep the production URL for SSR, where there is no window.
const metadata = {
  name: "LCAI Chat",
  description: "LCAI Chat using AI SDK with Web3 Authentication",
  url:
    typeof window === "undefined"
      ? "https://chat.lightchain.ai"
      : window.location.origin,
  icons: ["https://avatars.githubusercontent.com/u/179229932"],
};

createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks,
  metadata,
  defaultNetwork: networks[0],
  themeMode: "dark",
  features: {
    analytics: true, // Optional - defaults to your Cloud configuration
  },
  siweConfig, // pass your siweConfig
});

function Web3WalletProvider({
  children,
  cookies,
}: {
  children: ReactNode;
  cookies: string | null;
}) {
  const initialState = cookieToInitialState(
    wagmiAdapter.wagmiConfig as Config,
    cookies
  );

  return (
    <WagmiProvider
      config={wagmiAdapter.wagmiConfig as Config}
      initialState={initialState}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

export default Web3WalletProvider;
