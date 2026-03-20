import { useState } from "react";
import * as api from "@/lib/tauri";
import type { SearchResult, ChatMessage } from "@/types";

interface UseQueryOptions {
  searchQuery:    string;
  setSearchQuery: (q: string) => void;
  chatQuery:      string;
  setChatQuery:   (q: string) => void;
  results:        SearchResult[];
  setResults:     (r: SearchResult[]) => void;
  chatHistory:    ChatMessage[];
  setChatHistory: (h: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
}

export function useQuery({
  searchQuery,
  setSearchQuery,
  chatQuery,
  setChatQuery,
  results,
  setResults,
  chatHistory,
  setChatHistory,
}: UseQueryOptions) {
  const [isLoading, setIsLoading] = useState(false);

  const search = async (topK: number) => {
    if (!searchQuery.trim()) return;
    setIsLoading(true);
    try {
      const r = await api.searchChunks(searchQuery, topK);
      setResults(r);
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async (text: string, topK: number) => {
    if (!text.trim()) return;
    setIsLoading(true);
    setChatQuery("");
    // Show the user message immediately — before any awaits.
    const userMsg: ChatMessage = { role: "user", content: text };
    const historyWithUser = [...chatHistory, userMsg];
    setChatHistory(historyWithUser);
    try {
      // 1. Retrieve relevant context first.
      const context = await api.searchChunks(text, topK);
      // 2. Call LLM with the updated history.
      const resp = await api.chatCompletion(historyWithUser, context, topK);
      // 3. Store reply + sources on the assistant message.
      const assistantMsg: ChatMessage = {
        role:    "assistant",
        content: resp.reply,
        sources: resp.sources,
        query:   text,
      };
      setChatHistory([...historyWithUser, assistantMsg]);
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? String(err);
      setChatHistory([...historyWithUser, { role: "assistant", content: `⚠ Error: ${msg}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  return { isLoading, search, sendMessage };
}
