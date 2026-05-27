export const DEFAULT_CHAT_MODEL: string = "llama3-8b";

export type ChatModel = {
  id: string;
  name: string;
  description: string;
  fee: number;
  maxOutputTokens: number;
};

export const chatModels: ChatModel[] = [
  {
    id: "llama3-8b",
    name: "llama3-8b",
    fee: 0.02,
    maxOutputTokens: 2048,
    description:
      "Llama3-8b is a general-purpose AI model that can be used to answer questions and help with tasks served by Lightchain worker network.",
  },
];
