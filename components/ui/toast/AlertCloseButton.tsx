import { X } from "lucide-react";
import { toast } from "sonner";

type Props = {
    id: string | number;
}

const AlertCloseButton = ({id}:Props) => {
  return (
    <button
      onClick={() => toast.dismiss(id)}
      className="size-6.5 flex items-center justify-center rounded-full border border-bdr-light bg-[#f0f0f0] dark:bg-[#16161f] backdrop-blur-lg shadow-[0_4px_6px_0_rgba(0,0,0,0.08)] text-content-soft absolute -top-2.5 -right-2.5 hover:bg-surface-base-error-default hover:text-white transition-colors cursor-pointer z-10"
    >
      <X size={14} />
    </button>
  )
}

export default AlertCloseButton