import { type Chain, mainnet } from "viem/chains";
import { lcai, lcaiTestnet } from "./chains";

// const customMainnet: Chain = {
//   ...mainnet,
//   rpcUrls: {
//     default: {
//       http: ["https://mainnet.infura.io/v3/e4c15472e4824fefae8a9d5b265e8180"],
//     },
//   },
// };

export const isTestnet = process.env.NEXT_PUBLIC_LCAI_IS_TESTNET === "true";

// Testnet contract addresses are build-arg overridable so local devnets
// (chainId 8200, freshly-deployed contracts) and forks can point the
// frontend at their own deployments without a source edit. When the env
// var is unset the public testnet's address is used.
//
// Mainnet entries are intentionally NOT overridable — keeping them
// source-pinned prevents an env misconfig from silently retargeting a
// production build at an attacker's contracts.
//
// Direct `process.env.NEXT_PUBLIC_*` access (not dynamic indexing) is
// required so Next.js inlines the value into the client bundle.
const TESTNET_JOB_REGISTRY =
  (process.env.NEXT_PUBLIC_JOB_REGISTRY_ADDRESS as `0x${string}` | undefined) ??
  "0x531b3A87c5D785441B9cF55b98169F20FD9056a7";
const TESTNET_AI_CONFIG =
  (process.env.NEXT_PUBLIC_AI_CONFIG_ADDRESS as `0x${string}` | undefined) ??
  "0xeCF4Ca5Ba6D97ae586993e170764a1E92231b67e";
const TESTNET_WORKER_REGISTRY =
  (process.env.NEXT_PUBLIC_WORKER_REGISTRY_ADDRESS as
    | `0x${string}`
    | undefined) ?? "0x0000000000000000000000000000000000001002";

const config = {
  chains: [isTestnet ? lcaiTestnet : lcai] as [Chain, ...Chain[]],
  subscriptionContractAddress: {
    // [lcaiTestnet.id]: "0x0670662b75f92D14A645545bf3B0eDdfd5E299bd",
    [mainnet.id]: "0x535AE6B51742df53c1d5C4Ae6496cAd935615E3b",
  } as Record<number, `0x${string}`>,

  jobRegistryAddress: {
    [lcai.id]: "0xfB15F90298e4CcD7106E76fFB5e520315cC42B0b",
    [lcaiTestnet.id]: TESTNET_JOB_REGISTRY,
  } as Record<number, `0x${string}`>,

  aiConfigAddress: {
    [lcai.id]: "0x24D11533C354092ed6E18b964257819cE78Ce77D",
    [lcaiTestnet.id]: TESTNET_AI_CONFIG,
  } as Record<number, `0x${string}`>,

  workerRegistryAddress: {
    [lcai.id]: "0x0000000000000000000000000000000000001002",
    [lcaiTestnet.id]: TESTNET_WORKER_REGISTRY,
  } as Record<number, `0x${string}`>,

  lcaiToken: {
    [lcai.id]: {
      address: "0x0000000000000000000000000000000000000000",
      symbol: "LCAI",
      name: "LCAI",
      image: "/images/logo/favicon.png",
      decimals: 18,
    },
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
