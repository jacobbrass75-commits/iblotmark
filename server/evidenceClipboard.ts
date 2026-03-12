export interface EvidenceItem {
  type: "direct_quote" | "paraphrase" | "data_point" | "finding";
  text: string;
  citedInTurn: number;
  location?: string;
}

export interface EvidenceClipboard {
  version: number;
  collectedAt: number;
  thesis: string;
  evidence: Array<{
    sourceId: string;
    sourceTitle: string;
    items: EvidenceItem[];
  }>;
  styleProfile?: {
    sentenceLength: string;
    vocabulary: string;
    tone: string;
    transitions: string[];
  };
  writingProgress: Array<{
    section: string;
    status: "drafted" | "revised" | "final";
    turnNumber: number;
  }>;
  tokenEstimate: number;
}

interface AnthropicLike {
  messages: {
    create: (...args: any[]) => Promise<{
      content: Array<{ type: string; text?: string }>;
    }>;
  };
}

const CLIPBOARD_VERSION = 1;
const STATUS_ORDER: Record<"drafted" | "revised" | "final", number> = {
  drafted: 1,
  revised: 2,
  final: 3,
};

function clampString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEvidenceText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordSet(text: string): Set<string> {
  return new Set(normalizeEvidenceText(text).split(" ").filter(Boolean));
}

function similarityScore(left: string, right: string): number {
  const normalizedLeft = normalizeEvidenceText(left);
  const normalizedRight = normalizeEvidenceText(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  if (
    normalizedLeft.length > 24 &&
    normalizedRight.length > 24 &&
    (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft))
  ) {
    return 0.95;
  }

  const leftWords = wordSet(left);
  const rightWords = wordSet(right);
  const intersection = Array.from(leftWords).filter((word) => rightWords.has(word)).length;
  const union = new Set([...Array.from(leftWords), ...Array.from(rightWords)]).size;
  return union === 0 ? 0 : intersection / union;
}

function isEvidenceItem(value: unknown): value is EvidenceItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<EvidenceItem>;
  return (
    (item.type === "direct_quote" ||
      item.type === "paraphrase" ||
      item.type === "data_point" ||
      item.type === "finding") &&
    typeof item.text === "string"
  );
}

function computeTokenEstimate(clipboard: EvidenceClipboard): number {
  const json = JSON.stringify({ ...clipboard, tokenEstimate: 0 });
  return Math.ceil(json.length / 4);
}

function withTokenEstimate(clipboard: EvidenceClipboard): EvidenceClipboard {
  return {
    ...clipboard,
    tokenEstimate: computeTokenEstimate(clipboard),
  };
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function normalizeClipboard(value: Partial<EvidenceClipboard> | null): EvidenceClipboard {
  const normalized: EvidenceClipboard = {
    version: CLIPBOARD_VERSION,
    collectedAt: typeof value?.collectedAt === "number" ? value.collectedAt : Date.now(),
    thesis: clampString(value?.thesis),
    evidence: Array.isArray(value?.evidence)
      ? value.evidence
          .map((source) => {
            const sourceId = clampString(source?.sourceId);
            const sourceTitle = clampString(source?.sourceTitle);
            const items = Array.isArray(source?.items)
              ? source.items
                  .filter(isEvidenceItem)
                  .map((item) => ({
                    type: item.type,
                    text: clampString(item.text),
                    citedInTurn: typeof item.citedInTurn === "number" ? item.citedInTurn : 0,
                    ...(clampString(item.location) ? { location: clampString(item.location) } : {}),
                  }))
                  .filter((item) => item.text.length > 0)
              : [];

            if (!sourceId || !sourceTitle || items.length === 0) {
              return null;
            }

            return { sourceId, sourceTitle, items };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null)
      : [],
    styleProfile: value?.styleProfile
      ? {
          sentenceLength: clampString(value.styleProfile.sentenceLength),
          vocabulary: clampString(value.styleProfile.vocabulary),
          tone: clampString(value.styleProfile.tone),
          transitions: Array.isArray(value.styleProfile.transitions)
            ? value.styleProfile.transitions
                .map((transition) => clampString(transition))
                .filter(Boolean)
                .slice(0, 8)
            : [],
        }
      : undefined,
    writingProgress: Array.isArray(value?.writingProgress)
      ? value.writingProgress
          .map((progress) => {
            const section = clampString(progress?.section);
            const status = progress?.status;
            const turnNumber = typeof progress?.turnNumber === "number" ? progress.turnNumber : 0;

            if (!section) return null;
            if (status !== "drafted" && status !== "revised" && status !== "final") {
              return null;
            }

            return { section, status, turnNumber };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null)
      : [],
    tokenEstimate: typeof value?.tokenEstimate === "number" ? value.tokenEstimate : 0,
  };

  return withTokenEstimate(normalized);
}

export function createEmptyClipboard(thesis = ""): EvidenceClipboard {
  return withTokenEstimate({
    version: CLIPBOARD_VERSION,
    collectedAt: Date.now(),
    thesis: thesis.trim(),
    evidence: [],
    writingProgress: [],
    tokenEstimate: 0,
  });
}

export function serializeClipboard(clipboard: EvidenceClipboard): string {
  return JSON.stringify(withTokenEstimate(clipboard));
}

export function deserializeClipboard(json: string | null): EvidenceClipboard {
  if (!json) return createEmptyClipboard();
  return normalizeClipboard(safeJsonParse<Partial<EvidenceClipboard>>(json));
}

function isDuplicateItem(existing: EvidenceItem, incoming: EvidenceItem): boolean {
  if (existing.type !== incoming.type) return false;
  if (existing.location && incoming.location && existing.location === incoming.location) {
    return similarityScore(existing.text, incoming.text) >= 0.8;
  }
  return similarityScore(existing.text, incoming.text) >= 0.88;
}

export function mergeEvidence(
  clipboard: EvidenceClipboard,
  newEvidence: Array<{ sourceId: string; sourceTitle: string; items: EvidenceItem[] }>,
  turnNumber: number,
): EvidenceClipboard {
  const next = deserializeClipboard(serializeClipboard(clipboard));

  for (const incomingSource of newEvidence) {
    const sourceId = clampString(incomingSource?.sourceId);
    const sourceTitle = clampString(incomingSource?.sourceTitle);
    const incomingItems = Array.isArray(incomingSource?.items)
      ? incomingSource.items
          .filter(isEvidenceItem)
          .map((item) => ({
            type: item.type,
            text: clampString(item.text),
            citedInTurn: turnNumber,
            ...(clampString(item.location) ? { location: clampString(item.location) } : {}),
          }))
          .filter((item) => item.text.length > 0)
      : [];

    if (!sourceId || !sourceTitle || incomingItems.length === 0) {
      continue;
    }

    const existingSource = next.evidence.find((source) => source.sourceId === sourceId);
    if (!existingSource) {
      next.evidence.push({
        sourceId,
        sourceTitle,
        items: incomingItems,
      });
      continue;
    }

    existingSource.sourceTitle = sourceTitle;

    for (const item of incomingItems) {
      const duplicate = existingSource.items.find((existingItem) => isDuplicateItem(existingItem, item));
      if (!duplicate) {
        existingSource.items.push(item);
        continue;
      }

      if (!duplicate.location && item.location) {
        duplicate.location = item.location;
      }
      if (item.citedInTurn > duplicate.citedInTurn) {
        duplicate.citedInTurn = item.citedInTurn;
      }
    }
  }

  next.collectedAt = Date.now();
  return withTokenEstimate(next);
}

export function updateProgress(
  clipboard: EvidenceClipboard,
  sections: Array<{ section: string; status: "drafted" | "revised" | "final" }>,
  turnNumber: number,
): EvidenceClipboard {
  const next = deserializeClipboard(serializeClipboard(clipboard));

  for (const sectionUpdate of sections) {
    const section = clampString(sectionUpdate?.section);
    const status = sectionUpdate?.status;
    if (!section) continue;
    if (status !== "drafted" && status !== "revised" && status !== "final") continue;

    const key = section.toLowerCase();
    const existing = next.writingProgress.find((item) => item.section.toLowerCase() === key);
    if (!existing) {
      next.writingProgress.push({ section, status, turnNumber });
      continue;
    }

    if (STATUS_ORDER[status] >= STATUS_ORDER[existing.status]) {
      existing.status = status;
    }
    existing.turnNumber = Math.max(existing.turnNumber, turnNumber);
  }

  next.collectedAt = Date.now();
  return withTokenEstimate(next);
}

export function formatClipboardForPrompt(clipboard: EvidenceClipboard): string {
  if (clipboard.evidence.length === 0) return "[No evidence collected yet]";

  let output = `## Accumulated Evidence (${clipboard.evidence.reduce((count, source) => count + source.items.length, 0)} items from ${clipboard.evidence.length} sources)\n`;

  for (const source of clipboard.evidence) {
    output += `\n### ${source.sourceTitle}\n`;
    for (const item of source.items) {
      const prefix = item.type === "direct_quote" ? `"${item.text}"` : item.text;
      output += `- [${item.type}] ${prefix}${item.location ? ` (${item.location})` : ""}\n`;
    }
  }

  if (clipboard.writingProgress.length > 0) {
    output += `\n## Writing Progress\n`;
    for (const progress of clipboard.writingProgress) {
      output += `- ${progress.section}: ${progress.status} (turn ${progress.turnNumber})\n`;
    }
  }

  return output;
}

function extractText(response: { content?: Array<{ type: string; text?: string }> }): string {
  if (!Array.isArray(response.content)) return "";
  return response.content
    .filter((block): block is { type: string; text: string } => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export async function extractUsedEvidence(
  anthropic: AnthropicLike,
  assistantResponse: string,
  availableEvidence: string,
  currentClipboard: EvidenceClipboard,
  turnNumber: number,
): Promise<EvidenceClipboard> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system: `Extract evidence that was actually used in the assistant's response. Return JSON with:
{
  "newEvidence": [{ "sourceId": "...", "sourceTitle": "...", "items": [{ "type": "direct_quote"|"paraphrase"|"data_point"|"finding", "text": "...", "location": "..." }] }],
  "sectionsWorkedOn": [{ "section": "...", "status": "drafted"|"revised"|"final" }]
}
Only include evidence that was clearly cited or referenced. Be precise.`,
    messages: [
      {
        role: "user",
        content: `Evidence available:\n${availableEvidence}\n\nAssistant wrote:\n${assistantResponse}\n\nWhat was actually used?`,
      },
    ],
  });

  const text = extractText(response).replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
  const parsed = safeJsonParse<{
    newEvidence?: Array<{ sourceId: string; sourceTitle: string; items: EvidenceItem[] }>;
    sectionsWorkedOn?: Array<{ section: string; status: "drafted" | "revised" | "final" }>;
  }>(text) || {};

  let updated = mergeEvidence(currentClipboard, parsed.newEvidence || [], turnNumber);
  if (parsed.sectionsWorkedOn?.length) {
    updated = updateProgress(updated, parsed.sectionsWorkedOn, turnNumber);
  }

  updated.collectedAt = Date.now();
  return withTokenEstimate(updated);
}
