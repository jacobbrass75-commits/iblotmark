export interface CompactedMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface AnthropicLike {
  messages: {
    create: (...args: any[]) => Promise<{
      content: Array<{ type: string; text?: string }>;
    }>;
  };
}

const DEFAULT_COMPACTION_THRESHOLD = 6;

function extractText(response: { content?: Array<{ type: string; text?: string }> }): string {
  if (!Array.isArray(response.content)) return "";
  return response.content
    .filter((block): block is { type: string; text: string } => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function normalizeContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object" && "text" in block && typeof block.text === "string") {
          return block.text;
        }
        return "[structured content]";
      })
      .join("\n");
  }

  if (!content) return "";
  return JSON.stringify(content).slice(0, 500);
}

function stripToolResults(content: unknown): string {
  const normalized = normalizeContent(content);
  return normalized
    .replace(/<tool_result\b[^>]*>[\s\S]*?<\/tool_result>/gi, "[evidence gathered - see clipboard]")
    .replace(/<chunk_request\b[^>]*>[\s\S]*?<\/chunk_request>/gi, "")
    .replace(/<context_request\b[^>]*>[\s\S]*?<\/context_request>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function compactConversation(
  anthropic: AnthropicLike,
  messages: Array<{ role: string; content: unknown }>,
  existingSummary: string | null,
  compactedAtTurn: number,
  threshold: number = DEFAULT_COMPACTION_THRESHOLD,
): Promise<{ summary: string; compactedAtTurn: number } | null> {
  const userTurnCount = messages.filter((message) => message.role === "user").length;
  if (userTurnCount <= compactedAtTurn + threshold) {
    return null;
  }

  const endIndex = Math.max(messages.length - threshold * 2, 0);
  const startIndex = Math.min(compactedAtTurn * 2, endIndex);
  const turnsToSummarize = messages.slice(startIndex, endIndex);
  if (turnsToSummarize.length === 0) {
    return null;
  }

  const summaryInput = existingSummary
    ? `Previous summary:\n${existingSummary}\n\nNew turns to incorporate:\n`
    : "";

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system: `Summarize this conversation history for an academic writing assistant. Preserve:
- The thesis and argument structure being developed
- Key decisions made, including what to include, exclude, or emphasize
- Section structure of the paper so far
- Specific student instructions about tone, citation style, and formatting
Discard:
- Raw source material because it is stored separately in an evidence clipboard
- Discovery questions already answered
- Superseded drafts where only the latest version matters
- Tool call details
Be concise. Target 300-500 tokens. Write in past tense.`,
    messages: [
      {
        role: "user",
        content:
          summaryInput +
          turnsToSummarize
            .map((message) => `[${message.role}]: ${normalizeContent(message.content).slice(0, 2000) || "[empty]"}`)
            .join("\n\n"),
      },
    ],
  });

  const summaryText = extractText(response);
  if (!summaryText) {
    return null;
  }

  return {
    summary: existingSummary ? `${existingSummary}\n\n---\n\n${summaryText}` : summaryText,
    compactedAtTurn: userTurnCount - threshold,
  };
}

export function buildCompactedHistory(
  messages: Array<{ role: string; content: unknown }>,
  clipboardFormatted: string,
  compactionSummary: string | null,
  compactedAtTurn: number,
  recentTurnCount: number = 6,
): CompactedMessage[] {
  const result: CompactedMessage[] = [];

  if (clipboardFormatted && clipboardFormatted !== "[No evidence collected yet]") {
    result.push({
      role: "user",
      content: `[EVIDENCE CLIPBOARD - accumulated research]\n${clipboardFormatted}`,
    });
    result.push({
      role: "assistant",
      content: "I have the accumulated evidence clipboard. I'll reference it as needed.",
    });
  }

  if (compactionSummary) {
    result.push({
      role: "user",
      content: `[EARLIER CONVERSATION SUMMARY - turns 1 through ${compactedAtTurn}]\n${compactionSummary}`,
    });
    result.push({
      role: "assistant",
      content: "I understand the earlier conversation context and will continue from there.",
    });
  }

  const recentMessages = messages.slice(-Math.max(0, recentTurnCount * 2));
  for (const message of recentMessages) {
    if (message.role !== "user" && message.role !== "assistant" && message.role !== "system") {
      continue;
    }

    result.push({
      role: message.role,
      content: stripToolResults(message.content),
    });
  }

  return result;
}

export function getToolResponseLimit(sourceCount: number): number {
  if (sourceCount <= 5) return 5000;
  if (sourceCount <= 10) return 3000;
  if (sourceCount <= 20) return 1500;
  return 800;
}

export function truncateToolResult(result: string, limit: number): string {
  if (result.length <= limit) {
    return result;
  }

  return result.slice(0, Math.max(0, limit - 50)) + "\n\n[...truncated - use more specific queries for details]";
}
