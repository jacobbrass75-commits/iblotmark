import Anthropic from "@anthropic-ai/sdk";
import type { Message } from "@shared/schema";
import { storage } from "./storage";

const RESEARCH_MODEL = "claude-sonnet-4-6";
const RESEARCH_MAX_TOKENS = 8192;
const MAX_RESEARCH_CHARS_PER_CALL = 220_000;
const CHUNK_OVERLAP_CHARS = 1_000;
const MAX_RETURNED_FINDINGS = 8;

export interface ResearchFinding {
  quote: string;
  startPosition: number;
  endPosition: number;
  relevance: string;
  verified: boolean;
  verificationNote?: string;
}

export interface ResearchResult {
  findings: ResearchFinding[];
  sourceDocumentId: string;
  tokensUsed: number;
}

function getAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

interface ResearchChunk {
  text: string;
  startOffset: number;
}

function splitIntoResearchChunks(fullText: string): ResearchChunk[] {
  if (fullText.length <= MAX_RESEARCH_CHARS_PER_CALL) {
    return [{ text: fullText, startOffset: 0 }];
  }

  const chunks: ResearchChunk[] = [];
  let cursor = 0;
  while (cursor < fullText.length) {
    const end = Math.min(fullText.length, cursor + MAX_RESEARCH_CHARS_PER_CALL);
    chunks.push({
      text: fullText.slice(cursor, end),
      startOffset: cursor,
    });
    if (end >= fullText.length) break;
    cursor = Math.max(0, end - CHUNK_OVERLAP_CHARS);
  }

  return chunks;
}

function extractJsonArray(text: string): unknown[] {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

function coerceFinding(raw: unknown, startOffset: number): ResearchFinding | null {
  if (!raw || typeof raw !== "object") return null;

  const row = raw as {
    quote?: unknown;
    startPosition?: unknown;
    endPosition?: unknown;
    relevance?: unknown;
  };

  const quote = typeof row.quote === "string" ? row.quote.trim() : "";
  if (!quote) return null;

  const relevance = typeof row.relevance === "string"
    ? row.relevance.trim()
    : "Relevance not provided.";

  let startPosition =
    typeof row.startPosition === "number" && Number.isFinite(row.startPosition)
      ? row.startPosition
      : -1;
  let endPosition =
    typeof row.endPosition === "number" && Number.isFinite(row.endPosition)
      ? row.endPosition
      : -1;

  // If the model returned chunk-relative positions for a non-zero chunk, lift to absolute.
  if (startOffset > 0 && startPosition >= 0 && startPosition < startOffset) {
    startPosition += startOffset;
  }
  if (startOffset > 0 && endPosition >= 0 && endPosition < startOffset) {
    endPosition += startOffset;
  }

  return {
    quote,
    startPosition,
    endPosition,
    relevance,
    verified: false,
  };
}

function parseResearchFindings(rawResponse: string, startOffset: number): ResearchFinding[] {
  const parsed = extractJsonArray(rawResponse);
  return parsed
    .map((entry) => coerceFinding(entry, startOffset))
    .filter((entry): entry is ResearchFinding => Boolean(entry));
}

async function runResearchChunk(
  client: Anthropic,
  params: {
    filename: string;
    chunk: ResearchChunk;
    chunkIndex: number;
    chunkCount: number;
    fullTextLength: number;
    reason: string;
    projectContext: {
      thesis: string | null;
      scope: string | null;
      recentWritingTopic: string;
    };
  }
): Promise<{ findings: ResearchFinding[]; tokensUsed: number }> {
  const {
    filename,
    chunk,
    chunkIndex,
    chunkCount,
    fullTextLength,
    reason,
    projectContext,
  } = params;

  const chunkDescriptor = chunkCount > 1
    ? `Document chunk ${chunkIndex + 1} of ${chunkCount}, chars ${chunk.startOffset}-${chunk.startOffset + chunk.text.length}.`
    : "Full document provided in this request.";

  const researchPrompt = `You are a research agent analyzing a source document for an academic writing project.

PROJECT CONTEXT:
Thesis: ${projectContext.thesis || "Not provided"}
Scope: ${projectContext.scope || "Not provided"}
Current writing topic: ${projectContext.recentWritingTopic}

RESEARCH REQUEST:
${reason}

SOURCE DOCUMENT: "${filename}" (${fullTextLength} characters total)
${chunkDescriptor}

INSTRUCTIONS:
1. Read the source text carefully.
2. Find passages relevant to the research request and current writing topic.
3. For each relevant passage, extract the exact quote from the text.
4. Report absolute character positions for each quote in the original full document.
5. Explain why each passage is relevant.
6. Return only a JSON array.

OUTPUT FORMAT:
[
  {
    "quote": "exact text from the source",
    "startPosition": 12345,
    "endPosition": 12500,
    "relevance": "Why this matters for the current writing task"
  }
]

Find 2-6 relevant passages from this chunk.`;

  const message = await client.messages.create({
    model: RESEARCH_MODEL,
    max_tokens: RESEARCH_MAX_TOKENS,
    messages: [
      {
        role: "user",
        content: `${researchPrompt}\n\nSOURCE TEXT:\n${chunk.text}`,
      },
    ],
  });

  const responseText = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  const findings = parseResearchFindings(responseText, chunk.startOffset);
  const tokensUsed = (message.usage?.input_tokens || 0) + (message.usage?.output_tokens || 0);

  return { findings, tokensUsed };
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function verifyQuote(finding: ResearchFinding, fullText: string): ResearchFinding {
  const normalizedQuote = normalizeWhitespace(finding.quote);
  if (!normalizedQuote) {
    return {
      ...finding,
      verified: false,
      verificationNote: "Empty quote returned by research agent.",
    };
  }

  const normalizedFullText = normalizeWhitespace(fullText);
  const directMatchIndex = normalizedFullText.indexOf(normalizedQuote);
  if (directMatchIndex !== -1) {
    return {
      ...finding,
      verified: true,
    };
  }

  if (
    finding.startPosition >= 0 &&
    finding.endPosition > finding.startPosition &&
    finding.endPosition <= fullText.length
  ) {
    const atPosition = normalizeWhitespace(
      fullText.slice(finding.startPosition, finding.endPosition)
    );

    if (atPosition === normalizedQuote) {
      return {
        ...finding,
        verified: true,
      };
    }

    const quoteWords = normalizedQuote.split(" ").filter(Boolean);
    const positionWords = atPosition.split(" ").filter(Boolean);
    if (
      quoteWords.length > 0 &&
      quoteWords.length === positionWords.length &&
      quoteWords.every((word, i) => word === positionWords[i])
    ) {
      return {
        ...finding,
        verified: true,
      };
    }

    if (atPosition.length > 0) {
      return {
        ...finding,
        verified: false,
        verificationNote: `Quote did not match text at reported position. Actual text: "${atPosition}"`,
      };
    }
  }

  const quoteWords = normalizedQuote.split(" ").filter(Boolean);
  if (quoteWords.length >= 5) {
    const prefix = quoteWords.slice(0, 5).join(" ");
    const prefixIndex = normalizedFullText.indexOf(prefix);
    if (prefixIndex !== -1) {
      const correctedQuote = normalizedFullText.slice(
        prefixIndex,
        prefixIndex + normalizedQuote.length
      );
      return {
        ...finding,
        quote: correctedQuote,
        verified: false,
        verificationNote: "Quote corrected to match source text.",
      };
    }
  }

  return {
    ...finding,
    verified: false,
    verificationNote: "Quote could not be located in source document. May be fabricated.",
  };
}

export function extractRecentWritingTopic(messages: Message[]): string {
  const recent = messages.slice(-4);
  const lastUser = [...recent].reverse().find((m) => m.role === "user");
  const lastAssistant = [...recent].reverse().find((m) => m.role === "assistant");

  const parts: string[] = [];
  if (lastUser) {
    parts.push(`User latest request: ${lastUser.content.slice(0, 500)}`);
  }
  if (lastAssistant) {
    const docMatch = lastAssistant.content.match(/<document[^>]*>([\s\S]{0,500})/i);
    if (docMatch && docMatch[1]) {
      parts.push(`Most recent draft content: ${docMatch[1]}...`);
    }
  }

  return parts.join("\n") || "General source review for current writing task.";
}

export async function runResearchAgent(
  documentId: string,
  reason: string,
  projectContext: {
    thesis: string | null;
    scope: string | null;
    recentWritingTopic: string;
  }
): Promise<ResearchResult> {
  const document = await storage.getDocument(documentId);
  if (!document) {
    throw new Error(`Document ${documentId} not found`);
  }

  const fullText = document.fullText || "";
  if (!fullText.trim()) {
    return {
      findings: [],
      sourceDocumentId: documentId,
      tokensUsed: 0,
    };
  }

  const client = getAnthropicClient();
  const chunks = splitIntoResearchChunks(fullText);
  const collected: ResearchFinding[] = [];
  let tokensUsed = 0;

  for (let i = 0; i < chunks.length; i += 1) {
    const result = await runResearchChunk(client, {
      filename: document.filename,
      chunk: chunks[i],
      chunkIndex: i,
      chunkCount: chunks.length,
      fullTextLength: fullText.length,
      reason,
      projectContext,
    });

    collected.push(...result.findings);
    tokensUsed += result.tokensUsed;
  }

  const deduped = Array.from(
    new Map(
      collected.map((finding) => [
        `${finding.startPosition}:${finding.endPosition}:${normalizeWhitespace(finding.quote)}`,
        finding,
      ])
    ).values()
  );

  const verified = deduped.map((finding) => verifyQuote(finding, fullText));

  const sorted = [...verified].sort((a, b) => {
    if (a.verified !== b.verified) return a.verified ? -1 : 1;
    return a.startPosition - b.startPosition;
  });

  return {
    findings: sorted.slice(0, MAX_RETURNED_FINDINGS),
    sourceDocumentId: documentId,
    tokensUsed,
  };
}
