import { useAppKit } from "@reown/appkit/react";
import { useAccount } from "wagmi";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

export const ConnectWalletButton = ({ className }: { className?: string }) => {
  const { open } = useAppKit();
  const { address } = useAccount();

  return (
    <Button
      className={cn(
        "px-8 py-6 text-lg",
        className,
        address
          ? "bg-gray-200 text-gray-800 hover:opacity-90"
          : "bg-linear-to-r from-[#7064E9] to-[#DD00AC] text-white hover:opacity-90"
      )}
      onClick={() => open()}
      type="button"
    >
      {address
        ? `${address.slice(0, 6)}...${address.slice(-4)}`
        : "Connect Wallet"}
    </Button>
  );
};
