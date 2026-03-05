import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";

export interface AnalyticsOverview {
  period: { from: number; to: number };
  toolCallFrequency: Array<{
    toolName: string;
    callCount: number;
    avgResultSize: number;
    failureCount: number;
  }>;
  tokenUsageByTurn: Array<{
    turnNumber: number;
    avgTokens: number;
    minTokens: number;
    maxTokens: number;
    sampleCount: number;
  }>;
  warningLevelBreakdown: Array<{
    warningLevel: string;
    hitCount: number;
  }>;
  topRequestedSources: Array<{
    documentId: string;
    toolName: string;
    pullCount: number;
  }>;
  totals: {
    toolCalls: number;
    contextSnapshots: number;
    uniqueConversations: number;
  };
}

export interface ConversationSummary {
  conversationId: string;
  userId: string;
  projectId: string | null;
  title: string | null;
  firstActivity: number;
  lastActivity: number;
  toolCallCount: number;
  failureCount: number;
  maxTurn: number;
  maxEscalation: number;
  peakTokens: number | null;
  hitCritical: boolean;
}

export interface TimelineEvent {
  type: "tool_call" | "context_snapshot";
  timestamp: number;
  conversationId: string;
  turnNumber: number;
  escalationRound: number;
  // tool_call fields
  userId?: string;
  projectId?: string | null;
  toolName?: string;
  documentId?: string | null;
  resultSizeChars?: number;
  success?: boolean;
  // context_snapshot fields
  estimatedTokens?: number;
  warningLevel?: string;
  trigger?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ConversationTimeline {
  conversationId: string;
  timeline: TimelineEvent[];
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { ...getAuthHeaders() },
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

export function useAnalyticsOverview(from: number, to: number) {
  return useQuery<AnalyticsOverview>({
    queryKey: ["analytics-overview", from, to],
    queryFn: () => fetchJson(`/api/admin/analytics/export?from=${from}&to=${to}`),
    refetchInterval: 30_000,
  });
}

export function useAnalyticsConversations(from: number, to: number, limit = 50, offset = 0) {
  return useQuery<{ conversations: ConversationSummary[]; total: number }>({
    queryKey: ["analytics-conversations", from, to, limit, offset],
    queryFn: () =>
      fetchJson(`/api/admin/analytics/conversations?from=${from}&to=${to}&limit=${limit}&offset=${offset}`),
    refetchInterval: 30_000,
  });
}

export function useConversationTimeline(conversationId: string | null) {
  return useQuery<ConversationTimeline>({
    queryKey: ["analytics-conversation", conversationId],
    queryFn: () => fetchJson(`/api/admin/analytics/conversation/${conversationId}`),
    enabled: !!conversationId,
  });
}
