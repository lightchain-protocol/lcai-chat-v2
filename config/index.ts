import type { Chain } from "viem/chains";

export const lcaiTestnet: Chain = {
  id: 504,
  name: "LCAI Testnet",
  nativeCurrency: {
    name: "LCAI Testnet",
    symbol: "LCAI",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://light-testnet-rpc.lightchain.ai"],
    },
  },
  blockExplorers: {
    default: {
      name: "LCAI Testnet Explorer",
      url: "https://testnet.lightscan.app",
    },
  },
};

const config = {
  chains: [lcaiTestnet] as [Chain, ...Chain[]],

  subscriptionContractAddress: {
    [lcaiTestnet.id]: "0x0670662b75f92D14A645545bf3B0eDdfd5E299bd",
  } as Record<number, `0x${string}`>,
};

export default config;
