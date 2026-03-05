import type { Express, NextFunction, Request, Response } from "express";
import { requireAuth } from "./auth";
import { sqlite } from "./db";

const selectToolCallFrequency = sqlite.prepare(
  `SELECT
      tool_name,
      COUNT(*) AS call_count,
      AVG(result_size_chars) AS avg_result_size,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failure_count
   FROM analytics_tool_calls
   WHERE timestamp BETWEEN ? AND ?
   GROUP BY tool_name
   ORDER BY call_count DESC`
);

const selectTokenUsageByTurn = sqlite.prepare(
  `SELECT
      turn_number,
      AVG(estimated_tokens) AS avg_tokens,
      MIN(estimated_tokens) AS min_tokens,
      MAX(estimated_tokens) AS max_tokens,
      COUNT(*) AS sample_count
   FROM analytics_context_snapshots
   WHERE timestamp BETWEEN ? AND ?
   GROUP BY turn_number
   ORDER BY turn_number ASC`
);

const selectWarningLevelBreakdown = sqlite.prepare(
  `SELECT
      warning_level,
      COUNT(*) AS hit_count
   FROM analytics_context_snapshots
   WHERE timestamp BETWEEN ? AND ?
   GROUP BY warning_level`
);

const selectTopRequestedSources = sqlite.prepare(
  `SELECT
      document_id,
      tool_name,
      COUNT(*) AS pull_count
   FROM analytics_tool_calls
   WHERE timestamp BETWEEN ? AND ?
     AND document_id IS NOT NULL
   GROUP BY document_id, tool_name
   ORDER BY pull_count DESC
   LIMIT 50`
);

const selectToolCallTotal = sqlite.prepare(
  `SELECT COUNT(*) AS total
   FROM analytics_tool_calls
   WHERE timestamp BETWEEN ? AND ?`
);

const selectContextSnapshotTotal = sqlite.prepare(
  `SELECT COUNT(*) AS total
   FROM analytics_context_snapshots
   WHERE timestamp BETWEEN ? AND ?`
);

const selectUniqueConversations = sqlite.prepare(
  `SELECT COUNT(DISTINCT conversation_id) AS total
   FROM (
     SELECT conversation_id FROM analytics_tool_calls WHERE timestamp BETWEEN ? AND ?
     UNION ALL
     SELECT conversation_id FROM analytics_context_snapshots WHERE timestamp BETWEEN ? AND ?
   )`
);

const selectConversationsWithAnalytics = sqlite.prepare(
  `SELECT
      tc.conversation_id,
      tc.user_id,
      tc.project_id,
      MIN(tc.timestamp) AS first_activity,
      MAX(tc.timestamp) AS last_activity,
      COUNT(*) AS tool_call_count,
      SUM(CASE WHEN tc.success = 0 THEN 1 ELSE 0 END) AS failure_count,
      MAX(tc.turn_number) AS max_turn,
      MAX(tc.escalation_round) AS max_escalation
   FROM analytics_tool_calls tc
   WHERE tc.timestamp BETWEEN ? AND ?
   GROUP BY tc.conversation_id
   ORDER BY last_activity DESC
   LIMIT ? OFFSET ?`
);

const selectConversationsCount = sqlite.prepare(
  `SELECT COUNT(DISTINCT conversation_id) AS total
   FROM analytics_tool_calls
   WHERE timestamp BETWEEN ? AND ?`
);

const selectConversationPeakTokens = sqlite.prepare(
  `SELECT
      conversation_id,
      MAX(estimated_tokens) AS peak_tokens,
      MAX(CASE WHEN warning_level = 'critical' THEN 1 ELSE 0 END) AS hit_critical
   FROM analytics_context_snapshots
   GROUP BY conversation_id`
);

const selectConversationToolCalls = sqlite.prepare(
  `SELECT
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
   FROM analytics_tool_calls
   WHERE conversation_id = ?
   ORDER BY timestamp ASC`
);

const selectConversationContextSnapshots = sqlite.prepare(
  `SELECT
      conversation_id,
      turn_number,
      escalation_round,
      estimated_tokens,
      warning_level,
      trigger,
      metadata,
      timestamp
   FROM analytics_context_snapshots
   WHERE conversation_id = ?
   ORDER BY timestamp ASC`
);

function parseAdminUserIds(): string[] {
  return (process.env.ADMIN_USER_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const adminUserIds = parseAdminUserIds();
  const user = req.user;

  if (!user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  if (adminUserIds.length > 0) {
    if (!adminUserIds.includes(user.userId)) {
      res.status(403).json({ message: "Admin access required" });
      return;
    }
    next();
    return;
  }

  if (user.tier !== "max") {
    res.status(403).json({ message: "Admin access required" });
    return;
  }

  next();
}

function parseEpochMs(value: unknown, fallback: number): number {
  const raw =
    typeof value === "string"
      ? value
      : Array.isArray(value) && typeof value[0] === "string"
      ? value[0]
      : null;
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.floor(parsed);
}

interface CountRow {
  total: number;
}

interface ToolCallRow {
  conversation_id: string;
  user_id: string;
  project_id: string | null;
  tool_name: string;
  document_id: string | null;
  escalation_round: number;
  turn_number: number;
  result_size_chars: number;
  success: number;
  metadata: string | null;
  timestamp: number;
}

interface ContextSnapshotRow {
  conversation_id: string;
  turn_number: number;
  escalation_round: number;
  estimated_tokens: number;
  warning_level: string;
  trigger: string | null;
  metadata: string | null;
  timestamp: number;
}

function safeParseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseFormat(value: unknown): "json" | "csv" {
  const raw =
    typeof value === "string"
      ? value
      : Array.isArray(value) && typeof value[0] === "string"
      ? value[0]
      : "json";
  return raw.toLowerCase() === "csv" ? "csv" : "json";
}

export function registerAnalyticsRoutes(app: Express): void {
  app.get("/api/admin/analytics/export", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const now = Date.now();
      const from = parseEpochMs(req.query.from, now - 7 * 24 * 60 * 60 * 1000);
      const to = parseEpochMs(req.query.to, now);
      const format = parseFormat(req.query.format);

      if (from > to) {
        return res.status(400).json({ message: "`from` must be less than or equal to `to`" });
      }

      if (format === "csv") {
        return res.status(400).json({ message: "CSV export is not implemented. Use format=json." });
      }

      const toolCallFrequency = selectToolCallFrequency.all(from, to) as Array<{
        tool_name: string;
        call_count: number;
        avg_result_size: number | null;
        failure_count: number;
      }>;
      const tokenUsageByTurn = selectTokenUsageByTurn.all(from, to) as Array<{
        turn_number: number;
        avg_tokens: number;
        min_tokens: number;
        max_tokens: number;
        sample_count: number;
      }>;
      const warningLevelBreakdown = selectWarningLevelBreakdown.all(from, to) as Array<{
        warning_level: string;
        hit_count: number;
      }>;
      const topRequestedSources = selectTopRequestedSources.all(from, to) as Array<{
        document_id: string;
        tool_name: string;
        pull_count: number;
      }>;

      const toolCallsTotal = (selectToolCallTotal.get(from, to) as CountRow | undefined)?.total ?? 0;
      const contextSnapshotsTotal = (selectContextSnapshotTotal.get(from, to) as CountRow | undefined)?.total ?? 0;
      const uniqueConversations =
        (selectUniqueConversations.get(from, to, from, to) as CountRow | undefined)?.total ?? 0;

      return res.json({
        period: { from, to },
        toolCallFrequency: toolCallFrequency.map((row) => ({
          toolName: row.tool_name,
          callCount: row.call_count,
          avgResultSize: row.avg_result_size ? Number(row.avg_result_size) : 0,
          failureCount: row.failure_count,
        })),
        tokenUsageByTurn: tokenUsageByTurn.map((row) => ({
          turnNumber: row.turn_number,
          avgTokens: Number(row.avg_tokens),
          minTokens: row.min_tokens,
          maxTokens: row.max_tokens,
          sampleCount: row.sample_count,
        })),
        warningLevelBreakdown: warningLevelBreakdown.map((row) => ({
          warningLevel: row.warning_level,
          hitCount: row.hit_count,
        })),
        topRequestedSources: topRequestedSources.map((row) => ({
          documentId: row.document_id,
          toolName: row.tool_name,
          pullCount: row.pull_count,
        })),
        totals: {
          toolCalls: toolCallsTotal,
          contextSnapshots: contextSnapshotsTotal,
          uniqueConversations,
        },
      });
    } catch (error) {
      console.error("Analytics export error:", error);
      return res.status(500).json({ message: "Failed to export analytics" });
    }
  });

  app.get("/api/admin/analytics/conversation/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const conversationId = req.params.id;
      const toolCalls = selectConversationToolCalls.all(conversationId) as ToolCallRow[];
      const contextSnapshots = selectConversationContextSnapshots.all(conversationId) as ContextSnapshotRow[];

      const timeline = [
        ...toolCalls.map((row) => ({
          type: "tool_call" as const,
          timestamp: row.timestamp,
          conversationId: row.conversation_id,
          userId: row.user_id,
          projectId: row.project_id,
          toolName: row.tool_name,
          documentId: row.document_id,
          escalationRound: row.escalation_round,
          turnNumber: row.turn_number,
          resultSizeChars: row.result_size_chars,
          success: row.success === 1,
          metadata: safeParseMetadata(row.metadata),
        })),
        ...contextSnapshots.map((row) => ({
          type: "context_snapshot" as const,
          timestamp: row.timestamp,
          conversationId: row.conversation_id,
          turnNumber: row.turn_number,
          escalationRound: row.escalation_round,
          estimatedTokens: row.estimated_tokens,
          warningLevel: row.warning_level,
          trigger: row.trigger,
          metadata: safeParseMetadata(row.metadata),
        })),
      ].sort((a, b) => a.timestamp - b.timestamp);

      return res.json({
        conversationId,
        timeline,
      });
    } catch (error) {
      console.error("Conversation analytics error:", error);
      return res.status(500).json({ message: "Failed to fetch conversation analytics" });
    }
  });

  app.get("/api/admin/analytics/conversations", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const now = Date.now();
      const from = parseEpochMs(req.query.from, now - 7 * 24 * 60 * 60 * 1000);
      const to = parseEpochMs(req.query.to, now);
      const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 200);
      const offset = Math.max(0, Number(req.query.offset) || 0);

      const rows = selectConversationsWithAnalytics.all(from, to, limit, offset) as Array<{
        conversation_id: string;
        user_id: string;
        project_id: string | null;
        first_activity: number;
        last_activity: number;
        tool_call_count: number;
        failure_count: number;
        max_turn: number;
        max_escalation: number;
      }>;

      const totalRow = selectConversationsCount.get(from, to) as CountRow | undefined;
      const total = totalRow?.total ?? 0;

      // Get peak token data for these conversations
      const peakRows = selectConversationPeakTokens.all() as Array<{
        conversation_id: string;
        peak_tokens: number;
        hit_critical: number;
      }>;
      const peakMap = new Map(peakRows.map((r) => [r.conversation_id, r]));

      // Try to get conversation titles from the conversations table
      const convIds = rows.map((r) => r.conversation_id);
      let titleMap = new Map<string, string>();
      if (convIds.length > 0) {
        try {
          const placeholders = convIds.map(() => "?").join(",");
          const titleRows = sqlite
            .prepare(`SELECT id, title FROM conversations WHERE id IN (${placeholders})`)
            .all(...convIds) as Array<{ id: string; title: string | null }>;
          titleMap = new Map(titleRows.filter((r) => r.title).map((r) => [r.id, r.title!]));
        } catch {
          // conversations table may not have title column — skip
        }
      }

      const conversations = rows.map((row) => {
        const peak = peakMap.get(row.conversation_id);
        return {
          conversationId: row.conversation_id,
          userId: row.user_id,
          projectId: row.project_id,
          title: titleMap.get(row.conversation_id) ?? null,
          firstActivity: row.first_activity,
          lastActivity: row.last_activity,
          toolCallCount: row.tool_call_count,
          failureCount: row.failure_count,
          maxTurn: row.max_turn,
          maxEscalation: row.max_escalation,
          peakTokens: peak?.peak_tokens ?? null,
          hitCritical: peak?.hit_critical === 1,
        };
      });

      return res.json({ conversations, total, limit, offset });
    } catch (error) {
      console.error("Analytics conversations error:", error);
      return res.status(500).json({ message: "Failed to fetch conversations" });
    }
  });
}
