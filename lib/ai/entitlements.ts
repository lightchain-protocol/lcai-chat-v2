import type { UserType } from "@/app/(auth)/auth";
import type { ChatModel } from "./models";

type Entitlements = {
  maxMessagesPerDay: number;
  availableChatModelIds: ChatModel["id"][];
  maxTokens: number;
};

export const entitlementsByUserType: Record<UserType, Entitlements> = {
  /*
   * For users with a connected wallet
   */
  regular: {
    maxMessagesPerDay: 100,
    availableChatModelIds: ["chat-model"],
    maxTokens: 4096,
  },

  /*
   * TODO: For users with an account and a paid membership
   */
};
