import { redirect } from "next/navigation";
import { auth } from "@/app/(auth)/auth";
import { DeveloperApiPanel } from "@/components/developer-api-panel";

export default async function DeveloperPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  return <DeveloperApiPanel />;
}
