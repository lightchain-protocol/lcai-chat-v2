"use client";

import { formatDistanceToNow } from "date-fns";
import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { SearchResult } from "@/lib/db/queries";
import { cn } from "@/lib/utils";

type ChatSearchProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ChatSearch({ open, onOpenChange }: ChatSearchProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  // Perform search when debounced query changes
  useEffect(() => {
    const performSearch = async () => {
      if (!debouncedQuery || debouncedQuery.trim().length < 2) {
        setResults([]);
        return;
      }

      setIsSearching(true);
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(debouncedQuery)}&limit=20`
        );

        if (!response.ok) {
          throw new Error("Search failed");
        }

        const data = await response.json();
        setResults(data.results || []);
      } catch (error) {
        console.error("Search error:", error);
        toast.error("Failed to search messages");
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    };

    performSearch();
  }, [debouncedQuery]);

  const handleResultClick = useCallback(
    (chatId: string, messageId: string) => {
      onOpenChange(false);
      router.push(`/chat/${chatId}#${messageId}`);
      // Reset search state
      setQuery("");
      setResults([]);
    },
    [onOpenChange, router]
  );

  const handleClear = useCallback(() => {
    setQuery("");
    setResults([]);
  }, []);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>Search Messages</DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-4">
          <div className="relative">
            <Search className="-translate-y-1/2 absolute top-1/2 left-3 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              className="pr-10 pl-10"
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your messages..."
              type="text"
              value={query}
            />
            {query && (
              <Button
                className="-translate-y-1/2 absolute top-1/2 right-1 h-7 w-7"
                onClick={handleClear}
                size="icon"
                type="button"
                variant="ghost"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {isSearching && (
            <div className="flex items-center justify-center py-8">
              <div className="text-muted-foreground text-sm">Searching...</div>
            </div>
          )}

          {!isSearching && query && results.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <div className="text-muted-foreground text-sm">
                No results found for &quot;{query}&quot;
              </div>
            </div>
          )}

          {!isSearching && !query && (
            <div className="flex items-center justify-center py-8">
              <div className="text-muted-foreground text-sm">
                Type to search your messages
              </div>
            </div>
          )}

          {!isSearching && results.length > 0 && (
            <div className="space-y-2">
              {results.map((result) => (
                <button
                  className={cn(
                    "w-full rounded-lg border border-border p-4 text-left",
                    "hover:border-accent-foreground/20 hover:bg-accent",
                    "group cursor-pointer transition-colors"
                  )}
                  key={result.messageId}
                  onClick={() =>
                    handleResultClick(result.chatId, result.messageId)
                  }
                  type="button"
                >
                  <div className="mb-2 flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate font-medium text-sm">
                        {result.chatTitle}
                      </h4>
                      <p className="text-muted-foreground text-xs">
                        {formatDistanceToNow(
                          new Date(result.messageCreatedAt),
                          {
                            addSuffix: true,
                          }
                        )}
                      </p>
                    </div>
                    <div
                      className={cn(
                        "rounded px-2 py-1 font-medium text-xs",
                        result.messageRole === "user"
                          ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                          : "bg-purple-500/10 text-purple-600 dark:text-purple-400"
                      )}
                    >
                      {result.messageRole}
                    </div>
                  </div>
                  <div
                    className="line-clamp-2 text-foreground/80 text-sm"
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: PostgreSQL ts_headline only generates safe <b> tags for highlighting
                    dangerouslySetInnerHTML={{ __html: result.highlight }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
