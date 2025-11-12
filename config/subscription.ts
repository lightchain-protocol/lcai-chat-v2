export type PricingTier = {
  id: number;
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  features: string[];
  popular?: boolean;
};

export const tierDetails: PricingTier[] = [
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
