import { randomUUID } from "crypto";
import { sqlite } from "./db";

type WarningLevel = "ok" | "caution" | "critical";

const insertToolCall = sqlite.prepare(
  `INSERT INTO analytics_tool_calls (
     id,
     conversation_id,
     user_id,
     project_id,
     tool_name,
     document_id,
     escalation_round,
     turn_number,
     result_size_chars,
     success,
     metadata,
     timestamp
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

const insertContextSnapshot = sqlite.prepare(
  `INSERT INTO analytics_context_snapshots (
     id,
     conversation_id,
     turn_number,
     escalation_round,
     estimated_tokens,
     warning_level,
     trigger,
     metadata,
     timestamp
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

function toMetadataJson(metadata?: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  try {
    return JSON.stringify(metadata);
  } catch {
    return null;
  }
}

export interface ToolCallEvent {
  conversationId: string;
  userId: string;
  projectId: string | null;
  toolName: string;
  documentId: string | null;
  escalationRound: number;
  turnNumber: number;
  resultSizeChars: number;
  success: boolean;
  timestamp: number;
  metadata?: Record<string, unknown> | null;
}

export interface ContextSnapshotEvent {
  conversationId: string;
  turnNumber: number;
  escalationRound: number;
  estimatedTokens: number;
  warningLevel: WarningLevel;
  trigger: string | null;
  timestamp: number;
  metadata?: Record<string, unknown> | null;
}

export function logToolCall(event: ToolCallEvent): Promise<void> {
  return Promise.resolve().then(() => {
    insertToolCall.run(
      randomUUID(),
      event.conversationId,
      event.userId,
      event.projectId,
      event.toolName,
      event.documentId,
      event.escalationRound,
      event.turnNumber,
      event.resultSizeChars,
      event.success ? 1 : 0,
      toMetadataJson(event.metadata),
      event.timestamp
    );
  }).catch((err) => {
    console.warn("[analytics] logToolCall failed:", err);
  });
}

export function logContextSnapshot(event: ContextSnapshotEvent): Promise<void> {
  return Promise.resolve().then(() => {
    insertContextSnapshot.run(
      randomUUID(),
      event.conversationId,
      event.turnNumber,
      event.escalationRound,
      event.estimatedTokens,
      event.warningLevel,
      event.trigger,
      toMetadataJson(event.metadata),
      event.timestamp
    );
  }).catch((err) => {
    console.warn("[analytics] logContextSnapshot failed:", err);
  });
}

export function initAnalytics(): void {
  try {
    sqlite.prepare("SELECT COUNT(*) FROM analytics_tool_calls").get();
    sqlite.prepare("SELECT COUNT(*) FROM analytics_context_snapshots").get();
    console.log("[analytics] tables verified OK");
  } catch (err) {
    console.error("[analytics] CRITICAL: analytics tables missing or broken:", err);
  }
}
