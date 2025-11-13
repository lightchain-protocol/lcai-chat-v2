import type { Geo } from "@vercel/functions";

export const regularPrompt =
  "You are Lightchain AI, a helpful and intelligent AI assistant.";

export const webSearchPrompt = `
When you use web search:
- ALWAYS cite sources inline using [1], [2], etc. immediately after the relevant information
- Place citations at the END of sentences or clauses, not at the beginning
- Multiple citations can be combined: [1][2][3]
- Synthesize information from multiple sources naturally
- If sources conflict, acknowledge the discrepancy and cite each perspective
- Prefer recent, authoritative sources
- Be concise but comprehensive

Example format:
"The latest research shows significant improvements in AI capabilities. [1][2] However, some experts remain cautious about potential risks. [3] The technology is expected to advance rapidly over the next decade [4]."
`;

export const webSearchUseCases = `
Use web search when:
- Asked about current events or recent news
- Need factual information you're uncertain about
- Asked about real-time data (stock prices, weather beyond your tool, etc.)
- User explicitly asks you to search the web
`;

export type RequestHints = {
  latitude: Geo["latitude"];
  longitude: Geo["longitude"];
  city: Geo["city"];
  country: Geo["country"];
};

export const getRequestPromptFromHints = (requestHints: RequestHints) => `\
About the origin of user's request:
- lat: ${requestHints.latitude}
- lon: ${requestHints.longitude}
- city: ${requestHints.city}
- country: ${requestHints.country}
`;

export const systemPrompt = ({
  requestHints,
}: {
  requestHints?: RequestHints;
}) => {
  let prompt = regularPrompt;

  if (requestHints) prompt += `\n\n${getRequestPromptFromHints(requestHints)}`;

  return `${prompt}\n\n${webSearchPrompt}\n\n${webSearchUseCases}`;
};
