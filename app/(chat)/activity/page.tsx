import { redirect } from "next/navigation";
import { TransactionsPanel } from "@/components/transactions-panel";
import { auth } from "../../(auth)/auth";

export default async function ActivityPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  return <TransactionsPanel />;
}
