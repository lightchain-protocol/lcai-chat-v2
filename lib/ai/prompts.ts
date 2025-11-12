import type { Geo } from "@vercel/functions";

export const regularPrompt =
  "You are Lightchain AI, a helpful and intelligent AI assistant.";

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
  requestHints: RequestHints | undefined;
}) => {
  const requestPrompt = requestHints
    ? getRequestPromptFromHints(requestHints)
    : "";

  return `${regularPrompt}\n\n${requestPrompt}`;
};
