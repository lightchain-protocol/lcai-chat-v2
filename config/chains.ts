import type { Chain } from "viem";

export const devnet: Chain = {
  id: 31337,
  name: "LightchainAI Devnet",
  nativeCurrency: {
    name: "LightchainAI",
    symbol: "LCAI",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["http://localhost:8545"],
    },
  },
  blockExplorers: {
    default: {
      name: "LightchainAI Devnet Explorer",
      url: "http://localhost",
    },
  },
};

export const lcai: Chain = {
  id: 9200,
  name: "LightchainAI",
  nativeCurrency: {
    name: "LightchainAI",
    symbol: "LCAI",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.mainnet.lightchain.ai"],
    },
  },
  blockExplorers: {
    default: {
      name: "LightchainAI Explorer",
      url: "https://mainnet.lightscan.app",
    },
  },
};

export const lcaiTestnet: Chain = {
  id: 8200,
  name: "LightchainAI Testnet",
  nativeCurrency: {
    name: "LightchainAI",
    symbol: "LCAI",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      // Overridable via NEXT_PUBLIC_RPC_URL (baked at build time).
      http: [
        process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc.testnet.lightchain.ai",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "LightchainAI Testnet Explorer",
      url: "https://testnet.lightscan.app",
    },
  },
};
