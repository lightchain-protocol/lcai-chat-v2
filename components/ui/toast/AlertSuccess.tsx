import { BadgeCheck } from "lucide-react";
import Image from "next/image";

type AlertInfoProps = {
  children?: React.ReactNode;
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};
const AlertSuccess = ({
  children,
  title,
  description,
  icon,
}: AlertInfoProps) => {
  return (
    <div
      className={`rounded-[20px] border-2 border-[rgba(14,27,17,0.06)] dark:border-[#031e0d] bg-background shadow-shadow-toast backdrop-blur-[60px] p-3.5 flex gap-3 w-full relative ${title && description ? "items-start" : "items-center"
      }`}
    >
      {/* background shadow */}
      <div className="absolute -top-[30px] -left-[30px] w-[calc(100%+20px)] h-[calc(100%+20px)] bg-[linear-gradient(90deg,#1A8F46_0%,#12431D_64.15%)] blur-[62px] opacity-30 z-[-1]"></div>
      <div className="absolute -top-0.5 -left-0.5 w-[calc(100%+4px)] h-[calc(100%+4px)] bg-[linear-gradient(91deg,#ABF0CC_2.15%,#EFFFF7_25.42%,#FBFFFD_98.16%)] dark:bg-[linear-gradient(90deg,rgba(40,249,126,0.2)_0%,rgba(15,_53,_23,_0.02)_45.6%)] rounded-[20px]"></div>
      {/* background image */}
      <Image
        className="absolute top-0 left-0 w-full h-full"
        src="/images/bg/info-alert-bg-1.png"
        width={422}
        height={75}
        alt="Background"
      ></Image>

      {/* main content */}
      <span className="shrink-0 text-xl w-11 h-11 rounded-full flex items-center justify-center bg-[linear-gradient(180deg,#2E8559_0%,rgba(36,83,60,0.8)_100%)] shadow-[0_4px_36px_rgba(0,0,0,0.48),inset_0_0_4px_rgba(255,255,255,0.25)] relative z-[2]">
        {icon ? icon : <BadgeCheck className="size-5 text-white" />}
      </span>
      <div className="relative z-2">
        {title && (
          <h6 className={`text-label-16-medium mb-1.5 text-[#16643B] dark:text-content-strong`}>
            {title}
          </h6>
        )}
        {description && <p className={`text-sm text-[#1DAF61] dark:text-content-default`}>{description}</p>}
        {children}
      </div>
    </div>
  );
};

export default AlertSuccess;
