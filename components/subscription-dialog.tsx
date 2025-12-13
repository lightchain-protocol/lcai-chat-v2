"use client";

import type { DialogProps } from "@radix-ui/react-dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatEther } from "viem";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type SubscriptionTier, tierDetails } from "@/config/subscription";
import useSubscription from "@/hooks/use-subscription";
import { cn } from "@/lib/utils";
import AlertError from "./ui/toast/AlertError";

const billingPeriods = [
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
] as const;

const SubscriptionDialog = (props: DialogProps) => {
  const subscription = useSubscription();

  const [billingPeriod, setBillingPeriod] =
    useState<(typeof billingPeriods)[number]["value"]>("monthly");

  const tiers = useQuery({
    queryKey: ["tiers"],
    queryFn: () => subscription.contract.read.getAllPlans(),
    enabled: !!subscription.contract,
    select: (plans) =>
      plans.map((plan, index) => ({
        ...tierDetails[index],
        monthlyPrice: +formatEther(plan.monthlyPrice),
        yearlyPrice: +formatEther(plan.yearlyPrice),
      })),
  });

  const subscribeMutation = useMutation({
    mutationFn: (tier: SubscriptionTier) =>
      subscription.subscribe(
        tier.id,
        billingPeriod === "yearly",
        billingPeriod === "yearly" ? tier.yearlyPrice : tier.monthlyPrice
      ),
    onSuccess: () => {
      props.onOpenChange?.(false);
      toast.success("Subscription successful");
    },
    onError: (error: any) => {
      toast.custom(() => (
        <AlertError title={error.walk?.()?.shortMessage ||
          error.walk?.()?.message ||
          error.message ||
          "Subscription failed"} />
      ));
    },
  });

  const handleSubscribe = (tier: SubscriptionTier) => {
    subscribeMutation.mutate(tier);
  };

  return (
    <Dialog {...props}>
      <DialogContent className="max-h-[90vh] overflow-y-auto overflow-x-hidden rounded-3xl bg-background p-0 sm:max-w-4xl">
        {/* Gradient decorations */}
        <div className="-top-20 -left-20 absolute z-[-1] size-64 rounded-full bg-[#7064E9] opacity-20 blur-3xl" />
        <div className="-bottom-20 -right-20 absolute z-[-1] size-64 rounded-full bg-[#DD00AC] opacity-20 blur-3xl" />

        <div className="relative p-8">
          <DialogHeader className="mb-8">
            <DialogTitle asChild>
              <h3 className="text-center font-semibold text-3xl text-content-dark">
                Choose Your Plan
              </h3>
            </DialogTitle>
          </DialogHeader>

          {/* Billing Period Toggle */}
          <div className="mb-8 flex justify-center">
            <div className="inline-flex items-center gap-1 rounded-xl bg-surface-m-light p-1">
              {billingPeriods.map((period) => (
                <button
                  className={cn(
                    "rounded-lg px-6 py-2 font-medium text-sm transition-all",
                    billingPeriod === period.value
                      ? "bg-background"
                      : "text-content-default hover:bg-background",
                    subscribeMutation.isPending || tiers.isLoading
                      ? "cursor-not-allowed opacity-50"
                      : ""
                  )}
                  disabled={subscribeMutation.isPending || tiers.isLoading}
                  key={period.value}
                  onClick={() => setBillingPeriod(period.value)}
                  type="button"
                >
                  {period.label}
                </button>
              ))}
            </div>
          </div>

          {/* Pricing Cards */}
          {tiers.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex flex-col items-center gap-3">
                <Loader2Icon className="size-9 animate-spin text-[#7064E9]" />
                <p className="text-zinc-400">Loading plans...</p>
              </div>
            </div>
          ) : tiers.isError ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex flex-col items-center gap-3">
                <p className="text-zinc-400">Failed to load plans</p>
                <Button
                  className="border-zinc-800"
                  onClick={() => tiers.refetch()}
                  size="sm"
                  variant="outline"
                >
                  Retry
                </Button>
              </div>
            </div>
          ) : (
            <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
              {tiers.data?.map((tier) => (
                <div
                  className={cn(
                    "relative flex flex-col rounded-2xl p-6",
                    tier.popular
                      ? "border-2 border-primary"
                      : "border border-bdr-default"
                  )}
                  key={tier.name}
                >
                  <div className="flex-1">
                    {tier.popular && (
                      <div className="-top-3 -translate-x-1/2 absolute left-1/2">
                        <span className="rounded-full bg-linear-to-r from-[#DD00AC] to-[#7064E9] px-4 py-1 font-medium text-white text-xs">
                          Most Popular
                        </span>
                      </div>
                    )}

                    <div className="mb-6 text-center">
                      <h4 className="mb-3 font-semibold text-content-primary text-xl">
                        {tier.name}
                      </h4>
                      <div className="flex items-baseline justify-center gap-1">
                        <span className="font-bold text-4xl text-content-primary">
                          {billingPeriod === "monthly"
                            ? tier.monthlyPrice
                            : tier.yearlyPrice}{" "}
                          <span className="text-sm">LCAI</span>
                        </span>
                        <span className="text-sm text-content-light">
                          /{billingPeriod === "monthly" ? "month" : "year"}
                        </span>
                      </div>
                      {billingPeriod === "yearly" && (
                        <p className="mt-2 text-xs text-content-light">
                          Save $
                          {(tier.monthlyPrice * 12 - tier.yearlyPrice).toFixed(
                            2
                          )}{" "}
                          per year
                        </p>
                      )}
                    </div>

                    <ul className="mb-6 space-y-3">
                      {tier.features.map((feature) => (
                        <li
                          className="flex items-start gap-2 text-sm text-content-light"
                          key={feature}
                        >
                          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary">
                            <CheckIcon className="size-3 text-white" />
                          </span>
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <Button
                    className={cn(
                      "w-full disabled:cursor-not-allowed disabled:opacity-50"
                    )}
                    disabled={subscribeMutation.isPending}
                    onClick={() => handleSubscribe(tier)}
                    variant={tier.popular ? "gradient" : "outline"}
                  >
                    {subscribeMutation.isPending ? (
                      <div className="flex items-center justify-center gap-2">
                        <Loader2Icon className="size-3.5 animate-spin" />
                        Processing...
                      </div>
                    ) : (
                      <span>Subscribe</span>
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Cancel Button */}
          <div className="flex justify-center">
            <Button
              className="min-w-[200px]"
              disabled={subscribeMutation.isPending}
              onClick={() => props.onOpenChange?.(false)}
              variant="outline"
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SubscriptionDialog;
