/**
 * "Auto" model routing — a client-side heuristic picker.
 *
 * The rules are deliberately transparent and small: every routing decision
 * is shown to the user as "auto → {model} · {reason}", so the heuristic can
 * never silently spend a bigger fee than expected. Ordered strongest signal
 * first: an attached image forces a vision model (anything else can't read
 * it), code-ish prompts go to the coder, very long prompts go to the
 * long-context model, and everything else takes the fastest warm model.
 *
 * The fee honesty rule: auto never picks a model above the mid fee tier, so
 * a misrouted prompt costs the same as a deliberate mid-tier pick.
 */

export const AUTO_MODEL_ID = "auto";

export type AutoRoute = {
  modelId: string;
  reason: string;
  /**
   * Set when the Max tier was armed and the routed model has a Max variant —
   * the job actually runs as `{modelId}-max`. The reveal line shows it as
   * "· max" so the higher fee is never a surprise.
   */
  tier?: "max";
};

const VISION_MODEL_ID = "qwen3-vl-8b";
const CODER_MODEL_ID = "qwen3-coder-30b";
const LONG_CONTEXT_MODEL_ID = "qwen3.8-27b";
const FAST_WARM_MODEL_ID = "llama3-8b";

/** Past this many chars, reading-comprehension matters more than latency. */
const LONG_PROMPT_CHARS = 3000;

// Strong code signals: unambiguous artifacts, never prose.
const CODE_FENCE = /```/;
const STACK_TRACE =
  /(Traceback \(most recent call last\)|at [\w.]+\([\w./-]+:\d+:\d+\)|\w+Error:)/;
const FILE_PATH =
  /\b[\w./-]+\.(ts|tsx|js|jsx|py|rs|go|sol|java|cpp|c|h|css|sql|json|ya?ml|toml)\b/;
// Weaker topical signals: code words in natural language.
const CODE_KEYWORDS =
  /\b(code|coding|function|refactor|debug|stack ?trace|compil\w+|typescript|javascript|python|rust|solidity|regex|sql|unit tests?|lint\w*|snippet|algorithm|api endpoint)\b/i;

export function routePrompt(input: {
  prompt: string;
  hasImage: boolean;
}): AutoRoute {
  if (input.hasImage) {
    return { modelId: VISION_MODEL_ID, reason: "image attached" };
  }
  const prompt = input.prompt;
  if (
    CODE_FENCE.test(prompt) ||
    STACK_TRACE.test(prompt) ||
    FILE_PATH.test(prompt) ||
    CODE_KEYWORDS.test(prompt)
  ) {
    return { modelId: CODER_MODEL_ID, reason: "code detected" };
  }
  if (prompt.length >= LONG_PROMPT_CHARS) {
    return { modelId: LONG_CONTEXT_MODEL_ID, reason: "long prompt" };
  }
  return { modelId: FAST_WARM_MODEL_ID, reason: "fastest warm model" };
}
