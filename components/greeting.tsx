import { motion } from "framer-motion";
import { ConnectWalletButton } from "./connect-wallet-button";

export const Greeting = () => {
  return (
    <div
      className="mx-auto mt-4 flex size-full max-w-3xl flex-col items-center justify-center gap-8 px-4 md:mt-16 md:px-8"
      key="overview"
    >
      <div className="flex flex-col items-center gap-4">
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="font-semibold text-xl md:text-5xl"
          exit={{ opacity: 0, y: 10 }}
          initial={{ opacity: 0, y: 10 }}
          transition={{ delay: 0.5 }}
        >
          Start talking with
        </motion.div>
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="text-xl text-zinc-400 md:text-5xl"
          exit={{ opacity: 0, y: 10 }}
          initial={{ opacity: 0, y: 10 }}
          transition={{ delay: 0.6 }}
        >
          Lightchain{" "}
          <span className="bg-linear-to-l from-[#7064E9] to-[#DD00AC] bg-clip-text text-3xl text-transparent md:text-7xl">
            AI Chat
          </span>
        </motion.div>
      </div>

      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center gap-4"
        exit={{ opacity: 0, y: 10 }}
        initial={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.7 }}
      >
        <ConnectWalletButton />
        <p className="max-w-md text-center text-gray-500 text-sm dark:text-zinc-400">
          Connect your wallet to sign in with Lightchain AI and start chatting
          with LCAI Chat
        </p>
      </motion.div>
    </div>
  );
};
