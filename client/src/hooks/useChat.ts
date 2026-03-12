import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getAuthHeaders } from "@/lib/auth";
import type { Conversation, Message } from "@shared/schema";

// Conversation with messages included
export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

export function useConversations() {
  return useQuery<Conversation[]>({
    queryKey: ["/api/chat/conversations"],
  });
}

export function useConversation(id: string | null) {
  return useQuery<ConversationWithMessages>({
    queryKey: ["/api/chat/conversations", id],
    queryFn: async () => {
      const res = await fetch(`/api/chat/conversations/${id}`, {
        headers: { ...getAuthHeaders() },
        credentials: "include",
      });
      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(`${res.status}: ${text}`);
      }
      return res.json();
    },
    enabled: !!id,
  });
}

export function useCreateConversation() {
  return useMutation({
    mutationFn: async (data: { title?: string; model?: string } | void) => {
      const res = await apiRequest("POST", "/api/chat/conversations", data || {});
      return res.json() as Promise<Conversation>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
    },
  });
}

export function useUpdateConversation() {
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { title?: string; model?: string } }) => {
      const res = await apiRequest("PUT", `/api/chat/conversations/${id}`, data);
      return res.json() as Promise<Conversation>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
    },
  });
}

export function useDeleteConversation() {
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/chat/conversations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
    },
  });
}

export function useSendMessage(conversationId: string | null) {
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  const send = useCallback(
    async (content: string) => {
      if (!conversationId) return;

      setIsStreaming(true);
      setStreamingText("");

      try {
        const response = await fetch(
          `/api/chat/conversations/${conversationId}/messages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getAuthHeaders() },
            body: JSON.stringify({ content }),
            credentials: "include",
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          // Parse SSE events
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === "text" || data.type === "chat_text") {
                  accumulated += data.text;
                  setStreamingText(accumulated);
                } else if (data.type === "done") {
                  // Stream complete, invalidate queries to refresh data
                  queryClient.invalidateQueries({
                    queryKey: ["/api/chat/conversations", conversationId],
                  });
                  queryClient.invalidateQueries({
                    queryKey: ["/api/chat/conversations"],
                  });
                } else if (data.type === "error") {
                  console.error("Stream error:", data.error);
                }
              } catch {
                // Ignore malformed SSE lines
              }
            }
          }
        }
      } catch (error) {
        console.error("Send message error:", error);
      } finally {
        setIsStreaming(false);
        setStreamingText("");
      }
    },
    [conversationId]
  );

  return { send, streamingText, isStreaming };
}
