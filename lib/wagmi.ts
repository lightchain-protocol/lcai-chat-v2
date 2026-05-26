import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { http } from "viem";
import config from "@/config";

// Get projectId from https://dashboard.reown.com
export const projectId =
  process.env.NEXT_PUBLIC_PROJECT_ID || "b56e18d47c72ab683b10814fe9495694"; // this is a public projectId only to use on localhost

if (!projectId) {
  throw new Error("Project ID is not defined");
}

export const networks = config.chains;

// Explicit transports per chain. Without this, AppKit's WagmiAdapter routes
// chain reads through Reown's hosted blockchain-api proxy
// (rpc.walletconnect.org/v1/?chainId=eip155:<id>) which has chainId 8200
// pre-registered to the public LightchainAI testnet. Passing an explicit
// viem http() transport keyed off each chain's rpcUrls forces the dapp to
// hit the same endpoint declared in `lcaiTestnet` (NEXT_PUBLIC_RPC_URL).
const transports = Object.fromEntries(
  config.chains.map((chain) => [
    chain.id,
    http(chain.rpcUrls.default.http[0]),
  ]),
);

//Set up the Wagmi Adapter (Config)
export const wagmiAdapter = new WagmiAdapter({
  ssr: true,
  projectId,
  networks,
  transports,
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
