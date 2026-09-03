import { redirect } from "next/navigation";
import { auth } from "@/app/(auth)/auth";
import { TransactionsPanel } from "@/components/transactions-panel";

export default async function ActivityPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  return <TransactionsPanel />;
}
