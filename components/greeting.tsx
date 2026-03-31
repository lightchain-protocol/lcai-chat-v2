"use client";

import { useAppKit } from "@reown/appkit/react";
import { motion } from "framer-motion";
import { Check, Crown, Loader2, WalletMinimal } from "lucide-react";
import { useSession } from "next-auth/react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import useSubscription from "@/hooks/use-subscription";
import useAppStore from "@/store";

export const Greeting = () => {
  const { status } = useSession();
  const { setIsSubscriptionDialogOpen } = useAppStore();
  // const { hasActiveSubscription } = useSubscription();
  const { open } = useAppKit();
  const { isConnected } = useAccount();

  return null;

  return (
    <div
      className="mx-auto mt-4 flex size-full max-w-3xl flex-col items-center justify-center px-4 md:px-8"
      key="overview"
    >
      {!isConnected || status !== "authenticated" ? (
        <>
          <motion.h1
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto max-w-[600px] text-center font-medium text-[40px] text-content-dark leading-[1.05] tracking-[-1.4px] md:text-[50px] lg:text-[55px] xl:text-[60px]"
            exit={{ opacity: 0, y: 10 }}
            initial={{ opacity: 0, y: 10 }}
            transition={{ delay: 0.2, duration: 0.5 }}
          >
            Start talking with{" "}
            <span className="text-content-light">Lightchain</span>{" "}
            <span className="bg-gradient-primary bg-clip-text text-transparent">
              AI Chat
            </span>
          </motion.h1>
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 flex flex-col items-center gap-8"
            exit={{ opacity: 0, y: 10 }}
            initial={{ opacity: 0, y: 10 }}
            transition={{ delay: 0.4, duration: 0.5 }}
          >
            <p className="max-w-md text-center text-base text-content-medium">
              Connect your wallet to sign in with Lightchain AI and start
              chatting with LCAI Chat
            </p>
            <Button
              className="rounded-[10px]"
              onClick={() => open()}
              variant="gradient"
            >
              <WalletMinimal />
              Connect Wallet
            </Button>
          </motion.div>
        </>
      ) : (
        <>
          {/* Subscription Status */}
          {hasActiveSubscription.isLoading ? (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-center gap-2 py-3"
              exit={{ opacity: 0, y: 10 }}
              initial={{ opacity: 0, y: 10 }}
              transition={{ delay: 0.6, duration: 0.5 }}
            >
              <Loader2 className="size-3.5 animate-spin text-primary" />
              <span className="text-sm text-soft">
                Checking subscription status...
              </span>
            </motion.div>
          ) : hasActiveSubscription.data ? null : (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="mx-auto mt-10 w-full max-w-180 rounded-3xl bg-linear-to-r from-[#664BFD] to-[#EEA180] p-1"
              exit={{ opacity: 0, y: 10 }}
              initial={{ opacity: 0, y: 10 }}
              transition={{ delay: 0.6, duration: 0.5 }}
            >
              <div className="rounded-[22px] bg-background p-5">
                <div className="flex grid-cols-2 flex-col gap-y-4 lg:grid lg:items-end">
                  <div className="space-y-5 border-surface-base-extraLight sm:pr-6 lg:border-r">
                    <div className="flex size-11 items-center justify-center rounded-full bg-surface-base-brand-strong">
                      <Crown className="siz-6 text-white" />
                    </div>
                    <div>
                      <h5 className="font-medium text-content-strong text-lg">
                        No Active Subscription
                      </h5>
                      <p className="mt-2 text-content-medium text-sm">
                        Subscribe to a plan to unlock unlimited conversations
                        with AI models, priority support, and advanced features.
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2 lg:pl-6">
                    <div className="flex items-baseline gap-2 text-content-medium text-sm">
                      <Check className="translate-0.5" size={16} />
                      <span>Access to Lightchain AI Model</span>
                    </div>
                    <div className="flex items-baseline gap-2 text-content-medium text-sm">
                      <Check className="translate-0.5" size={16} />
                      <span>Unlimited sessions</span>
                    </div>
                    <div className="flex items-baseline gap-2 text-content-medium text-sm">
                      <Check className="translate-0.5" size={16} />
                      <span>Choose from Basic, Pro, Enterprise plans</span>
                    </div>
                    <div className="flex items-baseline gap-2 text-content-medium text-sm">
                      <Check className="translate-0.5" size={16} />
                      <span>Save chat history</span>
                    </div>
                    <div className="flex items-baseline gap-2 text-content-medium text-sm">
                      <Check className="translate-0.5" size={16} />
                      <span>Flexible monthly / yearly billing</span>
                    </div>
                  </div>
                </div>
                <Button
                  className="mt-5 w-full rounded-[10px] px-6 py-2 font-semibold text-sm"
                  onClick={() => setIsSubscriptionDialogOpen(true)}
                  variant="gradient"
                >
                  <Crown className="siz-4" />
                  View Plans & Subscribe
                </Button>
              </div>
            </motion.div>
          )}
        </>
      )}
    </div>
  );
};
