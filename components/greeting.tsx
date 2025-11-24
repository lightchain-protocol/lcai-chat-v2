"use client";

import { useAppKit } from "@reown/appkit/react";
import { motion } from "framer-motion";
import { Crown, Loader2 } from "lucide-react";
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
      className="mx-auto mt-4 flex size-full max-w-3xl flex-col items-center justify-center gap-6 px-4 md:mt-16 md:px-8"
      key="overview"
    >
      <motion.h1
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto mb-4 max-w-[600px] text-center font-medium text-[40px] text-content-dark leading-[1.05] tracking-[-1.4px] md:text-[50px] lg:text-[60px] xl:text-[70px]"
        exit={{ opacity: 0, y: 10 }}
        initial={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.2, duration: 0.5 }}
      >
        Start talking with <span className="text-content-light">Lightchain</span>{" "}
        <span className="bg-linear-to-r from-[#DD00AC] to-[#7064E9] bg-clip-text text-transparent">
          AI Chat
        </span>
      </motion.h1>

      {!isConnected || status !== "authenticated" ? (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-3"
          exit={{ opacity: 0, y: 10 }}
          initial={{ opacity: 0, y: 10 }}
          transition={{ delay: 0.4, duration: 0.5 }}
        >
          <Button onClick={() => open()} variant="gradient">
            Connect Wallet
          </Button>
          <p className="max-w-md text-center text-gray-500 text-sm dark:text-zinc-400">
            Connect your wallet to sign in with Lightchain AI and start chatting
            with LCAI Chat
          </p>
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
              className="mx-auto w-full max-w-xl"
              exit={{ opacity: 0, y: 10 }}
              initial={{ opacity: 0, y: 10 }}
              transition={{ delay: 0.6, duration: 0.5 }}
            >
              <div className="rounded-xl bg-surface-m-soft p-6">
                <div className="mb-4 flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[#7064E9]/30 bg-linear-to-b from-[#7064E9]/20 to-[#5B4FCC]/10">
                    <Crown className="size-4 text-[#7064E9]" />
                  </div>
                  <div className="flex-1">
                    <h3 className="mb-1 font-semibold text-lg text-content-default">
                      No Active Subscription
                    </h3>
                    <p className="text-sm text-content-light leading-relaxed">
                      Subscribe to a plan to unlock unlimited conversations with
                      AI models, priority support, and advanced features.
                    </p>
                  </div>
                </div>
                <div className="mb-4 space-y-2 pl-[52px]">
                  <div className="flex items-center gap-2 text-sm text-content-light">
                    <span className="size-1.5 rounded-full bg-content-default" />
                    <span>Choose from Basic, Pro, or Enterprise plans</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-content-light">
                    <span className="size-1.5 rounded-full bg-content-default" />
                    <span>Flexible monthly or yearly billing</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-content-light">
                    <span className="size-1.5 rounded-full bg-content-default" />
                    <span>Cancel anytime, no commitments</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex justify-center">
                <Button
                  className="px-6 py-5 font-medium text-sm"
                  onClick={() => setIsSubscriptionDialogOpen(true)}
                  variant="gradient"
                >
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
