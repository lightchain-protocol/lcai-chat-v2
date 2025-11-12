import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { customProvider } from "ai";
import { isTestEnvironment } from "../constants";

const vllmModel = createOpenAICompatible({
  name: "custom-vllm",
  // biome-ignore lint: Forbidden non-null assertion.
  baseURL: process.env.AI_PROVIDER_BASE_URL!,
  apiKey: "",
});

export const myProvider = isTestEnvironment
  ? (() => {
      const {
        chatModel,
        reasoningModel,
        titleModel,
      } = require("./models.mock");
      return customProvider({
        languageModels: {
          "chat-model": chatModel,
          "chat-model-reasoning": reasoningModel,
          "title-model": titleModel,
        },
      });
    })()
  : customProvider({
      languageModels: {
        // biome-ignore lint: Forbidden non-null assertion.
        "chat-model": vllmModel(process.env.MODEL_NAME!),
        // biome-ignore lint: Forbidden non-null assertion.
        "title-model": vllmModel(process.env.MODEL_NAME!),
      },
    });
