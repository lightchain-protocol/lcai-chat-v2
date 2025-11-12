export const DEFAULT_CHAT_MODEL: string = "chat-model";

export type ChatModel = {
  id: string;
  name: string;
  description: string;
};

export const chatModels: ChatModel[] = [
  {
    id: "chat-model",
    name: "Lightchain AI",
    description:
      "Lightchain AI is a general-purpose AI model that can be used to answer questions and help with tasks.",
  },
];
