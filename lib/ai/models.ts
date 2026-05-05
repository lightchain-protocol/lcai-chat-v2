export const DEFAULT_CHAT_MODEL: string =
  "0xf4a414fa51803433e9197f32cda96d5cb2ac8269c481eb0262fe2dd11f428848";

export type ChatModel = {
  id: string;
  name: string;
  description: string;
  fee: number;
  maxOutputTokens: number;
};

export const chatModels: ChatModel[] = [
  {
    id: "0xf4a414fa51803433e9197f32cda96d5cb2ac8269c481eb0262fe2dd11f428848",
    name: "llama3-8b",
    fee: 0.02,
    maxOutputTokens: 2048,
    description:
      "Llama3-8b is a general-purpose AI model that can be used to answer questions and help with tasks served by Lightchain worker network.",
  },
];
