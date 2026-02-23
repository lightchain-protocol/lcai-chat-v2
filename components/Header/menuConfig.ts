import {
  Route,
  FileText,
  ShieldCheck,
  BadgeCheck,
  Repeat,
  UserCog,
  Box,
  Users,
  ArrowUpCircle,
  ScrollText,
  Coins,
  Shuffle,
  Fuel,
  Signature,
  PlugZap,
  SquareKanban,
  Network,
  Droplet,
  Wallet,
  Link,
  RefreshCw,
  Gift,
  BookOpen,
  Code,
  Boxes,
  HandCoins,
  MessageSquare,
  Headphones,
  CircleHelp,
  Rocket,
  Vote,
  Twitter,
  Send,
  LineChart,
  UserCog as LucideUsersCog
} from "lucide-react";

import { MenuConfig } from "./types";

export const menus: MenuConfig[] = [
  // ABOUT
  {
    label: "About",
    align: "left",
    width: "small",
    columns: [
      {
        type: "cards",
        items: [
          { label: "Roadmap", desc: "Our development journey", href: "https://lightchain.ai/roadmap", icon: Route },
          { label: "Whitepaper", desc: "Read the technical overview", href: "https://lightchain.ai/lightchain-whitepaper.pdf", icon: FileText },
          { label: "Audits", desc: "Security verification reports", href: "https://docs.lightchain.ai/docs/getting-started/audits", icon: ShieldCheck },
          { label: "LCAI Brand Guideline", desc: "Visual assets and brand identity", href: "https://lightchain.ai/brand", icon: BadgeCheck },
        ],
      },
    ],
  },

  // BLOCKCHAIN
  {
    label: "Blockchain",
    align: "left",
    width: "xwide",
    columns: [
      { type: "title", title: "Explorer (Testnet)" },
      {
        type: "cards",
        items: [
          { label: "Transactions", desc: "Browse all transactions", href: "https://testnet.lightscan.app/txs", icon: Repeat },
          { label: "User Operations", desc: "Explore user-level actions", href: "https://testnet.lightscan.app/ops", icon: UserCog },
          { label: "Blocks", desc: "Track recent block activity", href: "https://testnet.lightscan.app/blocks", icon: Box },
          { label: "Top Accounts", desc: "Most active addresses", href: "https://testnet.lightscan.app/accounts", icon: Users },
          { label: "Withdrawals", desc: "View recent withdrawals", href: "https://testnet.lightscan.app/withdrawals", icon: ArrowUpCircle },
          { label: "Verified Contracts", desc: "Browse verified contracts", href: "https://testnet.lightscan.app/verified-contracts", icon: ScrollText },
          { label: "Tokens", desc: "Explore all listed tokens", href: "https://testnet.lightscan.app/tokens", icon: Coins },
          { label: "Token Transfers", desc: "Track token movement", href: "https://testnet.lightscan.app/token-transfers", icon: Shuffle },
          { label: "Gas Tracker", desc: "Check current gas fees", href: "https://testnet.lightscan.app/gas-tracker", icon: Fuel },
          { label: "Contract Verifier", desc: "Verify your smart contract", href: "https://testnet.lightscan.app/contract-verification", icon: Signature },
        ],
      },
      { type: "title", title: "APIs" },
      {
        type: "cards",
        items: [
          { label: "REST API", desc: "Access RESTful endpoints", href: "https://testnet.lightscan.app/api-docs", icon: PlugZap },
          { label: "GraphQL", desc: "Query via GraphQL interface", href: "https://testnet.lightscan.app/graphiql", icon: SquareKanban },
          { label: "RPC API", desc: "Remote procedure calls", href: "https://testnet.lightscan.app/api-docs", icon: Network },
        ],
      },
      {
        type: "cards",
        items: [
          { label: "Faucet", desc: "Claim testnet tokens", href: "https://lightfaucet.ai/", icon: Droplet },
          { label: "External Wallet (soon)", desc: "Feature coming soon", href: "#", icon: Wallet },
          { label: "Bridge", desc: "Cross-chain asset transfers", href: "https://bridge-testnet.lightchain.ai/", icon: Link },
          { label: "SWAP", desc: "Decentralized token exchange", href: "https://dex-testnet.lightchain.ai/", icon: RefreshCw },
        ],
      },
    ],
  },

  // LIGHTCHAIN
  {
    label: "Lightchain",
    align: "left",
    width: "wide",
    columns: [
      { type: "title", title: "Get Started" },
      {
        type: "cards",
        items: [
          { label: "Win $100K", desc: "Participate & win big", href: "https://lightchain.ai/join", icon: Gift },
          { label: "Developer Docs", desc: "Build with Lightchain", href: "https://docs.lightchain.ai/", icon: BookOpen },
          { label: "IDE", desc: "Code directly in browser", href: "https://deploy.lightchain.ai/", icon: Code },
          { label: "SDKs (soon)", desc: "Software development kits", href: "#", icon: Boxes },
          { label: "Grants", desc: "Funding for builders", href: "https://lightchain.ai/grant", icon: HandCoins },
        ],
      },
      {
        type: "imageCard",
        href: "https://lightchain.ai/blogs",
        img: "/images/header/menu-lightchain.webp",
        badge: "News Portal",
        title: "Explore What’s New at Lightchain AI",
        meta: "Latest announcements",
      },
    ],
  },

  // COMMUNITY
  {
    label: "Community",
    align: "left",
    width: "small",
    columns: [
      {
        type: "cards",
        items: [
          { label: "Forum", desc: "Join community discussions", href: "https://forum.lightchain.ai/", icon: MessageSquare },
          { label: "Support", desc: "Get help on Telegram", href: "https://discord.gg/lightchain", icon: Headphones },
          { label: "FAQs", desc: "Frequently asked questions", href: "https://lightchain.ai/#faq-setion", icon: CircleHelp },
          { label: "Developer Grant Portal", desc: "Apply for funding", href: "https://lightchain.ai/grant", icon: Rocket },
          { label: "Governance Voting", desc: "Shape the future of Lightchain", href: "https://dao.lightchain.ai/", icon: Vote },
        ],
      },
    ],
  },

  // SOCIAL
  {
    label: "Social",
    align: "left",
    width: "small",
    columns: [
      {
        type: "cards",
        items: [
          { label: "Twitter (X)", desc: "Follow us on X", href: "https://x.com/LightchainAI", icon: Twitter },
          { label: "Discord", desc: "Join our Discord community", href: "https://discord.gg/lightchain", icon: Send },
          { label: "CoinMarketCap", desc: "See our profile & posts", href: "https://coinmarketcap.com/community/profile/lightchainai/", icon: LineChart },
          { label: "Linktree", desc: "All our links in one place", href: "https://linktr.ee/lightchainai", icon: Link },
          { label: "Community Hub", desc: "Explore community channels", href: "https://forum.lightchain.ai/", icon: Users },
        ],
      },
    ],
  },
];
