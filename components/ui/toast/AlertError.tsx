import React from "react";
import AlertCloseButton from "./AlertCloseButton";

type AlertInfoProps = {
  children?: React.ReactNode;
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  id?: string | number;
};
const AlertError = ({ children, title, description, icon, id }: AlertInfoProps) => {
  return (
    <div className={`rounded-[20px] bg-bdr-light dark:bg-gradient-to-r from-[#cd0a0a4d] to-[rgba(255,255,255,0.04)]
w-full min-w-75 sm:min-w-90 relative p-0.5`}
    >
      <div className={`rounded-[18px] bg-[linear-gradient(90deg,#FFCED2_0%,#FFF6F6_50%)] dark:bg-[linear-gradient(90deg,#3F0E10_0%,#190A0D_100%)] w-full px-4 py-3 shadow-[0_8px_36px_0_rgba(0,0,0,0.10)] dark:shadow-[-10px_0_30px_0_rgba(176,15,15,0.3),_0_20px_40px_0_rgba(0,0,0,0.4)] flex gap-3 ${
        title && description ? "items-start" : "items-center"
      }`}>
        {/* main content */}
      <span className="shrink-0 text-xl w-11 h-11 rounded-full flex items-center justify-center bg-[linear-gradient(180deg,rgba(205,10,10,0.9)_0%,rgba(167,11,11,0.9)_100%)] shadow-[0_4px_24px_0_rgba(0,0,0,0.24),inset_0_0_4px_0_rgba(255,255,255,0.25)] relative z-2">
        {icon ? icon : <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M11.9992 1.3999C12.5505 1.3999 13.0567 1.70365 13.3192 2.1874L21.4192 17.1874C21.6705 17.6524 21.6592 18.2149 21.3892 18.6687C21.1192 19.1224 20.628 19.3999 20.0992 19.3999H3.89921C3.37046 19.3999 2.87921 19.1224 2.60921 18.6687C2.33921 18.2149 2.32796 17.6524 2.57921 17.1874L10.6792 2.1874C10.9417 1.70365 11.448 1.3999 11.9992 1.3999ZM11.9992 14.5999C11.681 14.5999 11.3757 14.7263 11.1507 14.9514C10.9256 15.1764 10.7992 15.4816 10.7992 15.7999C10.7992 16.1182 10.9256 16.4234 11.1507 16.6484C11.3757 16.8735 11.681 16.9999 11.9992 16.9999C12.3175 16.9999 12.6227 16.8735 12.8477 16.6484C13.0728 16.4234 13.1992 16.1182 13.1992 15.7999C13.1992 15.4816 13.0728 15.1764 12.8477 14.9514C12.6227 14.7263 12.3175 14.5999 11.9992 14.5999ZM11.9992 7.3999C11.3167 7.3999 10.773 7.98115 10.8217 8.66365L11.0992 12.5637C11.133 13.0324 11.5267 13.3999 11.9955 13.3999C12.468 13.3999 12.858 13.0362 12.8917 12.5637L13.1692 8.66365C13.218 7.98115 12.678 7.3999 11.9917 7.3999H11.9992Z" fill="url(#paint0_linear_40000657_21604)"/>
        <defs>
          <linearGradient id="paint0_linear_40000657_21604" x1="11.9992" y1="1.3999" x2="11.9992" y2="19.3999" gradientUnits="userSpaceOnUse">
            <stop stopColor="white"/>
            <stop offset="1" stopColor="white" stopOpacity="0.8"/>
          </linearGradient>
        </defs>
      </svg>}
      </span>
      <div className="relative z-2">
        {title && (
          <h6 className={`text-label-16-medium dark:text-content-strong text-content-error-strong`}>
            {title}
          </h6>
        )}
        {description && (
          <p className={`mt-1.5 text-sm text-content-error-light dark:text-content-default`}>{description}</p>
        )}
        {children}
      </div>
      </div>
      <AlertCloseButton id={id!} />
    </div>
  );
};

export default AlertError;
