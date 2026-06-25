"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { memo } from "react";
import type { ChatMessage } from "@/lib/types";
import { Suggestion } from "./elements/suggestion";
import type { VisibilityType } from "./visibility-selector";
import { MessageCirclePlus } from "lucide-react";

type SuggestedActionsProps = {
  chatId: string;
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  selectedVisibilityType: VisibilityType;
  /** Pre-send guard; returns false to block the send (see MultimodalInput). */
  onBeforeSubmit?: () => boolean;
};

function PureSuggestedActions({
  chatId,
  sendMessage,
  onBeforeSubmit,
}: SuggestedActionsProps) {
  const suggestedActions = [
    "What is Lightchain AI?",
    "What are the advantages of using Next.js?",
    "Write code to demonstrate bitcoin's algorithm",
    "Help me write an essay about Blockchain",
  ];

  return (
    <div>
      <h6 className="text-content-default font-medium text-sm">Quick prompts</h6>
      <div
        className="mt-4 grid w-full sm:gap-3 gap-1.5 grid-cols-2 sm:grid-cols-3 md:grid-cols-2 xl:grid-cols-3"
        data-testid="suggested-actions"
      >
        {suggestedActions.map((suggestedAction, index) => (
          <Suggestion key={index}
              className="p-px group h-full border-0 rounded-[10px] bg-transparent hover:bg-gradient-to-r hover:from-[#7064E9] hover:to-[#DD00AC]"
              onClick={(suggestion) => {
                if (onBeforeSubmit && !onBeforeSubmit()) {
                  return;
                }
                window.history.replaceState({}, "", `/chat/${chatId}`);
                sendMessage({
                  role: "user",
                  parts: [{ type: "text", text: suggestion }],
                });
              }}
              suggestion={suggestedAction}
            >
              <div className="sm:p-3 p-2 flex w-full items-baseline justify-start gap-1.5 sm:gap-2.5 border border-bdr-soft bg-surface-elevation-light shadow-[0_4px_8px_0_rgba(0,0,0,0.04)] whitespace-normal text-left h-full text-content-default text-xs sm:text-sm rounded-[9px] relative">
                <MessageCirclePlus className="hidden sm:block text-content-light translate-y-0.5 transition-opacity duration-200 group-hover:opacity-0" />
              <svg className="hidden sm:block absolute left-3 top-3.5 transition-opacity duration-200 opacity-0 group-hover:opacity-100" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <g clipPath="url(#clip0_40000707_2443)">
                  <path d="M3.73926 2.03223C5.1454 1.02803 6.86151 0.552245 8.58398 0.689453C10.3066 0.826758 11.9259 1.56788 13.1553 2.78223C14.3847 3.99672 15.1453 5.60727 15.3037 7.32812C15.462 9.04896 15.0077 10.7711 14.0205 12.1895C13.0332 13.6078 11.5759 14.6318 9.90723 15.0811C8.25038 15.5269 6.4902 15.377 4.93262 14.6592C4.82452 14.6204 4.70787 14.6105 4.59473 14.6299L2.35938 15.2842C2.35438 15.2856 2.34879 15.2868 2.34375 15.2881C2.12446 15.3463 1.89375 15.3478 1.67383 15.292C1.45371 15.2361 1.25101 15.1247 1.08594 14.9688C0.920919 14.8128 0.798745 14.6169 0.730469 14.4004C0.662349 14.184 0.649678 13.9536 0.695312 13.7314L0.714844 13.6602L1.40918 11.5137C1.43367 11.3885 1.42306 11.2584 1.37598 11.1396H1.375C0.642409 9.59346 0.472808 7.83914 0.897461 6.18066C1.32627 4.50661 2.3331 3.03676 3.73926 2.03223ZM8.47852 2.01855C7.06912 1.90628 5.6642 2.29544 4.51367 3.11719C3.36321 3.93906 2.54031 5.14208 2.18945 6.51172C1.86069 7.79592 1.96684 9.15043 2.4873 10.3643L2.59668 10.6045L2.61621 10.6484C2.76314 11.0191 2.79557 11.426 2.70996 11.8154C2.70539 11.8362 2.69988 11.8577 2.69336 11.8779L2.00684 13.9971L4.26074 13.3389C4.27948 13.3334 4.29922 13.329 4.31836 13.3252C4.63986 13.2615 4.97171 13.278 5.28418 13.3721L5.41699 13.417L5.46289 13.4365C6.74389 14.0347 8.19533 14.1612 9.56055 13.7939C10.9257 13.4264 12.118 12.588 12.9258 11.4277C13.7334 10.2673 14.106 8.85811 13.9766 7.4502C13.847 6.04241 13.2244 4.72507 12.2188 3.73145C11.213 2.73789 9.8878 2.131 8.47852 2.01855ZM8.00098 4.66602C8.36892 4.66622 8.66785 4.96504 8.66797 5.33301V7.33301H10.668C11.036 7.33321 11.335 7.63194 11.335 8C11.3349 8.36805 11.036 8.66679 10.668 8.66699H8.66797V10.666C8.66797 11.0341 8.36899 11.3328 8.00098 11.333C7.63279 11.333 7.33398 11.0342 7.33398 10.666V8.66699H5.33496C4.96678 8.66699 4.66798 8.36818 4.66797 8C4.66797 7.63181 4.96677 7.33301 5.33496 7.33301H7.33398V5.33301C7.3341 4.96492 7.63286 4.66602 8.00098 4.66602Z" fill="url(#paint0_linear_40000707_2443)"/>
                </g>
                <defs>
                  <linearGradient id="paint0_linear_40000707_2443" x1="15.3341" y1="8.00025" x2="0.667969" y2="8.00025" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#7064E9"/>
                    <stop offset="1" stopColor="#DD00AC"/>
                  </linearGradient>
                  <clipPath id="clip0_40000707_2443">
                    <rect width="16" height="16" fill="white"/>
                  </clipPath>
                </defs>
              </svg>
              {suggestedAction}
              </div>
          </Suggestion>
        ))}
      </div>
    </div>
  );
}

export const SuggestedActions = memo(
  PureSuggestedActions,
  (prevProps, nextProps) => {
    if (prevProps.chatId !== nextProps.chatId) {
      return false;
    }
    if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType) {
      return false;
    }
    if (prevProps.onBeforeSubmit !== nextProps.onBeforeSubmit) {
      return false;
    }

    return true;
  }
);
