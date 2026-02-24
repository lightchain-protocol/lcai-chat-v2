"use client";

import { Button } from "@/components/ui/button";
import AlertError from "@/components/ui/toast/AlertError";
import AlertInfo from "@/components/ui/toast/AlertInfo";
import AlertReward from "@/components/ui/toast/AlertReward";
import AlertSuccess from "@/components/ui/toast/AlertSuccess";
import AlertWarning from "@/components/ui/toast/AlertWarning";
import { toast } from "sonner";

const AlertsSection = () => {
   const handleError = () => {
    toast.custom((id) => (
      <AlertError
        description="An unexpected error occurred. Please try again."
        id={id}
        title="Something Went Wrong!"
      />
    ));
  };
  const handleReward = () => {
    toast.custom((id) => (
      <AlertReward
        description="Response saved and reward processed."
        id={id}
        title="Reward Issued!"
      />
    ));
  };
  const handleWarning = () => {
    toast.custom((id) => (
      <AlertWarning
        description="This needs your attention before continuing."
        id={id}
        title="Review Before Proceeding!"
      />
    ));
  };
  const handleSuccess = () => {
    toast.custom((id) => (
      <AlertSuccess
        description="Your action was completed successfully."
        id={id}
        title="Action Completed!"
      />
    ));
  };
  const handleInfo = () => {
    toast.custom((id) => (
      <AlertInfo
        description="Take a moment to review this update."
        id={id}
        title="Some Useful Information"
      />
    ));
  };
  return (
    <div>
      <div className="container mx-auto max-w-[1200px] py-8">
        <h2 className="font-semibold text-2xl lg:text-3xl xl:text-4xl">
          Alerts
        </h2>
        <div className="mt-4 flex flex-wrap gap-5">
          <Button onClick={handleError} variant="outline">
            Error Alert
          </Button>
          <Button onClick={handleReward} variant="outline">
            Reward Alert
          </Button>
          <Button onClick={handleWarning} variant="outline">
            Warning Alert
          </Button>
          <Button onClick={handleSuccess} variant="outline">
            Success Alert
          </Button>
          <Button onClick={handleInfo} variant="outline">
            Info Alert
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AlertsSection;

