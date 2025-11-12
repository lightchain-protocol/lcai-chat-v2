import { useAppKit } from "@reown/appkit/react";
import { useAccount } from "wagmi";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

export const ConnectWalletButton = ({ className }: { className?: string }) => {
  const { open } = useAppKit();
  const { address } = useAccount();

  return (
    <Button
      className={cn("px-8 py-6 text-lg", className)}
      onClick={() => open()}
      type="button"
      variant={address ? "outline" : "gradient"}
    >
      {address
        ? `${address.slice(0, 6)}...${address.slice(-4)}`
        : "Connect Wallet"}
    </Button>
  );
};
