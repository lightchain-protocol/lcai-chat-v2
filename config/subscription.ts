export type SubscriptionTier = {
  id: number;
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  features: string[];
  popular?: boolean;
};

export const tierDetails: SubscriptionTier[] = [
  {
    id: 1,
    name: "Basic",
    monthlyPrice: 4200,
    yearlyPrice: 45_000,
    popular: true,
    features: [
      "100 messages per month",
      "Access to Lightchain AI Model",
      "Unlimited sessions",
      "Import / Export chats",
      "Custom system prompt settings",
      "Public & private chats",
    ],
  },
  // {
  //   id: 2,
  //   name: "Pro",
  //   popular: true,
  //   monthlyPrice: 5,
  //   yearlyPrice: 50,
  //   features: [
  //     "Unlimited messages",
  //     "Access to all models",
  //     "5 concurrent sessions",
  //     "Advanced features",
  //   ],
  // },
  // {
  //   id: 3,
  //   name: "Enterprise",
  //   monthlyPrice: 10,
  //   yearlyPrice: 100,
  //   features: [
  //     "Unlimited everything",
  //     "Custom models",
  //     "Unlimited sessions",
  //     "API access",
  //     "Custom integrations",
  //   ],
  // },
];

export const tokenLimits = {
  basic: 100_000, // 100K tokens
  pro: 1_000_000, // 1M tokens (unlimited in practice)
  enterprise: 10_000_000, // 10M tokens (unlimited in practice)
} as const;

export type SubscriptionTierType = keyof typeof tokenLimits;
