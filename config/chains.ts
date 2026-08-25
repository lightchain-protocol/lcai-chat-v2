import type { Chain } from "viem";

export const lcaiLocalhost: Chain = {
  id: 31337,
  name: "LightchainAI Localhost",
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
      name: "LightchainAI Localhost Explorer",
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
  // Overridable via NEXT_PUBLIC_CHAIN_ID (baked at build time), matching the
  // RPC URL below, so a private devnet presents its own chain id to the wallet
  // instead of claiming to be the public testnet. Unset falls back to 8200.
  //
  // Must be `||` and not `??`: Number(undefined) is NaN and Number("") is 0,
  // both falsy but neither nullish, so `??` would let them through.
  id: Number(process.env.NEXT_PUBLIC_CHAIN_ID) || 8200,
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
