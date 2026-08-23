/**
 * Decides whether a prompt should be answered with web results.
 *
 * Search is not free of consequence even when it costs nothing: it adds a
 * round trip before the prompt is encrypted, and it pushes several hundred
 * tokens of context in front of the question, which crowds a small model's
 * budget and drags irrelevant sources into the answer. So the default is to
 * search only when the answer plausibly depends on something the weights
 * cannot contain — a price, a release, an event, anything dated.
 *
 * This is a heuristic over the prompt text, deliberately biased towards not
 * searching. A missed search costs the user one toggle; a spurious one
 * degrades an answer that would otherwise have been fine.
 */

/** How the web-search control is set. `auto` defers to the heuristic. */
export type WebSearchMode = "auto" | "on" | "off";

export const DEFAULT_WEB_SEARCH_MODE: WebSearchMode = "auto";

export function isWebSearchMode(value: unknown): value is WebSearchMode {
  return value === "auto" || value === "on" || value === "off";
}

/**
 * Questions about the assistant itself. These read as live questions ("how
 * quick", "what can you do") but no amount of searching answers them, and
 * the results are invariably about some other product.
 */
const SELF_REFERENTIAL = [
  /\bthis (model|ai|assistant|bot|chat|app|site)\b/,
  /\byour (model|training|weights|context|knowledge|system prompt)\b/,
  /\bwho are you\b/,
  /\bwhat (are|can) you\b/,
  /\bhow (fast|quick|quickly|long) (do|does|are|is) (you|this)\b/,
  /\bare you (an? )?(ai|bot|human|llm)\b/,
];

/**
 * Work performed on text the user already supplied. The material is in the
 * prompt, so there is nothing to look up.
 */
const TRANSFORMATION = [
  /\b(translate|rewrite|reword|paraphrase|proofread|summari[sz]e|shorten|expand)\b/,
  /\b(fix|debug|refactor|optimi[sz]e|implement|write|generate) (this|the|a|an|my)\b.*\b(code|function|class|component|query|script|test|bug|error)\b/,
  /\bexplain (this|the following|my)\b/,
  /\bwhat does this (code|function|error|do)\b/,
];

/** Greetings and pleasantries. */
const SMALL_TALK =
  /^(hi|hey|hello|yo|sup|thanks|thank you|ty|ok|okay|cool|nice|good (morning|afternoon|evening|night))\b[\s!.?]*$/;

/** Arithmetic with no prose around it. */
const BARE_MATH = /^[\d\s+\-*/^().=%,]+\??$/;

/**
 * Signals that the answer is time-sensitive. Each one is a case where the
 * model's training cut-off is the wrong source.
 */
const FRESH_INFORMATION = [
  // Explicitly current
  /\b(latest|newest|current|currently|recent|recently|today|tonight|yesterday|tomorrow|nowadays)\b/,
  /\b(this|last|next) (week|month|year|quarter)\b/,
  /\bup[- ]to[- ]date\b/,
  /\bas of (now|today)\b/,
  /\bright now\b/,
  /\bso far in\b/,

  // A concrete year. Anything the user names explicitly is worth checking,
  // and a year is the single strongest marker of a dated question.
  /\b20[2-9]\d\b/,

  // News and events
  /\b(news|headlines?|breaking|announced|announcement)\b/,
  /\b(who won|winner of|results? of|score|standings|fixtures?)\b/,
  /\b(election|earnings|verdict|ruling|outage|recall)\b/,

  // Markets and money
  /\b(price|prices|pricing|cost|costs|worth|valuation|market cap)\b/,
  /\b(stock|share price|ticker|exchange rate|interest rate|inflation)\b/,
  /\bhow much (is|are|does|do|did)\b/,

  // Weather
  /\b(weather|forecast|temperature|rainfall|snowfall) (in|at|for|today|tomorrow)\b/,

  // Releases and versions
  /\b(release date|released|launch date|launching|out yet|available yet)\b/,
  /\b(version|changelog) of\b/,
  /\bwhat'?s new in\b/,

  // Incumbency and status, which change without notice
  /\bwho is the (current|new)\b/,
  /\bwho is the (president|prime minister|ceo|chairman|manager|captain)\b/,
  /\b(is|are) .{1,40}\b(down|offline|open|closed|still (up|running|alive))\b/,

  // The user asking for a lookup outright
  /\b(search|look ?up|google|check online|on the web|browse)\b/,
];

function matchesAny(patterns: RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * True when the prompt should be augmented with web results.
 *
 * Declines are evaluated first: a prompt can carry a fresh-information word
 * and still be unanswerable by search ("rewrite this to sound current"), and
 * in that conflict the decline is the safer reading.
 */
export function needsFreshInformation(prompt: string): boolean {
  const text = prompt.trim().toLowerCase();

  if (text.length === 0) {
    return false;
  }
  if (SMALL_TALK.test(text) || BARE_MATH.test(text)) {
    return false;
  }
  // A fenced block is the user pasting material for the model to work on.
  if (text.includes("```")) {
    return false;
  }
  if (matchesAny(SELF_REFERENTIAL, text) || matchesAny(TRANSFORMATION, text)) {
    return false;
  }

  return matchesAny(FRESH_INFORMATION, text);
}

/** Resolves the control setting and the prompt into a single decision. */
export function shouldSearch(mode: WebSearchMode, prompt: string): boolean {
  if (mode === "on") {
    return true;
  }
  if (mode === "off") {
    return false;
  }
  return needsFreshInformation(prompt);
}
