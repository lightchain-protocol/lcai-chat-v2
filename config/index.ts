import { type Chain, mainnet } from "viem/chains";
import { lcai, lcaiLocalhost, lcaiTestnet } from "./chains";

export const isTestnet = process.env.NEXT_PUBLIC_LCAI_IS_TESTNET === "true";
export const isSortitionEnabled =
  process.env.NEXT_PUBLIC_SORTITION_ENABLED === "true";

// Model that backs the assistant-message "read aloud" button. Submitting a
// normal protocol job with this modelId and a plain-text `input` makes the
// worker synthesize speech and return base64-encoded MP3 bytes instead of
// text. Overridable — a devnet with its own tts-piper deployment can retarget
// the button without a source edit — and falls back to the registered
// tts-piper model. Direct `process.env.NEXT_PUBLIC_*` access (not dynamic
// indexing) is required so Next.js inlines the value into the client bundle.
// An undeclared or empty build arg arrives as an empty string, which must
// fall through to the default — hence `||`, not `??`.
export const ttsModelId =
  (process.env.NEXT_PUBLIC_TTS_MODEL_ID as `0x${string}` | undefined) ||
  "0x8c350127cf0c957d1c2ee6837fa793af56430150d69c4543c82b74e1e8dc7784";

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
    [lcaiLocalhost.id]: "0x9A9f2CCfdE556A7E9Ff0848998Aa4a0CFD8863AE",
    [lcaiTestnet.id]: TESTNET_JOB_REGISTRY,
  } as Record<number, `0x${string}`>,

  aiConfigAddress: {
    [lcai.id]: "0x24D11533C354092ed6E18b964257819cE78Ce77D",
    [lcaiLocalhost.id]: "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318",
    [lcaiTestnet.id]: TESTNET_AI_CONFIG,
  } as Record<number, `0x${string}`>,

  workerRegistryAddress: {
    [lcai.id]: "0x0000000000000000000000000000000000001002",
    [lcaiLocalhost.id]: "0x0000000000000000000000000000000000001002",
    [lcaiTestnet.id]: TESTNET_WORKER_REGISTRY,
  } as Record<number, `0x${string}`>,

  lcaiToken: {
    [lcaiLocalhost.id]: {
      address: "0x0000000000000000000000000000000000000000",
      symbol: "LCAI",
      name: "LCAI",
      image: "/images/logo/favicon.png",
      decimals: 18,
    },
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
