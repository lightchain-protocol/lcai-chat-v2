import { Gift } from "lucide-react";
import AlertCloseButton from "./AlertCloseButton";
import RewardIconSvg from "./RewardIconSvg";

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
    <div className={`rounded-[20px] bg-gradient-to-r from-[#ca12b82d] dark:from-[rgba(214,14,179,0.20)] dark:to-[#ca12b829] to-[#ca12b80e] w-full min-w-75 sm:min-w-90 relative p-0.5`}
    >
      <div className={`rounded-[18px] bg-[linear-gradient(90deg,#FFD9F6_0%,#F0EEFF_88.1%)] shadow-[0_8px_36px_rgba(0,0,0,0.10)] dark:bg-[linear-gradient(90deg,#3A0E38_0%,#140815_100%)] dark:shadow-[-10px_0_30px_rgba(212,11,179,0.30),_0_20px_40px_rgba(0,0,0,0.40)] w-full px-4 py-3 flex gap-3 ${
        title && description ? "items-start" : "items-center"
      }`}>
      {/* main content */}
      <span className="shrink-0 text-xl w-11 h-11 rounded-full flex items-center justify-center bg-[linear-gradient(91deg,#DD00AC_0.43%,#7064E9_88.66%),linear-gradient(180deg,rgba(112,100,233,0.9)_0%,rgba(91,79,204,0.9)_100%)] shadow-[0_4px_24px_0_rgba(0,0,0,0.24),inset_0_0_4px_0_rgba(255,255,255,0.25)] relative z-2">
        {icon ? icon : <RewardIconSvg />}
      </span>
      <div className="relative z-2">
        {title && (
          <h6 className={`text-label-16-medium text-[#3D1D86] dark:text-white`}>
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
