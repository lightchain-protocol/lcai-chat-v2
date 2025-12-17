import AlertCloseButton from "./AlertCloseButton";
import SuccessIconSvg from "./SuccessIconSvg";

type AlertInfoProps = {
  children?: React.ReactNode;
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  id?: string | number;
};
const AlertSuccess = ({
  children,
  title,
  description,
  icon,
  id
}: AlertInfoProps) => {
  return (
    <div className={`rounded-[20px] bg-gradient-to-r dark:from-[#07863573] from-[#07863530] to-[rgba(7,134,53,0.12)] dark:to-[rgba(7,134,53,0.16)] w-full min-w-75 sm:min-w-90 relative p-0.5`}
    >
      <div className={`rounded-[18px] bg-[linear-gradient(90deg,#D8FFEB_0%,#FBFFFD_32.98%)] shadow-[0_8px_36px_rgba(0,0,0,0.10)] w-full px-4 py-3 flex gap-3 dark:bg-[linear-gradient(90deg,#103B22_0%,#0A150E_80.95%)] dark:shadow-[-10px_0_30px_rgba(44,122,83,0.30),_0_20px_40px_rgba(0,0,0,0.40)] ${
        title && description ? "items-start" : "items-center"
      }`}>

      {/* main content */}
      <span className="shrink-0 text-xl w-11 h-11 rounded-full flex items-center justify-center bg-[linear-gradient(180deg,#2E8559_0%,rgba(36,83,60,0.8)_100%)] shadow-[0_4px_36px_rgba(0,0,0,0.48),inset_0_0_4px_rgba(255,255,255,0.25)] relative z-2">
          {icon ? icon : <SuccessIconSvg />}
      </span>
      <div className="relative z-2">
        {title && (
          <h6 className={`text-label-16-medium text-[#16643B] dark:text-white`}>
            {title}
          </h6>
        )}
        {description && <p className={`mt-1 text-sm text-[#1DAF61] dark:text-content-default`}>{description}</p>}
        {children}
      </div>
      <AlertCloseButton id={id!} />
    </div>
    </div>
  );
};

export default AlertSuccess;
