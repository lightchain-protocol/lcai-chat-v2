import { notFound } from "next/navigation";
import { Playground } from "@/components/playground";
import { isTestnet } from "@/config";

/** Testnet only, until the Developer API is live on mainnet. */
export default function PlaygroundPage() {
  if (!isTestnet) {
    notFound();
  }

  return <Playground />;
}
