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
    id: 0,
    name: "Basic",
    monthlyPrice: 2,
    yearlyPrice: 20,
    features: [
      "100 messages per month",
      "Access to basic models",
      "1 concurrent session",
    ],
  },
  {
    id: 1,
    name: "Pro",
    popular: true,
    monthlyPrice: 5,
    yearlyPrice: 50,
    features: [
      "Unlimited messages",
      "Access to all models",
      "5 concurrent sessions",
      "Advanced features",
    ],
  },
  {
    id: 2,
    name: "Enterprise",
    monthlyPrice: 10,
    yearlyPrice: 100,
    features: [
      "Unlimited everything",
      "Custom models",
      "Unlimited sessions",
      "API access",
      "Custom integrations",
    ],
  },
];

export const tokenLimits = {
  basic: 100_000, // 100K tokens
  pro: 1_000_000, // 1M tokens (unlimited in practice)
  enterprise: 10_000_000, // 10M tokens (unlimited in practice)
} as const;

export type SubscriptionTierType = keyof typeof tokenLimits;
