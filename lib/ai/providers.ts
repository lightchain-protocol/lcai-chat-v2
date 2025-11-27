// import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { customProvider } from "ai";
import { createOllama } from "ollama-ai-provider-v2";
import { isTestEnvironment } from "../constants";

// const vllmModel = createOpenAICompatible({
//   name: "custom-vllm",
//   // biome-ignore lint: Forbidden non-null assertion.
//   baseURL: process.env.AI_PROVIDER_BASE_URL!,
//   apiKey: "",
// });

const ollama = createOllama({
  // optional settings, e.g.
  baseURL: "http://localhost:11434/api",
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
        "chat-model": ollama.languageModel("glm-4.6:cloud"), // vllmModel(process.env.MODEL_NAME!),
        "title-model": ollama.languageModel("tinyllama"), // vllmModel(process.env.MODEL_NAME!),
      },
    });
