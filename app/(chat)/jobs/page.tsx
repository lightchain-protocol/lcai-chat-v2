import { redirect } from "next/navigation";
import { JobsDashboard } from "@/components/jobs-dashboard";
import { $http } from "@/lib/http";
import { auth } from "../../(auth)/auth";

export type DashboardJob = {
  jobId: string | null;
  sessionId: string | null;
  chatId: string;
  chatTitle: string | null;
  messageId: string;
  role: string;
  createdAt: string;
  indexer: {
    worker: string;
    state: string | null;
    escrowedFee: string;
    submittedAt: number;
    acknowledgedAt: number;
    completedAt: number;
    releasedAt: number;
    disputeWindow: number | null;
    canClaimTimeout: boolean;
    disputeWindowOpen: boolean;
    disputeBond: string | null;
  } | null;
};

async function fetchUserJobs(): Promise<DashboardJob[]> {
  try {
    const res = await $http.get("/api/jobs");
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function JobsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  const jobs = await fetchUserJobs();

  return <JobsDashboard initialJobs={jobs} />;
}
