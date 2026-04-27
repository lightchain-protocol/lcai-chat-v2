import { type Chain, mainnet } from "viem/chains";

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
      http: ["https://rpc.testnet.lightchain.ai"],
    },
  },
  blockExplorers: {
    default: {
      name: "LightchainAI Testnet Explorer",
      url: "https://testnet-explorer.lightscan.app",
    },
  },
};

const customMainnet: Chain = {
  ...mainnet,
  rpcUrls: {
    default: {
      http: ["https://mainnet.infura.io/v3/e4c15472e4824fefae8a9d5b265e8180"],
    },
  },
};

const config = {
  chains: [lcaiTestnet] as [Chain, ...Chain[]],
  subscriptionContractAddress: {
    // [lcaiTestnet.id]: "0x0670662b75f92D14A645545bf3B0eDdfd5E299bd",
    [mainnet.id]: "0x535AE6B51742df53c1d5C4Ae6496cAd935615E3b",
  } as Record<number, `0x${string}`>,

  // Transitional: contract addresses from env vars until GET /api/system/config exists
  jobRegistryAddress: {
    [lcaiTestnet.id]: (process.env.NEXT_PUBLIC_JOB_REGISTRY_ADDRESS ??
      "0x") as `0x${string}`,
  } as Record<number, `0x${string}`>,

  aiConfigAddress: {
    [lcaiTestnet.id]: (process.env.NEXT_PUBLIC_AI_CONFIG_ADDRESS ??
      "0x") as `0x${string}`,
  } as Record<number, `0x${string}`>,

  workerRegistryAddress: {
    [lcaiTestnet.id]: (process.env.NEXT_PUBLIC_WORKER_REGISTRY_ADDRESS ?? "0x") as `0x${string}`,
  } as Record<number, `0x${string}`>,

  lcaiToken: {
    [lcaiTestnet.id]: {
      address: "0x0000000000000000000000000000000000000000",
      symbol: "LCAI",
      name: "LCAI",
      image: "/images/logo/favicon.png",
      decimals: 18,
    },
    [mainnet.id]: {
      address: "0x9ca8530ca349c966fe9ef903df17a75b8a778927",
      symbol: "LCAI", // token symbol
      name: "LCAI", // token name
      image: "/images/logo/favicon.png", // token image
      decimals: 18, // token decimals
    },
  } as Record<
    number,
    {
      address: `0x${string}`;
      symbol: string;
      name: string;
      image: string;
      decimals: number;
    }
  >,
};

export default config;
