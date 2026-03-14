import type { Express, Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { and, eq, inArray } from "drizzle-orm";
import {
  chatStorage,
  updateConversationClipboard,
  updateConversationCompaction,
} from "./chatStorage";
import { db } from "./db";
import { projectStorage } from "./projectStorage";
import { storage } from "./storage";
import { requireAuth, requireTier } from "./auth";
import { logContextSnapshot, logToolCall } from "./analyticsLogger";
import {
  gatherEvidence,
  formatEvidenceBrief,
  type SourceStub,
  type EvidenceBrief,
} from "./gatherer";
import {
  createEmptyClipboard,
  deserializeClipboard,
  serializeClipboard,
  formatClipboardForPrompt,
  extractUsedEvidence,
  type EvidenceClipboard,
} from "./evidenceClipboard";
import {
  compactConversation,
  buildCompactedHistory,
  getToolResponseLimit,
  truncateToolResult,
} from "./contextCompaction";
import {
  formatSourceForPrompt,
  formatSourceForPromptTiered,
  type TieredSource,
  type WritingSource,
} from "./writingPipeline";
import {
  analyzeWritingStyle,
  buildStyleSection,
  formatSourceStubByRole,
  isSourceRole,
  type SourceRole,
} from "./sourceRoles";
import { clipText, buildAuthorLabel } from "./writingRoutes";
import {
  extractRecentWritingTopic,
  runResearchAgent,
  type ResearchFinding,
} from "./researchAgent";
import {
  projectDocuments,
  webClips,
  type CitationData,
  type Conversation,
  type Message,
  type Project,
} from "@shared/schema";

const MAX_SOURCE_EXCERPT_CHARS = 2000;
const MAX_SOURCE_FULLTEXT_CHARS = 30000;
const MAX_SOURCE_TOTAL_FULLTEXT_CHARS = 150000;
const CHAT_MAX_TOKENS = 8192;
const COMPILE_MAX_TOKENS = 8192;
const VERIFY_MAX_TOKENS = 8192;
const MAX_CONTEXT_ESCALATIONS = 2;

const MODELS = {
  precision: {
    chat: "claude-opus-4-6",
    compile: "claude-opus-4-6",
    verify: "claude-opus-4-6",
  },
  extended: {
    chat: "claude-sonnet-4-6",
    compile: "claude-sonnet-4-6",
    verify: "claude-sonnet-4-6",
  },
  research: "claude-sonnet-4-6",
} as const;

const TOKEN_LIMITS = {
  precision: 200_000,
  extended: 200_000,
} as const;

const RESERVED_TOKENS = 10_000;
const OUTPUT_TOKENS = CHAT_MAX_TOKENS;

const BASE_SYSTEM_PROMPT =
  "You are ScholarMark AI, a helpful academic writing assistant. You help students with research, writing, citations, and understanding academic sources. Be concise, accurate, and helpful.";

const TOOL_REQUEST_REGEX = /<(chunk_request|context_request)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
const STREAM_TAG_PREFIXES = [
  "<document",
  "</document",
  "<chunk_request",
  "</chunk_request",
  "<context_request",
  "</context_request",
];

type WritingProjectContext = Pick<Project, "name" | "thesis" | "scope" | "contextSummary">;
type PromptSource = WritingSource | TieredSource;
type WritingMode = "precision" | "extended";
type ToolRequestType = "chunk_request" | "context_request";
type ContextWarningLevel = "ok" | "caution" | "critical";
type AnthropicHistoryMessage = { role: "user" | "assistant"; content: string };
type WritingStreamEventType =
  | "chat_text"
  | "document_start"
  | "document_text"
  | "document_end"
  | "done"
  | "error";

interface ToolRequest {
  type: ToolRequestType;
  annotationId?: string;
  documentId: string;
  reason: string;
  rawTag: string;
}

interface ContextUsageEstimate {
  systemTokens: number;
  historyTokens: number;
  totalUsed: number;
  available: number;
  limit: number;
  warningLevel: ContextWarningLevel;
}

interface StreamTurnResult {
  fullText: string;
  usage: { input_tokens?: number; output_tokens?: number };
  toolRequests: ToolRequest[];
}

type SourceToolName = "get_source_summary" | "get_source_chunks";

interface SourceToolInput {
  docId?: string;
  query?: string;
  maxItems?: number;
}

function parseStyleAnalysisValue(raw: string | null | undefined) {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Parameters<typeof buildStyleSection>[0][number]["styleAnalysis"];
  } catch {
    return null;
  }
}

function getAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function normalizedPromptValue(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "Not provided.";
}

function prettyToneLabel(tone?: string): string {
  if (!tone) return "academic";
  if (tone === "ap_style") return "AP style";
  return tone;
}

function getWritingMode(conv: Pick<Conversation, "writingModel">): WritingMode {
  return conv.writingModel === "extended" ? "extended" : "precision";
}

function getModelsForConversation(conv: Pick<Conversation, "writingModel">) {
  const mode = getWritingMode(conv);
  return MODELS[mode];
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateContextUsage(
  systemPrompt: string,
  messages: AnthropicHistoryMessage[],
  mode: WritingMode
): ContextUsageEstimate {
  const limit = TOKEN_LIMITS[mode];
  const systemTokens = estimateTokens(systemPrompt);
  const historyTokens = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
  const totalUsed = systemTokens + historyTokens + OUTPUT_TOKENS + RESERVED_TOKENS;
  const available = limit - totalUsed;

  let warningLevel: ContextWarningLevel = "ok";
  if (available < 20_000) warningLevel = "caution";
  if (available < 5_000) warningLevel = "critical";

  return { systemTokens, historyTokens, totalUsed, available, limit, warningLevel };
}

function buildProjectContextBlock(project: WritingProjectContext | null): string {
  if (!project) {
    return "PROJECT CONTEXT:\nProject: Standalone writing mode\nThesis: Not provided.\nScope: Not provided.\nSummary: Not provided.";
  }

  return `PROJECT CONTEXT:
Project: ${normalizedPromptValue(project.name)}
Thesis: ${normalizedPromptValue(project.thesis)}
Scope: ${normalizedPromptValue(project.scope)}
Summary: ${normalizedPromptValue(project.contextSummary)}`;
}

function isTieredSource(source: PromptSource): source is TieredSource {
  return "annotations" in source;
}

function buildSourceBlock(sources: PromptSource[]): string {
  if (sources.length === 0) {
    return "No explicit source materials are attached to this conversation.";
  }

  return sources
    .map((source, i) => {
      const sourceText = isTieredSource(source)
        ? formatSourceForPromptTiered(source)
        : formatSourceForPrompt(source);
      return `--- Source ${i + 1} ---\n${sourceText}`;
    })
    .join("\n\n");
}

function buildSourceTools() {
  return [
    {
      name: "get_source_summary",
      description: "Get the compact summary and high-level arguments for a source document.",
      input_schema: {
        type: "object",
        properties: {
          docId: { type: "string", description: "The document id to summarize." },
        },
        required: ["docId"],
      },
    },
    {
      name: "get_source_chunks",
      description: "Get specific annotated passages or chunk excerpts from an evidence source.",
      input_schema: {
        type: "object",
        properties: {
          docId: { type: "string", description: "The document id to inspect." },
          query: { type: "string", description: "What evidence or theme to look for." },
          maxItems: { type: "integer", description: "Maximum passages to return." },
        },
        required: ["docId"],
      },
    },
  ];
}

function normalizeSourceToolInput(input: unknown): SourceToolInput {
  if (!input || typeof input !== "object") {
    return {};
  }

  const value = input as Record<string, unknown>;
  return {
    docId: typeof value.docId === "string" ? value.docId : undefined,
    query: typeof value.query === "string" ? value.query : undefined,
    maxItems: typeof value.maxItems === "number" ? value.maxItems : undefined,
  };
}

function getQueryTerms(query?: string): string[] {
  if (!query) return [];
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 2);
}

function scoreAnnotationMatch(
  annotation: TieredSource["annotations"][number],
  queryTerms: string[],
): number {
  if (queryTerms.length === 0) return 0;
  const haystack = `${annotation.highlightedText} ${annotation.note || ""}`.toLowerCase();
  return queryTerms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function formatSourceSummary(source: TieredSource): string {
  const parts = [
    formatSourceStubByRole({
      id: source.id,
      title: source.title,
      sourceRole: source.sourceRole || "evidence",
      styleAnalysis: parseStyleAnalysisValue(source.styleAnalysis),
      summary: source.summary,
      annotationCount: source.annotations.length,
      chunkCount: source.chunkCount,
    }),
  ];

  if (source.summary) {
    parts.push(`Summary: ${source.summary}`);
  }
  if (source.mainArguments?.length) {
    parts.push(`Main arguments: ${source.mainArguments.join("; ")}`);
  }
  if (source.keyConcepts?.length) {
    parts.push(`Key concepts: ${source.keyConcepts.join(", ")}`);
  }

  return parts.join("\n");
}

function createSourceToolExecutor(sources: TieredSource[]) {
  const sourceByDocId = new Map<string, TieredSource>();
  for (const source of sources) {
    sourceByDocId.set(source.documentId, source);
    sourceByDocId.set(source.id, source);
  }

  const toolLimit = getToolResponseLimit(sources.length);

  return async (name: string, input: unknown): Promise<string> => {
    const { docId, query, maxItems } = normalizeSourceToolInput(input);
    if (!docId) {
      return "[TOOL ERROR] Missing docId.";
    }

    const source = sourceByDocId.get(docId);
    if (!source) {
      return `[TOOL ERROR] Source "${docId}" was not found.`;
    }

    if (name === "get_source_summary") {
      return truncateToolResult(formatSourceSummary(source), toolLimit);
    }

    if (name === "get_source_chunks") {
      const queryTerms = getQueryTerms(query);
      const annotationLimit = Math.max(1, Math.min(maxItems || 4, 6));
      const rankedAnnotations = [...source.annotations]
        .map((annotation) => ({
          annotation,
          score: scoreAnnotationMatch(annotation, queryTerms),
        }))
        .sort((left, right) => right.score - left.score);

      if (rankedAnnotations.length > 0) {
        const annotationText = rankedAnnotations
          .slice(0, annotationLimit)
          .map(({ annotation }, index) => {
            const lines = [
              `[ANNOTATION ${index + 1}] chars ${annotation.startPosition}-${annotation.endPosition} | category: ${annotation.category}`,
              `"${clipText(annotation.highlightedText, 1200) || annotation.highlightedText}"`,
            ];
            if (annotation.note) {
              lines.push(`Note: ${annotation.note}`);
            }
            return lines.join("\n");
          })
          .join("\n\n");

        return truncateToolResult(annotationText, toolLimit);
      }

      const chunks = await storage.getChunksForDocument(source.documentId);
      const chunkText = chunks
        .slice(0, annotationLimit)
        .map(
          (chunk, index) =>
            `[CHUNK ${index + 1}] chars ${chunk.startPosition}-${chunk.endPosition}\n${clipText(chunk.text, 1200) || chunk.text}`,
        )
        .join("\n\n");

      return truncateToolResult(
        chunkText || "[NO EVIDENCE] No annotations or chunks were available for this source.",
        toolLimit,
      );
    }

    return `[TOOL ERROR] Unsupported tool "${name}".`;
  };
}

function normalizeTitle(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "Draft";
}

function matchOpenDocumentTag(tagText: string): string | null {
  const match = tagText.match(/^<document\s+title="([^"]*)"\s*>$/i);
  if (!match) return null;
  return normalizeTitle(match[1] || "");
}

function isCloseDocumentTag(tagText: string): boolean {
  return /^<\/document\s*>$/i.test(tagText);
}

function matchOpenToolTag(tagText: string): ToolRequestType | null {
  if (/^<chunk_request\b[^>]*>$/i.test(tagText)) return "chunk_request";
  if (/^<context_request\b[^>]*>$/i.test(tagText)) return "context_request";
  return null;
}

function isCloseToolTag(tagText: string, type: ToolRequestType): boolean {
  return new RegExp(`^<\\/${type}\\s*>$`, "i").test(tagText);
}

function looksLikeKnownTagPrefix(value: string): boolean {
  const lower = value.toLowerCase();
  return STREAM_TAG_PREFIXES.some((prefix) => prefix.startsWith(lower));
}

function createDocumentStreamParser(
  emit: (event: { type: WritingStreamEventType; [key: string]: unknown }) => void
) {
  let inDocument = false;
  let activeToolTag: ToolRequestType | null = null;
  let tagMode = false;
  let tagBuffer = "";
  let chatBuffer = "";
  let documentBuffer = "";
  let activeDocumentTitle = "";

  const flushChat = () => {
    if (!chatBuffer) return;
    emit({ type: "chat_text", text: chatBuffer });
    chatBuffer = "";
  };

  const flushDocument = () => {
    if (!documentBuffer) return;
    emit({ type: "document_text", text: documentBuffer });
    documentBuffer = "";
  };

  const appendVisible = (text: string) => {
    if (!text || activeToolTag) return;
    if (inDocument) {
      documentBuffer += text;
      return;
    }
    chatBuffer += text;
  };

  const processCompletedTag = (tagText: string) => {
    const openToolTag = matchOpenToolTag(tagText);
    if (!activeToolTag && openToolTag) {
      if (inDocument) {
        flushDocument();
      } else {
        flushChat();
      }
      activeToolTag = openToolTag;
      return;
    }

    if (activeToolTag) {
      if (isCloseToolTag(tagText, activeToolTag)) {
        activeToolTag = null;
      }
      return;
    }

    const openTitle = matchOpenDocumentTag(tagText);
    if (!inDocument && openTitle) {
      flushChat();
      activeDocumentTitle = openTitle;
      emit({ type: "document_start", title: activeDocumentTitle });
      inDocument = true;
      return;
    }

    if (inDocument && isCloseDocumentTag(tagText)) {
      flushDocument();
      emit({ type: "document_end", title: activeDocumentTitle || "Draft" });
      activeDocumentTitle = "";
      inDocument = false;
      return;
    }

    appendVisible(tagText);
  };

  const pushText = (chunk: string) => {
    for (const ch of chunk) {
      if (!tagMode) {
        if (ch === "<") {
          tagMode = true;
          tagBuffer = "<";
        } else {
          appendVisible(ch);
        }
        continue;
      }

      tagBuffer += ch;
      if (ch === ">") {
        processCompletedTag(tagBuffer);
        tagBuffer = "";
        tagMode = false;
        continue;
      }

      if (tagBuffer.length > 220 || !looksLikeKnownTagPrefix(tagBuffer)) {
        appendVisible(tagBuffer);
        tagBuffer = "";
        tagMode = false;
      }
    }
  };

  const finish = () => {
    if (tagMode && tagBuffer) {
      appendVisible(tagBuffer);
      tagBuffer = "";
      tagMode = false;
    }

    flushChat();
    flushDocument();

    if (inDocument) {
      emit({ type: "document_end", title: activeDocumentTitle || "Draft" });
      inDocument = false;
      activeDocumentTitle = "";
    }

    activeToolTag = null;
  };

  return { pushText, finish };
}

function parseToolRequestAttributes(attrText: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z_]+)="([^"]*)"/g;
  let match: RegExpExecArray | null = null;

  while ((match = attrRegex.exec(attrText)) !== null) {
    attrs[match[1].toLowerCase()] = match[2];
  }

  return attrs;
}

function extractToolRequestsFromText(text: string): ToolRequest[] {
  const requests: ToolRequest[] = [];
  let match: RegExpExecArray | null = null;

  while ((match = TOOL_REQUEST_REGEX.exec(text)) !== null) {
    const type = String(match[1] || "").toLowerCase() as ToolRequestType;
    if (type !== "chunk_request" && type !== "context_request") continue;

    const attrs = parseToolRequestAttributes(match[2] || "");
    const documentId = attrs.document_id?.trim();
    if (!documentId) continue;

    const reason = (match[3] || "").trim();
    const annotationId = attrs.annotation_id?.trim();

    requests.push({
      type,
      annotationId: annotationId || undefined,
      documentId,
      reason,
      rawTag: match[0],
    });
  }

  return requests;
}

function createToolRequestParser(onToolRequest: (request: ToolRequest) => void) {
  let buffer = "";

  const pushText = (chunk: string) => {
    buffer += chunk;
  };

  const finish = () => {
    const requests = extractToolRequestsFromText(buffer);
    for (const request of requests) {
      onToolRequest(request);
    }
    buffer = "";
  };

  return { pushText, finish };
}

async function loadProjectSourcesTiered(
  projectId: string,
  selectedSourceIds?: string[] | null
): Promise<TieredSource[]> {
  const projectDocs = await projectStorage.getProjectDocumentsByProject(projectId);
  const filteredDocs = selectedSourceIds && selectedSourceIds.length > 0
    ? projectDocs.filter((projectDoc) => selectedSourceIds.includes(projectDoc.id))
    : projectDocs;

  const sources: TieredSource[] = [];

  for (const projectDoc of filteredDocs) {
    const fullDoc = await storage.getDocument(projectDoc.documentId);
    if (!fullDoc) continue;

    const annotations = await projectStorage.getProjectAnnotationsByDocument(projectDoc.id);
    const citationData = (projectDoc.citationData as CitationData | null) || null;
    const sourceRole: SourceRole = isSourceRole(projectDoc.sourceRole) ? projectDoc.sourceRole : "evidence";
    let styleAnalysis = projectDoc.styleAnalysis || null;

    if (sourceRole === "style_reference" && !styleAnalysis) {
      try {
        const analysis = await analyzeWritingStyle(
          getAnthropicClient(),
          fullDoc.fullText,
          citationData?.title || projectDoc.document.filename,
        );
        styleAnalysis = JSON.stringify(analysis);
        await db
          .update(projectDocuments)
          .set({ styleAnalysis })
          .where(eq(projectDocuments.id, projectDoc.id));
      } catch (error) {
        console.warn("[chatRoutes] style analysis failed", {
          projectDocumentId: projectDoc.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const excerpt =
      clipText(fullDoc.summary, MAX_SOURCE_EXCERPT_CHARS) ||
      clipText(fullDoc.fullText, MAX_SOURCE_EXCERPT_CHARS) ||
      "No summary available.";

    sources.push({
      id: projectDoc.id,
      kind: "project_document",
      title: citationData?.title || projectDoc.document.filename,
      author: buildAuthorLabel(citationData),
      category: "project_source",
      citationData,
      documentFilename: projectDoc.document.filename,
      summary: fullDoc.summary,
      mainArguments: fullDoc.mainArguments || null,
      keyConcepts: fullDoc.keyConcepts || null,
      roleInProject: projectDoc.roleInProject || null,
      projectContext: projectDoc.projectContext || null,
      sourceRole,
      styleAnalysis,
      chunkCount: fullDoc.chunkCount,
      annotations,
      excerpt,
      documentId: fullDoc.id,
    });
  }

  return sources;
}

async function loadStandaloneWebClipSources(
  userId: string,
  selectedSourceIds?: string[] | null
): Promise<WritingSource[]> {
  if (!selectedSourceIds || selectedSourceIds.length === 0) {
    return [];
  }

  const clipIds = Array.from(
    new Set(selectedSourceIds.map((id) => id?.trim()).filter(Boolean))
  ) as string[];
  if (clipIds.length === 0) {
    return [];
  }

  const clips = await db
    .select()
    .from(webClips)
    .where(and(eq(webClips.userId, userId), inArray(webClips.id, clipIds)));

  const perSourceFullTextLimit = clips.length > 0
    ? Math.min(
      MAX_SOURCE_FULLTEXT_CHARS,
      Math.max(2000, Math.floor(MAX_SOURCE_TOTAL_FULLTEXT_CHARS / clips.length))
    )
    : MAX_SOURCE_FULLTEXT_CHARS;

  const byId = new Map(clips.map((clip) => [clip.id, clip]));
  const orderedClips = clipIds
    .map((id) => byId.get(id))
    .filter((clip): clip is typeof clips[number] => Boolean(clip));

  return orderedClips.map((clip) => {
    const citationData = (clip.citationData as CitationData | null) || null;
    const excerpt = clipText(
      clip.note || clip.highlightedText || clip.surroundingContext,
      MAX_SOURCE_EXCERPT_CHARS
    ) || "No summary available.";
    const mergedText = [
      `Page: ${clip.pageTitle}`,
      `URL: ${clip.sourceUrl}`,
      clip.authorName ? `Author: ${clip.authorName}` : "",
      clip.publishDate ? `Published: ${clip.publishDate}` : "",
      "",
      "Highlighted text:",
      clip.highlightedText,
      clip.surroundingContext ? `\nSurrounding context:\n${clip.surroundingContext}` : "",
      clip.note ? `\nUser note:\n${clip.note}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      id: clip.id,
      kind: "web_clip",
      title: citationData?.title || clip.pageTitle,
      author: buildAuthorLabel(citationData) || clip.authorName || "Unknown Author",
      excerpt,
      fullText: clipText(mergedText, perSourceFullTextLimit) || excerpt,
      category: "web_clip",
      note: clip.note || null,
      citationData,
      documentFilename: `${clip.pageTitle || "Web Clip"}.txt`,
    } satisfies WritingSource;
  });
}

async function loadConversationContext(
  conv: Pick<Conversation, "projectId" | "selectedSourceIds">,
  userId: string
): Promise<{ project: WritingProjectContext | null; sources: PromptSource[] }> {
  if (conv.projectId) {
    const [project, sources] = await Promise.all([
      projectStorage.getProject(conv.projectId),
      loadProjectSourcesTiered(conv.projectId, conv.selectedSourceIds),
    ]);

    return {
      project: project
        ? {
          name: project.name,
          thesis: project.thesis,
          scope: project.scope,
          contextSummary: project.contextSummary,
        }
        : null,
      sources,
    };
  }

  return {
    project: null,
    sources: await loadStandaloneWebClipSources(userId, conv.selectedSourceIds),
  };
}

function buildWritingSystemPrompt(
  sources: PromptSource[],
  project: WritingProjectContext | null,
  citationStyle?: string,
  tone?: string,
  humanize?: boolean,
  noEnDashes?: boolean
): string {
  const styleSection = buildStyleSection(
    sources
      .filter(
        (source): source is TieredSource =>
          isTieredSource(source) && source.sourceRole === "style_reference",
      )
      .map((source) => ({
        title: source.title,
        styleAnalysis: parseStyleAnalysisValue(source.styleAnalysis),
      })),
  );
  const styleLabel = (citationStyle || "chicago").toUpperCase();
  const noEnDashesRule = noEnDashes
    ? "\n9. NEVER use em-dashes or en-dashes. Use commas, periods, or semicolons instead."
    : "";
  const includeHumanStyle = humanize ?? true;
  const writingStyleBlock = includeHumanStyle
    ? `
WRITING STYLE:
- Vary sentence length. Mix short punchy sentences with longer analytical ones.
- Use active voice by default. Passive only when actor is unknown.
- Avoid cliche phrases: "It is important to note", "Furthermore", "In conclusion".
- Start paragraphs with substance, not meta-commentary.
- Write as a knowledgeable human expert, not as an AI summarizing.`
    : "";

  return `You are ScholarMark AI, an expert academic writing partner. You are collaborating with a student on a research paper.

${buildProjectContextBlock(project)}

You have access to ${sources.length} source document(s).

SOURCE MATERIALS:
${buildSourceBlock(sources)}${styleSection}

CONVERSATION FLOW:
When a student brings a new writing task, follow this collaborative process:

PHASE 1 - DISCOVERY (first message on a new topic):
Ask the student about their thesis/argument, what angle they want to take, the scope (paragraph, section, full essay), and intended audience/tone. Keep it to 2-3 focused questions, not an interrogation.

PHASE 2 - SOURCE REVIEW:
Review the available source materials and tell the student which sources you found most relevant to their topic. Briefly explain why each source connects. Let them confirm or redirect.

PHASE 3 - OUTLINE:
Propose a structured outline showing how you'd organize the argument and where each source fits. Wait for the student to approve, modify, or redirect before writing.

PHASE 4 - DRAFTING:
Only after outline approval, write the content. Wrap substantial writing in <document> tags.

IMPORTANT EXCEPTIONS:
- If the student says "just write it", "go ahead", or explicitly asks you to skip planning - go straight to drafting.
- If the student asks to revise, expand, or edit existing text - do it immediately without re-doing discovery.
- If continuing an ongoing writing thread where thesis/sources are already established - skip to the relevant phase.
- Short requests like "add a transition sentence" or "fix this paragraph" should be done immediately.

WRITING RULES:
1. Write in ${prettyToneLabel(tone)} register with ${styleLabel} citations.
2. Ground claims in the provided sources. Cite page numbers when available.
3. Use exact source text for direct quotations.
4. Flag claims that go beyond source support.
5. Build on prior conversation and maintain the student's argument thread.
6. Use footnotes for citations: [^1], [^2], etc. with footnote definitions at the end.${noEnDashesRule}
7. Documents marked as style references are voice guides only. Never cite or quote them.

Do not fabricate quotations, publication details, page numbers, or bibliography metadata. If source detail is uncertain, state uncertainty clearly and cite conservatively.${writingStyleBlock}

CONTEXT TOOLS:
You are seeing annotated highlights and summaries from each source. This is your primary working material.

If you need surrounding context for a specific annotation, output exactly:
<chunk_request annotation_id="ANNOTATION_ID" document_id="DOCUMENT_ID">
Brief reason for requesting surrounding context
</chunk_request>

If you need a full-source deep dive, output exactly:
<context_request document_id="DOCUMENT_ID">
What you need from the full source and why
</context_request>

QUOTING RULES:
- Quotes from annotation blocks are pre-verified.
- If you quote from chunk retrieval or deep dive findings, mention that it came from full-text review.
- Include annotation ID or character position when citing evidence.
- Do not fabricate quotes.

OUTPUT FORMAT:
When producing substantial written content (a full paragraph or more of paper content), wrap it in document tags:

<document title="Section Title">
Your written content here in markdown...
</document>

Brief conversational responses (questions, acknowledgments, short clarifications) should NOT use document tags.`;
}

function toAnthropicMessages(history: Message[]): AnthropicHistoryMessage[] {
  return history
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
    }));
}

function findNearestChunkIndex(
  chunks: Array<{ startPosition: number; endPosition: number }>,
  targetStart: number
): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const distance = Math.min(
      Math.abs(chunk.startPosition - targetStart),
      Math.abs(chunk.endPosition - targetStart)
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }

  return bestIndex;
}

async function loadSurroundingChunks(
  documentId: string,
  annotationStartPosition: number,
  annotationEndPosition: number,
  chunksBefore = 4,
  chunksAfter = 4
): Promise<string> {
  const chunks = await storage.getChunksForDocument(documentId);
  if (chunks.length === 0) {
    return "[SURROUNDING CONTEXT unavailable]\nNo chunked text is available for this document.";
  }

  const ordered = [...chunks].sort((a, b) => a.startPosition - b.startPosition);
  let annotationChunkIndex = ordered.findIndex((chunk) =>
    (chunk.startPosition <= annotationStartPosition && chunk.endPosition >= annotationStartPosition) ||
    (chunk.startPosition <= annotationEndPosition && chunk.endPosition >= annotationEndPosition) ||
    (chunk.startPosition >= annotationStartPosition && chunk.endPosition <= annotationEndPosition)
  );

  if (annotationChunkIndex === -1) {
    annotationChunkIndex = findNearestChunkIndex(ordered, annotationStartPosition);
  }

  const startIdx = Math.max(0, annotationChunkIndex - chunksBefore);
  const endIdx = Math.min(ordered.length - 1, annotationChunkIndex + chunksAfter);
  const surrounding = ordered.slice(startIdx, endIdx + 1);
  const rangeStart = surrounding[0].startPosition;
  const rangeEnd = surrounding[surrounding.length - 1].endPosition;

  const merged = surrounding
    .map((chunk) => `[CHUNK ${chunk.startPosition}-${chunk.endPosition}]\n${chunk.text}`)
    .join("\n\n");

  return `[SURROUNDING CONTEXT for chars ${rangeStart}-${rangeEnd}]\n${merged}`;
}

function formatDeepDiveFindings(filename: string, findings: ResearchFinding[]): string {
  const lines: string[] = [`[DEEP DIVE FINDINGS - Source: "${filename}"]`, ""];

  if (findings.length === 0) {
    lines.push("No relevant passages were returned from full-text review.");
    return lines.join("\n");
  }

  findings.forEach((finding, index) => {
    const quoteText = clipText(finding.quote, 1800) || finding.quote;
    lines.push(
      `[FINDING ${index + 1}] Position: chars ${finding.startPosition}-${finding.endPosition} | Verified: ${finding.verified ? "yes" : "no"}`
    );
    lines.push(`"${quoteText}"`);
    lines.push(`Relevance: ${finding.relevance}`);
    if (finding.verificationNote) {
      lines.push(`Verification: ${finding.verificationNote}`);
    }
    lines.push("");
  });

  return lines.join("\n");
}

export function registerChatRoutes(app: Express) {
  app.get("/api/chat/conversations", requireAuth, requireTier("pro"), async (req: Request, res: Response) => {
    try {
      const rawProjectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
      const projectId = rawProjectId && rawProjectId !== "null" ? rawProjectId : undefined;
      const standaloneOnly = req.query.standalone === "true";
      const conversations = standaloneOnly
        ? await chatStorage.getStandaloneConversations(req.user!.userId)
        : await chatStorage.getConversationsForUser(req.user!.userId, projectId);
      res.json(conversations);
    } catch (error) {
      console.error("Error listing conversations:", error);
      res.status(500).json({ message: "Failed to list conversations" });
    }
  });

  app.post("/api/chat/conversations", requireAuth, requireTier("pro"), async (req: Request, res: Response) => {
    try {
      const {
        title,
        model,
        projectId,
        selectedSourceIds,
        citationStyle,
        tone,
        humanize,
        noEnDashes,
        writingModel,
      } = req.body || {};

      const normalizedWritingModel = writingModel === "extended" ? "extended" : "precision";
      const conv = await chatStorage.createConversation({
        title: title || "New Chat",
        model: model || MODELS.precision.chat,
        writingModel: normalizedWritingModel,
        userId: req.user!.userId,
        projectId: projectId || null,
        selectedSourceIds: selectedSourceIds || null,
        citationStyle: citationStyle || "chicago",
        tone: tone || "academic",
        humanize: humanize ?? true,
        noEnDashes: noEnDashes ?? false,
      });
      res.json(conv);
    } catch (error) {
      console.error("Error creating conversation:", error);
      res.status(500).json({ message: "Failed to create conversation" });
    }
  });

  app.get("/api/chat/conversations/:id", requireAuth, requireTier("pro"), async (req: Request, res: Response) => {
    try {
      const conv = await chatStorage.getConversation(req.params.id);
      if (!conv) {
        return res.status(404).json({ message: "Conversation not found" });
      }
      if (conv.userId && conv.userId !== req.user!.userId) {
        return res.status(403).json({ message: "Access denied" });
      }
      const messages = await chatStorage.getMessagesForConversation(conv.id);
      res.json({ ...conv, messages });
    } catch (error) {
      console.error("Error fetching conversation:", error);
      res.status(500).json({ message: "Failed to fetch conversation" });
    }
  });

  app.delete("/api/chat/conversations/:id", requireAuth, requireTier("pro"), async (req: Request, res: Response) => {
    try {
      const conv = await chatStorage.getConversation(req.params.id);
      if (!conv) {
        return res.status(404).json({ message: "Conversation not found" });
      }
      if (conv.userId && conv.userId !== req.user!.userId) {
        return res.status(403).json({ message: "Access denied" });
      }
      await chatStorage.deleteConversation(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting conversation:", error);
      res.status(500).json({ message: "Failed to delete conversation" });
    }
  });

  app.put("/api/chat/conversations/:id", requireAuth, requireTier("pro"), async (req: Request, res: Response) => {
    try {
      const {
        title,
        model,
        writingModel,
        citationStyle,
        tone,
        humanize,
        noEnDashes,
      } = req.body;

      const updates: Record<string, unknown> = {};
      if (title !== undefined) updates.title = title;
      if (model !== undefined) updates.model = model;
      if (writingModel !== undefined) updates.writingModel = writingModel === "extended" ? "extended" : "precision";
      if (citationStyle !== undefined) updates.citationStyle = citationStyle;
      if (tone !== undefined) updates.tone = tone;
      if (humanize !== undefined) updates.humanize = humanize;
      if (noEnDashes !== undefined) updates.noEnDashes = noEnDashes;

      const conv = await chatStorage.updateConversation(req.params.id, updates);
      res.json(conv);
    } catch (error) {
      console.error("Error updating conversation:", error);
      res.status(500).json({ message: "Failed to update conversation" });
    }
  });

  app.put("/api/chat/conversations/:id/sources", requireAuth, requireTier("pro"), async (req: Request, res: Response) => {
    try {
      const { selectedSourceIds } = req.body;
      if (!Array.isArray(selectedSourceIds)) {
        return res.status(400).json({ message: "selectedSourceIds must be an array" });
      }
      const conv = await chatStorage.updateSelectedSources(req.params.id, selectedSourceIds);
      res.json(conv);
    } catch (error) {
      console.error("Error updating sources:", error);
      res.status(500).json({ message: "Failed to update sources" });
    }
  });

  app.post("/api/chat/conversations/:id/messages", requireAuth, requireTier("pro"), async (req: Request, res: Response) => {
    try {
      const { content } = req.body;
      if (!content || typeof content !== "string") {
        return res.status(400).json({ message: "Content is required" });
      }

      const conv = await chatStorage.getConversation(req.params.id);
      if (!conv) {
        return res.status(404).json({ message: "Conversation not found" });
      }
      if (conv.userId && conv.userId !== req.user!.userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      await chatStorage.createMessage({
        conversationId: conv.id,
        role: "user",
        content,
      });

      let history = await chatStorage.getMessagesForConversation(conv.id);
      let anthropicMessages = toAnthropicMessages(history);
      const mode = getWritingMode(conv);
      const models = getModelsForConversation(conv);

      const { project, sources } = await loadConversationContext(conv, req.user!.userId);
      const isWritingConversation = Boolean(conv.projectId || conv.selectedSourceIds !== null);
      let systemPrompt = BASE_SYSTEM_PROMPT;
      if (isWritingConversation) {
        systemPrompt = buildWritingSystemPrompt(
          sources,
          project,
          conv.citationStyle || undefined,
          conv.tone || undefined,
          conv.humanize ?? true,
          conv.noEnDashes || false
        );
        if (mode === "precision") {
          systemPrompt += `\n\nPRECISION MODE:
A research gatherer has already collected the best evidence for this turn.
Do NOT emit <chunk_request> or <context_request> tags.
Use the gathered evidence, the accumulated clipboard, and the recent conversation context to answer directly.`;
        }
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      const anthropic = getAnthropicClient();
      const tieredSources = sources.filter((source): source is TieredSource => isTieredSource(source));
      const sourceTools = buildSourceTools();
      const executeSourceTool = createSourceToolExecutor(tieredSources);
      const clipboard: EvidenceClipboard = conv.evidenceClipboard
        ? deserializeClipboard(conv.evidenceClipboard)
        : createEmptyClipboard(project?.thesis || "");
      if (!clipboard.thesis && project?.thesis) {
        clipboard.thesis = project.thesis;
      }

      let effectiveCompactionSummary = conv.compactionSummary || null;
      let effectiveCompactedAtTurn = conv.compactedAtTurn || 0;
      if (mode === "precision") {
        const compactionResult = await compactConversation(
          anthropic,
          history.map((message) => ({ role: message.role, content: message.content })),
          effectiveCompactionSummary,
          effectiveCompactedAtTurn,
        );
        if (compactionResult) {
          effectiveCompactionSummary = compactionResult.summary;
          effectiveCompactedAtTurn = compactionResult.compactedAtTurn;
          await updateConversationCompaction(conv.id, {
            compactionSummary: compactionResult.summary,
            compactedAtTurn: compactionResult.compactedAtTurn,
          });
        }
      }

      let evidenceBrief: EvidenceBrief | null = null;
      let evidenceBriefText = "[No new evidence gathered for this turn]";
      let messagesForTurn = anthropicMessages;
      if (mode === "precision") {
        const sourceStubs: SourceStub[] = tieredSources.map((source) => ({
          docId: source.documentId,
          title: source.title || source.documentFilename,
          role: source.sourceRole || "evidence",
          summary: source.summary || undefined,
          annotationCount: source.annotations.length,
          chunkCount: source.chunkCount || 0,
        }));

        evidenceBrief = await gatherEvidence(
          anthropic,
          content,
          sourceStubs,
          clipboard,
          project?.thesis || "",
          sourceTools,
          executeSourceTool,
        );
        evidenceBriefText = formatEvidenceBrief(evidenceBrief);

        const compactedHistory = buildCompactedHistory(
          history.slice(0, -1).map((message) => ({ role: message.role, content: message.content })),
          formatClipboardForPrompt(clipboard),
          effectiveCompactionSummary,
          effectiveCompactedAtTurn,
        ).map((message) => ({
          role: message.role === "system" ? "assistant" : message.role,
          content: message.content,
        })) as AnthropicHistoryMessage[];

        const latestUserMessage = anthropicMessages[anthropicMessages.length - 1];
        messagesForTurn = latestUserMessage
          ? [
              ...compactedHistory,
              { role: "user", content: `[EVIDENCE GATHERED THIS TURN]\n${evidenceBriefText}` },
              {
                role: "assistant",
                content: "I have the evidence gathered for this turn and will use it selectively.",
              },
              latestUserMessage,
            ]
          : compactedHistory;
      }

      let closed = false;
      let activeStream: { abort: () => void } | null = null;
      let sentWarningLevel: ContextWarningLevel = "ok";

      const sendEvent = (payload: Record<string, unknown>) => {
        if (closed || res.writableEnded) return;
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      const sendContextWarningIfNeeded = (usage: ContextUsageEstimate) => {
        if (usage.warningLevel === "ok") return;
        if (usage.warningLevel === sentWarningLevel) return;
        sentWarningLevel = usage.warningLevel;

        if (usage.warningLevel === "critical") {
          sendEvent({
            type: "context_warning",
            message: "Context window is nearly full. Deep source analysis is disabled. Consider starting a new conversation.",
            available: usage.available,
          });
          return;
        }

        sendEvent({
          type: "context_warning",
          message: "Context is getting large. Source analysis may be limited.",
          available: usage.available,
        });
      };

      let usageEstimate = estimateContextUsage(systemPrompt, messagesForTurn, mode);
      sendContextWarningIfNeeded(usageEstimate);
      let deepDiveAllowed = usageEstimate.warningLevel !== "critical";

      const runTurn = async (messagesForTurn: AnthropicHistoryMessage[]): Promise<StreamTurnResult> => {
        return new Promise<StreamTurnResult>((resolve, reject) => {
          let fullText = "";
          const detectedRequests: ToolRequest[] = [];
          const parser = createDocumentStreamParser((event) => {
            if (closed || res.writableEnded) return;
            if (event.type === "chat_text") {
              const text = String(event.text ?? "");
              sendEvent({ type: "text", text });
            }
            sendEvent(event as Record<string, unknown>);
          });
          const toolParser = createToolRequestParser((request) => {
            detectedRequests.push(request);
          });

          const stream = anthropic.messages.stream({
            model: models.chat,
            max_tokens: CHAT_MAX_TOKENS,
            system: systemPrompt,
            messages: messagesForTurn,
          });

          activeStream = stream;

          stream.on("text", (text) => {
            fullText += text;
            parser.pushText(text);
            toolParser.pushText(text);
          });

          stream.on("message", (message) => {
            parser.finish();
            toolParser.finish();
            activeStream = null;

            resolve({
              fullText,
              usage: message.usage || {},
              toolRequests: detectedRequests,
            });
          });

          stream.on("error", (error) => {
            parser.finish();
            toolParser.finish();
            activeStream = null;

            if (closed) {
              resolve({
                fullText,
                usage: {},
                toolRequests: detectedRequests,
              });
              return;
            }
            reject(error);
          });
        });
      };

      req.on("close", () => {
        closed = true;
        activeStream?.abort();
      });

      const isFirstExchange = history.filter((message) => message.role === "user").length === 1;
      let hasAutoTitled = false;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let escalationCount = 0;

      while (!closed) {
        const turn = await runTurn(messagesForTurn);
        const inputTokens = turn.usage.input_tokens || 0;
        const outputTokens = turn.usage.output_tokens || 0;
        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;

        await chatStorage.createMessage({
          conversationId: conv.id,
          role: "assistant",
          content: turn.fullText,
          tokensUsed: inputTokens + outputTokens,
        });

        if (!hasAutoTitled && isFirstExchange && conv.title === "New Chat") {
          const autoTitle = content.length <= 50 ? content : `${content.slice(0, 47)}...`;
          await chatStorage.updateConversation(conv.id, { title: autoTitle });
          hasAutoTitled = true;
        }

        if (mode === "precision") {
          const updatedClipboard = await extractUsedEvidence(
            anthropic,
            turn.fullText,
            evidenceBriefText,
            clipboard,
            history.filter((message) => message.role === "user").length,
          );
          await updateConversationClipboard(conv.id, serializeClipboard(updatedClipboard));
          break;
        }

        const request = turn.toolRequests[turn.toolRequests.length - 1];
        if (!request || escalationCount >= MAX_CONTEXT_ESCALATIONS) {
          break;
        }

        let contextMessage = "";

        if (request.type === "chunk_request") {
          sendEvent({ type: "context_loading", level: 2, documentId: request.documentId });

          if (!request.annotationId) {
            contextMessage = "[CONTEXT RETRIEVAL - ERROR]\nMissing annotation_id in chunk request.";
          } else {
            const annotation = await projectStorage.getProjectAnnotation(request.annotationId);
            if (!annotation) {
              contextMessage = `[CONTEXT RETRIEVAL - ERROR]\nAnnotation "${request.annotationId}" was not found.`;
            } else {
              const projectDocument = await projectStorage.getProjectDocument(annotation.projectDocumentId);
              const resolvedDocumentId = projectDocument?.documentId || request.documentId;
              const chunkContext = await loadSurroundingChunks(
                resolvedDocumentId,
                annotation.startPosition,
                annotation.endPosition
              );
              contextMessage = `[CONTEXT RETRIEVAL - Surrounding text for annotation ${request.annotationId}]
Reason: ${request.reason || "No reason provided."}

${chunkContext}`;
            }
          }

          sendEvent({ type: "context_loaded", level: 2, documentId: request.documentId });
          void logToolCall({
            conversationId: conv.id,
            userId: req.user!.userId,
            projectId: conv.projectId ?? null,
            toolName: "chunk_request",
            documentId: request.documentId || null,
            escalationRound: escalationCount + 1,
            turnNumber: history.filter((m) => m.role === "user").length,
            resultSizeChars: contextMessage.length,
            success: !contextMessage.includes("ERROR"),
            timestamp: Date.now(),
          }).catch((err) => console.warn("[analytics] logToolCall error:", err));
        } else if (request.type === "context_request") {
          if (!deepDiveAllowed) {
            sendEvent({
              type: "context_warning",
              message: "Deep source analysis is disabled because the context window is nearly full.",
              available: usageEstimate.available,
            });
            break;
          }

          sendEvent({ type: "context_loading", level: 3, documentId: request.documentId });

          try {
            history = await chatStorage.getMessagesForConversation(conv.id);
            const recentWritingTopic = extractRecentWritingTopic(history);
            const sourceDocument = await storage.getDocument(request.documentId);

            if (!sourceDocument) {
              contextMessage = `[DEEP DIVE FINDINGS - ERROR]\nDocument "${request.documentId}" was not found.`;
              sendEvent({ type: "context_loaded", level: 3, findingCount: 0 });
            } else {
              const researchResult = await runResearchAgent(
                request.documentId,
                request.reason || "Comprehensive source review requested.",
                {
                  thesis: project?.thesis || null,
                  scope: project?.scope || null,
                  recentWritingTopic,
                }
              );
              contextMessage = formatDeepDiveFindings(
                sourceDocument.filename,
                researchResult.findings
              );
              sendEvent({
                type: "context_loaded",
                level: 3,
                findingCount: researchResult.findings.length,
                tokensUsed: researchResult.tokensUsed,
              });
            }
          } catch (researchError) {
            console.error("Research agent error:", researchError);
            contextMessage = `[DEEP DIVE FINDINGS - ERROR]\n${
              researchError instanceof Error ? researchError.message : "Research agent failed."
            }`;
            sendEvent({ type: "context_loaded", level: 3, findingCount: 0 });
          }
          void logToolCall({
            conversationId: conv.id,
            userId: req.user!.userId,
            projectId: conv.projectId ?? null,
            toolName: "context_request",
            documentId: request.documentId || null,
            escalationRound: escalationCount + 1,
            turnNumber: history.filter((m) => m.role === "user").length,
            resultSizeChars: contextMessage.length,
            success: !contextMessage.includes("ERROR"),
            timestamp: Date.now(),
          }).catch((err) => console.warn("[analytics] logToolCall error:", err));
        }

        if (!contextMessage.trim()) {
          break;
        }

        await chatStorage.createMessage({
          conversationId: conv.id,
          role: "user",
          content: contextMessage,
        });

        history = await chatStorage.getMessagesForConversation(conv.id);
        anthropicMessages = toAnthropicMessages(history);
        messagesForTurn = anthropicMessages;
        usageEstimate = estimateContextUsage(systemPrompt, messagesForTurn, mode);
        void logContextSnapshot({
          conversationId: conv.id,
          turnNumber: history.filter((m) => m.role === "user").length,
          escalationRound: escalationCount + 1,
          estimatedTokens: usageEstimate.totalUsed,
          warningLevel: usageEstimate.warningLevel,
          trigger: request.type,
          timestamp: Date.now(),
          metadata: { documentId: request.documentId || null },
        }).catch((err) => console.warn("[analytics] logContextSnapshot error:", err));
        sendContextWarningIfNeeded(usageEstimate);
        deepDiveAllowed = usageEstimate.warningLevel !== "critical";
        escalationCount += 1;
      }

      if (!closed && !res.writableEnded) {
        sendEvent({
          type: "done",
          usage: {
            input_tokens: totalInputTokens,
            output_tokens: totalOutputTokens,
          },
        });
        res.end();
      }
    } catch (error) {
      console.error("Error sending message:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to send message" });
      } else {
        res.write(`data: ${JSON.stringify({ type: "error", error: "Internal server error" })}\n\n`);
        res.end();
      }
    }
  });

  app.post("/api/chat/conversations/:id/compile", requireAuth, requireTier("pro"), async (req: Request, res: Response) => {
    try {
      const conv = await chatStorage.getConversation(req.params.id);
      if (!conv) {
        return res.status(404).json({ message: "Conversation not found" });
      }
      if (conv.userId && conv.userId !== req.user!.userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { citationStyle, tone, noEnDashes } = req.body;
      const style = citationStyle || conv.citationStyle || "chicago";
      const writingTone = tone || conv.tone || "academic";
      const avoidDashes = noEnDashes ?? conv.noEnDashes ?? false;
      const models = getModelsForConversation(conv);

      const history = await chatStorage.getMessagesForConversation(conv.id);
      if (history.length === 0) {
        return res.status(400).json({ message: "No conversation to compile" });
      }

      const transcript = history
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => `[${message.role.toUpperCase()}]: ${message.content}`)
        .join("\n\n---\n\n");

      const { project, sources } = await loadConversationContext(conv, req.user!.userId);
      const projectContextBlock = buildProjectContextBlock(project);
      const sourcesBlock = sources.length > 0
        ? `\n\nSOURCE MATERIALS:\n${buildSourceBlock(sources)}`
        : "";

      const noEnDashesRule = avoidDashes
        ? "\n11. NEVER use em-dashes or en-dashes. Use commas, periods, or semicolons instead."
        : "";

      const compilePrompt = `You are assembling a final academic paper from a writing conversation.
The student and AI have been collaboratively drafting sections.

${projectContextBlock}
Target citation style: ${style.toUpperCase()}
Target tone: ${prettyToneLabel(writingTone)}

RULES:
1. Include every piece of substantive writing the assistant produced.
2. Preserve the student's thesis and argument structure.
3. Do NOT summarize or shorten sections. Include draft content in full unless superseded by a later revision.
4. If the same topic or section was revised multiple times, use the LATEST version.
5. Remove conversational chatter and keep only polished paper content.
6. Add only what is required to unify the paper: transitions, a unified introduction (if missing), and a conclusion that synthesizes the argument.
7. Use footnotes for citations ([^1], [^2], etc.) throughout the paper.
8. Include footnote definitions immediately before the bibliography.
9. Compile a bibliography from all cited sources using ${style.toUpperCase()} format.
10. Write naturally: vary sentence length, prefer active voice, and avoid filler phrases.
11. Do not fabricate source details not grounded in the provided sources.${noEnDashesRule}
12. Output clean markdown using ## section headings.

CONVERSATION TRANSCRIPT:
${transcript}${sourcesBlock}`;

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      const anthropic = getAnthropicClient();
      let aborted = false;

      req.on("close", () => {
        aborted = true;
      });

      const stream = anthropic.messages.stream({
        model: models.compile,
        max_tokens: COMPILE_MAX_TOKENS,
        messages: [{ role: "user", content: compilePrompt }],
      });

      stream.on("text", (text) => {
        if (!aborted) {
          res.write(`data: ${JSON.stringify({ type: "text", text })}\n\n`);
        }
      });

      stream.on("message", () => {
        if (aborted) return;
        res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
        res.end();
      });

      stream.on("error", (error) => {
        console.error("Compile stream error:", error);
        if (!aborted) {
          res.write(
            `data: ${JSON.stringify({ type: "error", error: error instanceof Error ? error.message : "Compile failed" })}\n\n`
          );
          res.end();
        }
      });
    } catch (error) {
      console.error("Compile error:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to compile paper" });
      } else {
        res.write(`data: ${JSON.stringify({ type: "error", error: "Compile failed" })}\n\n`);
        res.end();
      }
    }
  });

  app.post("/api/chat/conversations/:id/verify", requireAuth, requireTier("pro"), async (req: Request, res: Response) => {
    try {
      const conv = await chatStorage.getConversation(req.params.id);
      if (!conv) {
        return res.status(404).json({ message: "Conversation not found" });
      }
      if (conv.userId && conv.userId !== req.user!.userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { compiledContent } = req.body;
      if (!compiledContent || typeof compiledContent !== "string") {
        return res.status(400).json({ message: "compiledContent is required" });
      }

      const models = getModelsForConversation(conv);
      const style = conv.citationStyle || "chicago";
      const { project, sources } = await loadConversationContext(conv, req.user!.userId);
      const projectContextBlock = buildProjectContextBlock(project);
      const sourcesBlock = sources.length > 0
        ? `\n\nSOURCE MATERIALS FOR VERIFICATION:\n${buildSourceBlock(sources)}`
        : "\n\nSOURCE MATERIALS FOR VERIFICATION:\nNo attached source materials were provided.";

      const verifyPrompt = `You are an academic paper reviewer performing strict source and citation verification.

${projectContextBlock}
Citation style to enforce: ${style.toUpperCase()}

Verification requirements:
1. Cross-reference every direct quote against the provided source text.
2. Check whether paraphrases accurately reflect the source content.
3. Verify page numbers or section references where they are provided.
4. Flag any citation that does not correspond to the provided sources.
5. Check footnote numbering consistency and formatting correctness.
6. Check citation and bibliography formatting consistency in ${style.toUpperCase()}.
7. Identify unsupported or over-claimed assertions.
8. Review logical flow, argument coherence, tone consistency, and major grammar issues.

Output format:
- Executive summary (2-4 sentences)
- Findings (numbered, highest severity first)
- Each finding must include: location/passage, issue, and concrete fix
- Strengths (optional)

PAPER TO REVIEW:
${compiledContent}${sourcesBlock}`;

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      const anthropic = getAnthropicClient();
      let aborted = false;

      req.on("close", () => {
        aborted = true;
      });

      const stream = anthropic.messages.stream({
        model: models.verify,
        max_tokens: VERIFY_MAX_TOKENS,
        messages: [{ role: "user", content: verifyPrompt }],
      });

      stream.on("text", (text) => {
        if (!aborted) {
          res.write(`data: ${JSON.stringify({ type: "text", text })}\n\n`);
        }
      });

      stream.on("message", () => {
        if (!aborted) {
          res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
          res.end();
        }
      });

      stream.on("error", (error) => {
        console.error("Verify stream error:", error);
        if (!aborted) {
          res.write(
            `data: ${JSON.stringify({ type: "error", error: error instanceof Error ? error.message : "Verify failed" })}\n\n`
          );
          res.end();
        }
      });
    } catch (error) {
      console.error("Verify error:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to verify paper" });
      } else {
        res.write(`data: ${JSON.stringify({ type: "error", error: "Verify failed" })}\n\n`);
        res.end();
      }
    }
  });
}
