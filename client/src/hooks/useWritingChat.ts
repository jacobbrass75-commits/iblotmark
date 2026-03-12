import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getAuthHeaders } from "@/lib/auth";
import type { Conversation, Message } from "@shared/schema";

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

export interface ToolStep {
  id: string;
  toolName: string;
  sourceTitle?: string;
  status: "loading" | "done";
  startedAt: number;
}

// --- Conversation queries (project-scoped) ---

export function useProjectConversations(projectId?: string | null) {
  return useQuery<Conversation[]>({
    queryKey: ["/api/chat/conversations", { projectId }],
    queryFn: async () => {
      const res = await fetch(`/api/chat/conversations?projectId=${projectId}`, {
        headers: { ...getAuthHeaders() },
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: Boolean(projectId),
  });
}

export function useStandaloneConversations(enabled = true) {
  return useQuery<Conversation[]>({
    queryKey: ["/api/chat/conversations", { standalone: true }],
    queryFn: async () => {
      const res = await fetch("/api/chat/conversations?standalone=true", {
        headers: { ...getAuthHeaders() },
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled,
  });
}

export function useWritingConversation(id: string | null) {
  return useQuery<ConversationWithMessages>({
    queryKey: ["/api/chat/conversations", id],
    queryFn: async () => {
      const res = await fetch(`/api/chat/conversations/${id}`, {
        headers: { ...getAuthHeaders() },
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!id,
  });
}

export function useCreateWritingConversation() {
  return useMutation({
    mutationFn: async (data: {
      projectId?: string | null;
      selectedSourceIds?: string[];
      writingModel?: "precision" | "extended";
      citationStyle?: string;
      tone?: string;
      humanize?: boolean;
      noEnDashes?: boolean;
    }) => {
      const res = await apiRequest("POST", "/api/chat/conversations", {
        projectId: data.projectId ?? null,
        selectedSourceIds: data.selectedSourceIds || [],
        writingModel: data.writingModel ?? "precision",
        citationStyle: data.citationStyle ?? "chicago",
        tone: data.tone ?? "academic",
        humanize: data.humanize ?? true,
        noEnDashes: data.noEnDashes ?? false,
      });
      return res.json() as Promise<Conversation>;
    },
    onSuccess: (_, variables) => {
      if (variables.projectId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/chat/conversations", { projectId: variables.projectId }],
        });
      } else {
        queryClient.invalidateQueries({
          queryKey: ["/api/chat/conversations", { standalone: true }],
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
    },
  });
}

export function useUpdateWritingConversation() {
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, any> }) => {
      const res = await apiRequest("PUT", `/api/chat/conversations/${id}`, data);
      return res.json() as Promise<Conversation>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
    },
  });
}

export function useDeleteWritingConversation() {
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/chat/conversations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
    },
  });
}

// --- Source selection ---

export function useUpdateSources() {
  return useMutation({
    mutationFn: async ({ conversationId, selectedSourceIds }: { conversationId: string; selectedSourceIds: string[] }) => {
      const res = await apiRequest("PUT", `/api/chat/conversations/${conversationId}/sources`, { selectedSourceIds });
      return res.json() as Promise<Conversation>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations", data.id] });
    },
  });
}

// --- Send message (SSE streaming) ---

export function useWritingSendMessage(conversationId: string | null) {
  const [streamingText, setStreamingText] = useState("");
  const [streamingChatText, setStreamingChatText] = useState("");
  const [documentTitle, setDocumentTitle] = useState("");
  const [streamingDocumentText, setStreamingDocumentText] = useState("");
  const [isDocumentStreaming, setIsDocumentStreaming] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [contextLoading, setContextLoading] = useState<{ level: number; documentId?: string } | null>(null);
  const [contextWarning, setContextWarning] = useState<{ id: number; message: string; available?: number } | null>(null);

  const send = useCallback(
    async (content: string) => {
      if (!conversationId) return;

      setIsStreaming(true);
      setStreamingText("");
      setStreamingChatText("");
      setDocumentTitle("");
      setStreamingDocumentText("");
      setIsDocumentStreaming(false);
      setContextLoading(null);
      setContextWarning(null);

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
        let accumulatedChat = "";
        let accumulatedDocument = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === "text" || data.type === "chat_text") {
                  accumulatedChat += String(data.text || "");
                  setStreamingText(accumulatedChat);
                  setStreamingChatText(accumulatedChat);
                } else if (data.type === "document_start") {
                  accumulatedDocument = "";
                  setDocumentTitle(String(data.title || "Draft"));
                  setStreamingDocumentText("");
                  setIsDocumentStreaming(true);
                } else if (data.type === "document_text") {
                  accumulatedDocument += String(data.text || "");
                  setStreamingDocumentText(accumulatedDocument);
                } else if (data.type === "document_end") {
                  setIsDocumentStreaming(false);
                } else if (data.type === "context_loading") {
                  setContextLoading({
                    level: Number(data.level) || 2,
                    documentId: typeof data.documentId === "string" ? data.documentId : undefined,
                  });
                } else if (data.type === "context_loaded") {
                  setContextLoading(null);
                } else if (data.type === "context_warning") {
                  setContextWarning({
                    id: Date.now(),
                    message: String(data.message || "Context is getting large."),
                    available: typeof data.available === "number" ? data.available : undefined,
                  });
                } else if (data.type === "done") {
                  setContextLoading(null);
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
                // Ignore malformed SSE
              }
            }
          }
        }
      } catch (error) {
        console.error("Send message error:", error);
      } finally {
        setIsStreaming(false);
        setStreamingText("");
        setStreamingChatText("");
        setIsDocumentStreaming(false);
        setContextLoading(null);
      }
    },
    [conversationId]
  );

  return {
    send,
    streamingText,
    streamingChatText,
    documentTitle,
    streamingDocumentText,
    isDocumentStreaming,
    isStreaming,
    contextLoading,
    contextWarning,
  };
}

// --- Compile paper ---

export function useCompilePaper(conversationId: string | null) {
  const [compiledContent, setCompiledContent] = useState("");
  const [isCompiling, setIsCompiling] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const compile = useCallback(
    async (options?: { citationStyle?: string; tone?: string; noEnDashes?: boolean }) => {
      if (!conversationId) return;

      setIsCompiling(true);
      setCompiledContent("");

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch(
          `/api/chat/conversations/${conversationId}/compile`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getAuthHeaders() },
            body: JSON.stringify(options || {}),
            credentials: "include",
            signal: controller.signal,
          }
        );

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === "text") {
                  accumulated += data.text;
                  setCompiledContent(accumulated);
                } else if (data.type === "error") {
                  console.error("Compile error:", data.error);
                }
              } catch {
                // Ignore malformed SSE
              }
            }
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") {
          console.error("Compile error:", error);
        }
      } finally {
        setIsCompiling(false);
        abortRef.current = null;
      }
    },
    [conversationId]
  );

  const cancelCompile = useCallback(() => {
    abortRef.current?.abort();
    setIsCompiling(false);
  }, []);

  const clearCompiled = useCallback(() => {
    setCompiledContent("");
  }, []);

  return { compile, cancelCompile, clearCompiled, compiledContent, isCompiling };
}

// --- Verify paper ---

export function useVerifyPaper(conversationId: string | null) {
  const [verifyReport, setVerifyReport] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  const verify = useCallback(
    async (compiledContent: string) => {
      if (!conversationId || !compiledContent) return;

      setIsVerifying(true);
      setVerifyReport("");

      try {
        const response = await fetch(
          `/api/chat/conversations/${conversationId}/verify`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getAuthHeaders() },
            body: JSON.stringify({ compiledContent }),
            credentials: "include",
          }
        );

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === "text") {
                  accumulated += data.text;
                  setVerifyReport(accumulated);
                } else if (data.type === "error") {
                  console.error("Verify error:", data.error);
                }
              } catch {
                // Ignore
              }
            }
          }
        }
      } catch (error) {
        console.error("Verify error:", error);
      } finally {
        setIsVerifying(false);
      }
    },
    [conversationId]
  );

  return { verify, verifyReport, isVerifying };
}
