import { Info } from "lucide-react";
import Image from "next/image";
import React from "react";

type AlertInfoProps = {
  children?: React.ReactNode;
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};
const AlertInfo = ({ children, title, description, icon }: AlertInfoProps) => {
  return (
    <div
      className={`rounded-[20px] border-2 border-[rgba(24,31,49,0.06)] dark:border-[#16133a] bg-background shadow-shadow-toast backdrop-blur-[60px] p-3.5 flex gap-3 w-full relative ${
        title && description ? "items-start" : "items-center"
      }`}
    >
      {/* background shadow */}
      <div className="absolute -top-[30px] -left-[30px] w-[calc(100%+20px)] h-[calc(100%+20px)] bg-[linear-gradient(90deg,#9A85F1_0%,#FFF_64.15%)] dark:bg-[linear-gradient(90deg,#6660D1_0%,#27215A_64.15%)] blur-[62px] opacity-30 z-[-1]"></div>
      <div className="absolute -top-0.5 -left-0.5 w-[calc(100%+4px)] h-[calc(100%+4px)] bg-[linear-gradient(91deg,#C7BCFF_2.15%,#DBD4FF_18.88%,#FEFDFF_98.16%)] dark:bg-[linear-gradient(90deg,rgba(129,117,248,0.2)_0%,rgba(20,17,44,0.02)_45.6%)] rounded-[20px]"></div>
      {/* background image */}
      <Image
        className="absolute top-0 left-0 w-full h-full"
        src="/images/bg/info-alert-bg-1.png"
        width={422}
        height={75}
        alt="Background"
      ></Image>

      {/* main content */}
      <span className="shrink-0 text-xl w-11 h-11 rounded-full flex items-center justify-center bg-[linear-gradient(180deg,rgba(112,100,233,0.9)_0%,rgba(91,79,204,0.9)_100%)] shadow-[0_4px_24px_0_rgba(0,0,0,0.24),inset_0_0_4px_0_rgba(255,255,255,0.25)] relative z-[2]">
        {icon ? icon : <Info className="size-5 text-white" />}
      </span>
      <div className="relative z-2">
        {title && (
          <h6 className={`text-label-16-medium mb-1.5 text-[#3D1D86] dark:text-content-strong`}>
            {title}
          </h6>
        )}
        {description && (
          <p className={`text-sm text-[#693EE0] dark:text-content-default`}>{description}</p>
        )}
        {children}
      </div>
    </div>
  );
};

export default AlertInfo;
