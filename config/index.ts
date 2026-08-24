import { type Chain, mainnet } from "viem/chains";
import { lcai, lcaiLocalhost, lcaiTestnet } from "./chains";

export const isTestnet = process.env.NEXT_PUBLIC_LCAI_IS_TESTNET === "true";

// The [lcaiTestnet.id] keys in the address maps below are written after
// [lcai.id]. Now that lcaiTestnet.id is build-arg driven, a devnet build that
// set NEXT_PUBLIC_CHAIN_ID=9200 would overwrite the source-pinned mainnet
// addresses with testnet ones. Fail the build instead.
if (isTestnet && lcaiTestnet.id === lcai.id) {
  throw new Error(
    `NEXT_PUBLIC_CHAIN_ID=${lcaiTestnet.id} collides with mainnet's chain id; refusing to build.`,
  );
}

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
// Redeploy 2026-08-24 (redeploy-2026-08-23/deployed-addresses.env): testnet
// defaults track the R8 fresh proxied deployment; the image build still
// passes them explicitly as build args (runbook §4 row 7).
const TESTNET_JOB_REGISTRY =
  (process.env.NEXT_PUBLIC_JOB_REGISTRY_ADDRESS as `0x${string}` | undefined) ??
  "0x62C01304e05a336fDAf478C7Be255F5297d8dC69";
const TESTNET_AI_CONFIG =
  (process.env.NEXT_PUBLIC_AI_CONFIG_ADDRESS as `0x${string}` | undefined) ??
  "0x49392B2f285Ab77f77a7B61545B128A13D1CCCC9";
const TESTNET_WORKER_REGISTRY =
  (process.env.NEXT_PUBLIC_WORKER_REGISTRY_ADDRESS as
    | `0x${string}`
    | undefined) ?? "0x34BA0f8c7b658d69f3F7A947ca4d0A9FB5779E91";

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
