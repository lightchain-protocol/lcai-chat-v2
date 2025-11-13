"use client";

import { ExternalLink } from "lucide-react";

type SearchResult = {
  position: number;
  title: string;
  url: string;
  description: string;
  date?: string;
};

type WebSearchOutput = {
  success: boolean;
  query?: string;
  totalResults?: number;
  results: SearchResult[];
  message?: string;
  answerBox?: {
    answer?: string;
    snippet?: string;
  };
  knowledgeGraph?: {
    title?: string;
    description?: string;
  };
};

export function WebSearchSources({
  searchResults,
}: {
  searchResults: WebSearchOutput;
}) {
  if (!searchResults.success || searchResults.results.length === 0) {
    return null;
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <ExternalLink className="size-4 text-muted-foreground" />
        <h3 className="font-medium text-foreground text-sm">
          Sources{" "}
          {searchResults.totalResults ? `(${searchResults.totalResults})` : ""}
        </h3>
      </div>

      <div className="flex flex-col gap-2">
        {searchResults.results.map((result) => (
          <a
            className="group flex items-start gap-3 rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/50 hover:bg-accent"
            href={result.url}
            key={result.position}
            rel="noopener noreferrer"
            target="_blank"
          >
            <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 font-mono text-primary text-xs">
              {result.position}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h4 className="line-clamp-1 font-medium text-foreground text-sm group-hover:text-primary">
                  {result.title}
                </h4>
                <ExternalLink className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </div>

              <p className="mt-1 line-clamp-2 text-muted-foreground text-xs">
                {result.description}
              </p>

              <div className="mt-1.5 flex items-center gap-2 text-muted-foreground text-xs">
                <span className="truncate">{new URL(result.url).hostname}</span>
                {result.date && (
                  <>
                    <span>•</span>
                    <span>{result.date}</span>
                  </>
                )}
              </div>
            </div>
          </a>
        ))}
      </div>

      {/* {searchResults.answerBox?.answer && (
        <div className="mt-3 rounded-lg border border-border bg-background p-3">
          <div className="mb-1 font-medium text-muted-foreground text-xs">
            Quick Answer
          </div>
          <p className="text-foreground text-sm">
            {searchResults.answerBox.answer}
          </p>
        </div>
      )} */}
    </div>
  );
}
