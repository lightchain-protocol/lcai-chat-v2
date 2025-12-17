import React from "react";
import AlertCloseButton from "./AlertCloseButton";
import WarningIconSvg from "./WarningIconSvg";

type AlertInfoProps = {
  children?: React.ReactNode;
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  id?: string | number;
};
const AlertError = ({ children, title, description, icon, id }: AlertInfoProps) => {
  return (
    <div className={`rounded-[20px] bg-gradient-to-r dark:from-[#cd0a0a4d] from-[#cd0a0a33] to-[#cd0a0a13] dark:to-[#cd0a0a34] w-full min-w-75 sm:min-w-90 relative p-0.5`}
    >
      <div className={`rounded-[18px] bg-[linear-gradient(90deg,#FFCED2_0%,#FFF6F6_50%)] dark:bg-[linear-gradient(90deg,#3F0E10_0%,#190A0D_100%)] w-full px-4 py-3 shadow-[0_8px_36px_0_rgba(0,0,0,0.10)] dark:shadow-[-10px_0_30px_0_rgba(176,15,15,0.3),_0_20px_40px_0_rgba(0,0,0,0.4)] flex gap-3 ${
        title && description ? "items-start" : "items-center"
      }`}>
        {/* main content */}
      <span className="shrink-0 text-xl w-11 h-11 rounded-full flex items-center justify-center bg-[linear-gradient(180deg,var(--Error-600,rgba(233,53,68,0.90))_0%,var(--Error-900,rgba(139,24,34,0.90))_100%)] shadow-[0_4px_16px_rgba(0,0,0,0.16),inset_0_0_4px_rgba(255,255,255,0.25)] dark:bg-[linear-gradient(180deg,rgba(205,10,10,0.9)_0%,rgba(167,11,11,0.9)_100%)] dark:shadow-[0_4px_24px_0_rgba(0,0,0,0.24),inset_0_0_4px_0_rgba(255,255,255,0.25)] relative z-2">
        {icon ? icon : <WarningIconSvg />}
      </span>
      <div className="relative z-2">
        {title && (
          <h6 className={`text-label-16-medium dark:text-white text-content-error-strong`}>
            {title}
          </h6>
        )}
        {description && (
          <p className={`mt-1 text-sm text-content-error-light dark:text-content-default`}>{description}</p>
        )}
        {children}
      </div>
      </div>
      <AlertCloseButton id={id!} />
    </div>
  );
};

export default AlertError;
