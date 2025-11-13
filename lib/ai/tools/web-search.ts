import { tool } from "ai";
import { z } from "zod";

type SerperOrganicResult = {
  position: number;
  title: string;
  link: string;
  snippet?: string;
  date?: string;
};

type SerperResponse = {
  organic?: SerperOrganicResult[];
  answerBox?: {
    answer?: string;
    snippet?: string;
  };
  knowledgeGraph?: {
    title?: string;
    description?: string;
  };
};

export const webSearch = tool({
  description:
    "Search the web for up-to-date information using Google Search via Serper.dev API. Returns the top search results including titles, URLs, and descriptions.",
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .max(200)
      .describe("The search query to look up on the web"),
    maxResults: z
      .number()
      .min(1)
      .max(10)
      .optional()
      .default(5)
      .describe("Maximum number of search results to return (1-10)"),
  }),
  execute: async ({ query, maxResults = 5 }) => {
    const apiKey = process.env.SERPER_API_KEY;

    if (!apiKey) {
      return {
        success: false,
        message: "SERPER_API_KEY environment variable is not set",
        results: [],
      };
    }

    try {
      const response = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          q: query,
          num: maxResults,
        }),
      });

      if (!response.ok) {
        return {
          success: false,
          message: `Serper API error: ${response.status} ${response.statusText}`,
          results: [],
        };
      }

      const data = (await response.json()) as SerperResponse;

      if (!data.organic || data.organic.length === 0) {
        return {
          success: false,
          message: `No results found for query: "${query}"`,
          results: [],
        };
      }

      // Format the organic results
      const formattedResults = data.organic
        .slice(0, maxResults)
        .map((result) => ({
          position: result.position,
          title: result.title,
          url: result.link,
          description: result.snippet || "No description available",
          date: result.date,
        }));

      return {
        success: true,
        query,
        totalResults: formattedResults.length,
        results: formattedResults,
        answerBox: data.answerBox,
        knowledgeGraph: data.knowledgeGraph,
      };
    } catch (error) {
      return {
        success: false,
        message: `Error performing search: ${error instanceof Error ? error.message : "Unknown error"}`,
        results: [],
      };
    }
  },
});
