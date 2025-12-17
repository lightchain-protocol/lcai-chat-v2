import AlertCloseButton from "./AlertCloseButton";
import WarningIconSvg from "./WarningIconSvg";

type AlertInfoProps = {
  children?: React.ReactNode;
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  id?: string | number;
};
const AlertWarning = ({
  children,
  title,
  description,
  icon,
  id
}: AlertInfoProps) => {
  return (
    <div className={`rounded-[20px] bg-gradient-to-r dark:from-[#f5c10456] from-[#f5c10436] to-[#f5c10413] dark:to-[#f5c10421] w-full min-w-75 sm:min-w-90 relative p-0.5`}
    >
      <div className={`rounded-[18px] bg-[linear-gradient(90deg,#FFEFD3_0%,#FFFDF9_38.81%)] shadow-[0_8px_36px_rgba(0,0,0,0.10)] w-full px-4 py-3 flex gap-3 dark:bg-[linear-gradient(90deg,#463704_0%,#261D00_70.83%)] dark:shadow-[-10px_0_30px_rgba(152,120,0,0.30),_0_20px_40px_rgba(0,0,0,0.40)]
 ${
        title && description ? "items-start" : "items-center"
      }`}>

      {/* main content */}
      <span className="shrink-0 text-xl w-11 h-11 rounded-full flex items-center justify-center bg-[linear-gradient(180deg,#FDC700_0%,#977700_100%)] shadow-[0_4px_24px_rgba(0,0,0,0.24),inset_0_0_4px_rgba(255,255,255,0.25)] dark:bg-[linear-gradient(180deg,#FDC700_0%,#977700_100%)] dark:shadow-[0_4px_24px_0_rgba(0,0,0,0.24),inset_0_0_4px_0_rgba(255,255,255,0.25)] relative z-2">
        {icon ? icon : <WarningIconSvg />}
      </span>
      <div className="relative z-2">
        {title && (
          <h6 className={`text-label-16-medium text-[#7A2E0E] dark:text-white`}>
            {title}
          </h6>
        )}
        {description && <p className={`mt-1 text-sm text-[#DC6803] dark:text-content-default`}>{description}</p>}
        {children}
      </div>
      <AlertCloseButton id={id!} />
    </div>
    </div>
  );
};

export default AlertWarning;
