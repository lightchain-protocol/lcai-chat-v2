/**
 * Web Search Integration using Google Serper API
 * Mirrors the search implementation from chat-api-service
 */

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  isAnswerBox: boolean;
};

export type WebSearchResult = {
  success: boolean;
  context: string;
  sources: string[];
  urls: string[];
  method: string;
  error?: string;
};

/**
 * Perform a web search using the Serper API
 */
export async function performWebSearch(
  query: string,
  maxResults = 5
): Promise<WebSearchResult> {
  const apiKey = process.env.SERPER_API_KEY;

  if (!apiKey) {
    console.warn("SERPER_API_KEY not configured - web search disabled");
    return {
      success: false,
      context: "",
      sources: [],
      urls: [],
      method: "disabled",
      error: "Search service not configured (SERPER_API_KEY missing)",
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
        context: "",
        sources: [],
        urls: [],
        method: "error",
        error: `Serper API error: ${response.status}`,
      };
    }

    const searchResults = await response.json();

    if (!searchResults) {
      return {
        success: false,
        context: "",
        sources: [],
        urls: [],
        method: "no_results",
        error: "No search results found",
      };
    }

    const results: SearchResult[] = [];

    // Check for Answer Box
    const answerBox = searchResults.answerBox;
    if (answerBox?.answer) {
      results.push({
        title: answerBox.title || "Direct Answer",
        url: "",
        snippet: `Answer: ${answerBox.answer}`,
        isAnswerBox: true,
      });
    }

    // Get organic results
    const organic = searchResults.organic || [];
    for (const item of organic.slice(0, maxResults - results.length)) {
      results.push({
        title: item.title || "Result",
        url: item.link || "",
        snippet: (item.snippet || "").trim(),
        isAnswerBox: false,
      });
    }

    // Get news results if available
    const news = searchResults.news || [];
    if (news.length > 0 && results.length < maxResults) {
      for (const item of news.slice(0, maxResults - results.length)) {
        const date = item.date || "";
        let snippet = item.snippet || "";
        if (date && snippet) {
          snippet = `[${date}] ${snippet}`;
        }
        results.push({
          title: item.title || "News",
          url: item.link || "",
          snippet: snippet.trim(),
          isAnswerBox: false,
        });
      }
    }

    // Build context and metadata
    const contextParts: string[] = [];
    const sources: string[] = [];
    const urls: string[] = [];

    for (const result of results) {
      if (!result.isAnswerBox) {
        contextParts.push(
          `${result.title}\n${result.url}\n${result.snippet}`
        );
        sources.push(`${result.title} - ${result.url}`);
        urls.push(result.url);
      } else {
        contextParts.push(`Answer Box: ${result.snippet}`);
      }
    }

    const context = contextParts.join("\n\n");

    return {
      success: true,
      context,
      sources,
      urls,
      method: "google_serper",
    };
  } catch (error) {
    console.error("Web search failed:", error);
    return {
      success: false,
      context: "",
      sources: [],
      urls: [],
      method: "error",
      error: String(error),
    };
  }
}
