"use client";

import type { DialogProps } from "@radix-ui/react-dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Loader2Icon, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatEther } from "viem";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type SubscriptionTier, tierDetails } from "@/config/subscription";
import useSubscription from "@/hooks/use-subscription";
import { cn, formatNumber } from "@/lib/utils";
import AlertError from "./ui/toast/AlertError";
import AlertSuccess from "./ui/toast/AlertSuccess";

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
      plans
        .map((plan, index) => ({
          ...tierDetails[index],
          monthlyPrice: +formatEther(plan.monthlyPrice),
          yearlyPrice: +formatEther(plan.yearlyPrice),
        }))
        .filter((tier) => tier.id),
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
      toast.custom((id) => (
        <AlertSuccess id={id} title="Subscription successful" />
      ));
    },
    onError: (error: any) => {
      toast.custom((id) => (
        <AlertError
          id={id}
          title={
            error.walk?.()?.shortMessage ||
            error.walk?.()?.message ||
            error.message ||
            "Subscription failed"
          }
        />
      ));
    },
  });

  const handleSubscribe = (tier: SubscriptionTier) => {
    subscribeMutation.mutate(tier);
  };

  return (
    <Dialog {...props}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto overflow-x-hidden rounded-3xl! bg-surface-elevation-light p-0 sm:max-w-4xl"
        hideClose
      >
        <div className="relative overflow-hidden p-4 sm:p-10">
          {/* Gradient decorations */}
          <div className="-top-28.5 -left-24.5 absolute z-[-1] size-59 rounded-full bg-surface-base-brand-strong opacity-20 blur-[100px]" />
          <div className="-bottom-20 -right-15.5 absolute z-[-1] size-59 rounded-full bg-[#D806AF] opacity-20 blur-[100px]" />
          <DialogClose asChild>
            <X
              className="absolute top-4 right-4 size-5 cursor-pointer text-content-soft hover:text-surface-base-brand-strong sm:top-6 sm:right-6 sm:size-6 md:size-8"
              size={36}
            />
          </DialogClose>
          <DialogHeader className="mb-5">
            <DialogTitle asChild>
              <h3 className="-tracking-[0.36px] text-center font-semibold text-2xl text-content-ultra md:text-3xl xl:text-4xl">
                Choose Your Plan
              </h3>
            </DialogTitle>
          </DialogHeader>

          {/* Billing Period Toggle */}
          <div className="mb-12 flex justify-center">
            <div className="inline-flex items-center gap-1 rounded-xl bg-surface-base-extraLight p-1">
              {billingPeriods.map((period) => (
                <button
                  className={cn(
                    "rounded-lg px-6 py-2 font-medium text-sm transition-all",
                    billingPeriod === period.value
                      ? "bg-surface-base-dark dark:bg-[rgba(204,206,239,0.12)]"
                      : "text-content-ultra hover:bg-surface-base-dark hover:dark:bg-[rgba(204,206,239,0.12)]",
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
                <Loader2Icon className="size-9 animate-spin text-surface-base-brand-default" />
                <p className="text-content-default">Loading plans...</p>
              </div>
            </div>
          ) : tiers.isError ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex flex-col items-center gap-3">
                <p className="text-content-default">Failed to load plans</p>
                <Button
                  className="border-bdr-default"
                  onClick={() => tiers.refetch()}
                  size="sm"
                  variant="outline"
                >
                  Retry
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-4">
              {tiers.data?.map((tier) => (
                <div
                  className={cn(
                    "relative flex max-w-96 flex-col rounded-[20px] bg-surface-base-dark p-6",
                    tier.popular
                      ? "border-2 border-surface-base-brand-default"
                      : "border border-bdr-soft"
                  )}
                  key={tier.name}
                >
                  <div className="flex-1">
                    {tier.popular && (
                      <div className="-top-3 -translate-x-1/2 absolute left-1/2">
                        <span className="whitespace-nowrap rounded-full bg-surface-base-brand-default px-3 py-1.5 font-normal text-sm text-white">
                          Most Popular
                        </span>
                      </div>
                    )}

                    <div className="mb-6">
                      <h4 className="mb-4 font-semibold text-content-default text-lg">
                        {tier.name}
                      </h4>
                      <div>
                        <span className="font-semibold text-4xl text-content-strong">
                          {billingPeriod === "monthly"
                            ? formatNumber(tier.monthlyPrice)
                            : formatNumber(tier.yearlyPrice)}
                        </span>
                        <span className="ml-1 inline-block font-bold text-content-strong text-sm">
                          LCAI
                        </span>
                        <span className="text-content-soft text-sm">
                          /{billingPeriod === "monthly" ? "month" : "year"}
                        </span>
                      </div>
                      {billingPeriod === "yearly" && (
                        <p className="mt-2 text-content-strong text-xs">
                          Save{" "}
                          {formatNumber(
                            tier.monthlyPrice * 12 - tier.yearlyPrice
                          )}{" "}
                          LCAI per year
                        </p>
                      )}
                    </div>

                    <ul className="mb-6 space-y-3">
                      {tier.features.map((feature) => (
                        <li
                          className="flex items-start gap-2.5 text-content-strong text-sm"
                          key={feature}
                        >
                          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary">
                            <Check className="size-3 text-white" />
                          </span>
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <Button
                    className={`w-full rounded-[10px] disabled:cursor-not-allowed disabled:opacity-50 ${tier.popular ? "" : "border-bdr-soft bg-surface-base-subtle"}`}
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
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SubscriptionDialog;
