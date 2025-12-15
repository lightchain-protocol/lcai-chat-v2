import { Gift } from "lucide-react";
import Image from "next/image";
import AlertCloseButton from "./AlertCloseButton";

type AlertInfoProps = {
  children?: React.ReactNode;
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  id?: string | number;
};
const AlertReward = ({
  children,
  title,
  description,
  icon,
  id
}: AlertInfoProps) => {
  return (
    <div className={`rounded-[20px] bg-bdr-light dark:bg-gradient-to-r from-[#ca12b82d] to-[rgba(255,255,255,0.04)] w-full min-w-75 sm:min-w-90 relative p-0.5`}
    >
      <div className={`rounded-[18px] bg-[linear-gradient(90deg,#FFD9F6_0%,#F0EEFF_88.1%)] shadow-[0_8px_36px_0_rgba(0,0,0,0.10)] dark:bg-[linear-gradient(90deg,#3F0E10_0%,#190A0D_100%)] dark:bg-[linear-gradient(90deg,rgba(214,14,179,0.2)_0%,rgba(76,4,67,0.02)_45.6%)] dark:shadow-[-10px_0_30px_0_rgba(212,11,179,0.3),_0_20px_40px_0_rgba(0,0,0,0.4)] w-full px-4 py-3 flex gap-3 ${
        title && description ? "items-start" : "items-center"
      }`}>
      {/* main content */}
      <span className="shrink-0 text-xl w-11 h-11 rounded-full flex items-center justify-center bg-[linear-gradient(91deg,#DD00AC_0.43%,#7064E9_88.66%),linear-gradient(180deg,rgba(112,100,233,0.9)_0%,rgba(91,79,204,0.9)_100%)] shadow-[0_4px_24px_0_rgba(0,0,0,0.24),inset_0_0_4px_0_rgba(255,255,255,0.25)] relative z-2">
        {icon ? icon : <Gift className="size-5 text-white" />}
      </span>
      <div className="relative z-2">
        {title && (
          <h6 className={`text-label-16-medium text-[#3D1D86] dark:text-content-strong`}>
            {title}
          </h6>
        )}
        {description && <p className={`mt-1 text-sm text-surface-base-brand-default dark:text-content-default`}>{description}</p>}
        {children}
      </div>
      <AlertCloseButton id={id!} />
    </div>
    </div>
  );
};

export default AlertReward;
