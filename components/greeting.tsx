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
  const { hasActiveSubscription } = useSubscription();
  const { open } = useAppKit();
  const { isConnected } = useAccount();

  return (
    <div
      className="mx-auto mt-4 flex size-full max-w-3xl flex-col items-center justify-center px-4 md:px-8"
      key="overview"
    >
      <motion.h1
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto max-w-[600px] text-center font-medium text-[40px] text-content-dark leading-[1.05] tracking-[-1.4px] md:text-[50px] lg:text-[55px] xl:text-[60px]"
        exit={{ opacity: 0, y: 10 }}
        initial={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.2, duration: 0.5 }}
      >
        Start talking with <span className="text-content-light">Lightchain</span>{" "}
        <span className="bg-gradient-primary bg-clip-text text-transparent">
          AI Chat
        </span>
      </motion.h1>

      {!isConnected || status !== "authenticated" ? (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-8 mt-3"
          exit={{ opacity: 0, y: 10 }}
          initial={{ opacity: 0, y: 10 }}
          transition={{ delay: 0.4, duration: 0.5 }}
        >
          <p className="max-w-md text-center text-content-medium text-base">
            Connect your wallet to sign in with Lightchain AI and start chatting
            with LCAI Chat
          </p>
          <Button onClick={() => open()} variant="gradient" className="rounded-[10px]">
            <WalletMinimal />
            Connect Wallet
          </Button>
        </motion.div>
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
              className="mx-auto w-full max-w-180 rounded-3xl p-1 bg-linear-to-r from-[#664BFD] to-[#EEA180] mt-10"
              exit={{ opacity: 0, y: 10 }}
              initial={{ opacity: 0, y: 10 }}
              transition={{ delay: 0.6, duration: 0.5 }}
            >
              <div className="p-5 bg-background rounded-[22px]">
                <div className="flex flex-col gap-y-4 lg:grid grid-cols-2 lg:items-end">
                  <div className="space-y-5 lg:border-r border-surface-base-extraLight sm:pr-6">
                    <div className="flex size-11 items-center justify-center rounded-full bg-surface-base-brand-strong">
                      <Crown className="siz-6 text-white" />
                    </div>
                    <div>
                      <h5 className="font-medium text-lg text-content-strong">
                        No Active Subscription
                      </h5>
                      <p className="mt-2 text-sm text-content-medium">
                        Subscribe to a plan to unlock unlimited conversations with
                        AI models, priority support, and advanced features.
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2 lg:pl-6">
                    <div className="flex items-baseline gap-2 text-sm text-content-medium">
                      <Check size={16} className="translate-0.5" />
                      <span>Pause subscription anytime</span>
                    </div>
                    <div className="flex items-baseline gap-2 text-sm text-content-medium">
                      <Check size={16} className="translate-0.5" />
                      <span>Cancel anytime</span>
                    </div>
                    <div className="flex items-baseline gap-2 text-sm text-content-medium">
                      <Check size={16} className="translate-0.5" />
                      <span>Choose from Basic, Pro, Enterprise plans</span>
                    </div>
                    <div className="flex items-baseline gap-2 text-sm text-content-medium">
                      <Check size={16} className="translate-0.5" />
                      <span>Save chat history</span>
                    </div>
                    <div className="flex items-baseline gap-2 text-sm text-content-medium">
                      <Check size={16} className="translate-0.5" />
                      <span>Flexible monthly / yearly billing</span>
                    </div>
                  </div>
                </div>
                <Button
                  className="px-6 py-2 rounded-[10px] font-semibold w-full text-sm mt-5"
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
