import type { Express, Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { and, eq, inArray } from "drizzle-orm";
import { chatStorage } from "./chatStorage";
import { db } from "./db";
import { projectStorage } from "./projectStorage";
import { storage } from "./storage";
import { logContextSnapshot, logToolCall } from "./analyticsLogger";
import { requireAuth, requireTier } from "./auth";
import {
  formatSourceForPrompt,
  formatSourceForPromptTiered,
  formatSourceStubForPrompt,
  formatWebClipStubForPrompt,
  type TieredSource,
  type WritingSource,
} from "./writingPipeline";
import { clipText, buildAuthorLabel } from "./writingRoutes";
import {
  extractRecentWritingTopic,
  runResearchAgent,
  type ResearchFinding,
} from "./researchAgent";
import {
  webClips,
  type CitationData,
  type Conversation,
  type Message,
  type Project,
} from "@shared/schema";
import { buildProjectAnnotationJumpPath, buildTextFingerprint } from "@shared/annotationLinks";
import { applyJumpLinksToMarkdown, type QuoteJumpTarget } from "./quoteJumpLinks";

const MAX_SOURCE_EXCERPT_CHARS = 2000;
const MAX_SOURCE_FULLTEXT_CHARS = 30000;
const MAX_SOURCE_TOTAL_FULLTEXT_CHARS = 150000;
const CHAT_MAX_TOKENS = 8192;
const COMPILE_MAX_TOKENS = 8192;
const VERIFY_MAX_TOKENS = 8192;
const MAX_CONTEXT_ESCALATIONS = 4;
const USE_NATIVE_TOOL_USE = true;

const MODELS = {
  precision: {
    chat: "claude-opus-4-6",
    compile: "claude-opus-4-6",
    verify: "claude-opus-4-6",
  },
  extended: {
    chat: "claude-sonnet-4-5-20250929",
    compile: "claude-sonnet-4-5-20250929",
    verify: "claude-sonnet-4-5-20250929",
  },
  research: "claude-sonnet-4-5-20250929",
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

/** Strip tool-request XML blocks from text before persisting to chat history. */
function stripToolTagsForStorage(text: string): string {
  return text.replace(/<(chunk_request|context_request)\b[^>]*>[\s\S]*?<\/\1>/gi, "").trim();
}

/** Marker prefix used for internal context injection messages (not shown to users). */
const INTERNAL_CONTEXT_PREFIX = "[CONTEXT RETRIEVAL" as const;
const INTERNAL_DEEP_DIVE_PREFIX = "[DEEP DIVE FINDINGS" as const;

/** Check if a message is an internally-injected context payload (not user-authored). */
function isInternalContextMessage(msg: Pick<Message, "role" | "content">): boolean {
  if (msg.role !== "user") return false;
  const trimmed = msg.content.trimStart();
  return trimmed.startsWith(INTERNAL_CONTEXT_PREFIX) || trimmed.startsWith(INTERNAL_DEEP_DIVE_PREFIX);
}
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
type AnthropicHistoryMessage = Anthropic.MessageParam;
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
  toolUseBlocks: Anthropic.ToolUseBlock[];
  stopReason: string | null;
  assistantContentBlocks: Anthropic.ContentBlock[];
}

const WRITING_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_source_summary",
    description:
      "Load the AI summary, main arguments, and key concepts for one source so you can decide whether to use it.",
    input_schema: {
      type: "object",
      properties: {
        document_id: {
          type: "string",
          description: "Document ID from the source stub.",
        },
      },
      required: ["document_id"],
    },
  },
  {
    name: "get_source_annotations",
    description:
      "Load annotations for a source, including quote text, categories, notes, and positions.",
    input_schema: {
      type: "object",
      properties: {
        document_id: {
          type: "string",
          description: "Document ID from the source stub.",
        },
      },
      required: ["document_id"],
    },
  },
  {
    name: "get_source_chunks",
    description:
      "Load surrounding chunks for more context around an annotation or focused query.",
    input_schema: {
      type: "object",
      properties: {
        document_id: {
          type: "string",
          description: "Document ID from the source stub.",
        },
        annotation_id: {
          type: "string",
          description: "Optional annotation ID to center the chunk retrieval.",
        },
        focus_query: {
          type: "string",
          description: "Optional query for selecting a relevant chunk region.",
        },
      },
      required: ["document_id"],
    },
  },
  {
    name: "get_web_clips",
    description:
      "Load web clip evidence for this project (or selected standalone clips when not in a project).",
    input_schema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "Optional project ID. If omitted, the active conversation context is used.",
        },
      },
    },
  },
];

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

function toolResultContentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const block = item as unknown as Record<string, unknown>;
      if (block.type === "text" && typeof block.text === "string") {
        return block.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function messageContentToText(content: Anthropic.MessageParam["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const typed = block as unknown as Record<string, unknown>;

      if (typed.type === "text" && typeof typed.text === "string") {
        return typed.text;
      }
      if (typed.type === "tool_use") {
        const name = typeof typed.name === "string" ? typed.name : "tool";
        const inputText = typed.input ? JSON.stringify(typed.input) : "";
        return `[TOOL ${name}] ${inputText}`;
      }
      if (typed.type === "tool_result") {
        return toolResultContentToText(typed.content);
      }

      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function estimateContextUsage(
  systemPrompt: string,
  messages: AnthropicHistoryMessage[],
  mode: WritingMode
): ContextUsageEstimate {
  const limit = TOKEN_LIMITS[mode];
  const systemTokens = estimateTokens(systemPrompt);
  const historyTokens = messages.reduce(
    (sum, message) => sum + estimateTokens(messageContentToText(message.content)),
    0
  );
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

function buildSourceStubBlock(sources: PromptSource[]): string {
  if (sources.length === 0) {
    return "No explicit source materials are attached to this conversation.";
  }

  return sources
    .map((source, i) => {
      const sourceText = isTieredSource(source)
        ? formatSourceStubForPrompt(source)
        : formatWebClipStubForPrompt(source);
      return `--- Source ${i + 1} ---\n${sourceText}`;
    })
    .join("\n\n");
}

function collectConversationQuoteTargets(sources: PromptSource[]): QuoteJumpTarget[] {
  const targets: QuoteJumpTarget[] = [];

  for (const source of sources) {
    if (isTieredSource(source)) {
      for (const annotation of source.annotations) {
        targets.push({
          quote: annotation.highlightedText,
          jumpPath: buildProjectAnnotationJumpPath({
            projectId: source.projectId,
            projectDocumentId: source.id,
            annotationId: annotation.id,
            startPosition: annotation.startPosition,
            anchorFingerprint: buildTextFingerprint(annotation.highlightedText),
          }),
        });
      }
      continue;
    }

    const explicitTargets = source.quoteTargets || [];
    if (explicitTargets.length > 0) {
      targets.push(...explicitTargets);
      continue;
    }

    if (source.annotationJumpPath && source.excerpt) {
      targets.push({ quote: source.excerpt, jumpPath: source.annotationJumpPath });
    }
  }

  return targets;
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

function containsDocumentTag(value: string): boolean {
  return /<document\s+title=/i.test(value);
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
      annotations,
      excerpt,
      documentId: fullDoc.id,
      projectId,
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
  const sourceMaterials = USE_NATIVE_TOOL_USE
    ? buildSourceStubBlock(sources)
    : buildSourceBlock(sources);
  const contextToolsBlock = USE_NATIVE_TOOL_USE
    ? `CONTEXT TOOLS:
You have native tools to load source context on demand. The source list above is stub-only.

Escalation strategy:
1. Start with get_source_summary() for sources likely relevant to the user's request.
2. For usable evidence, call get_source_annotations().
3. For deeper quote context, call get_source_chunks().
4. Use get_web_clips() when web evidence is needed.

Use tools proactively and only load what is needed. After deciding what evidence you will use, stop calling tools and write the response.
Do not ask the student to provide context you can retrieve with tools.`
    : `CONTEXT TOOLS:
You are seeing annotated highlights and summaries from each source. This is your primary working material.

If you need surrounding context for a specific annotation, output exactly:
<chunk_request annotation_id="ANNOTATION_ID" document_id="DOCUMENT_ID">
Brief reason for requesting surrounding context
</chunk_request>

If you need a full-source deep dive, output exactly:
<context_request document_id="DOCUMENT_ID">
What you need from the full source and why
</context_request>`;
  const quotingRulesBlock = USE_NATIVE_TOOL_USE
    ? `QUOTING RULES:
- Quotes from get_source_annotations() are pre-verified from annotation data.
- If you quote from get_source_chunks(), mention that it came from full-text chunk context.
- Include annotation ID or character position when citing evidence.
- Do not fabricate quotes.`
    : `QUOTING RULES:
- Quotes from annotation blocks are pre-verified.
- If you quote from chunk retrieval or deep dive findings, mention that it came from full-text review.
- Include annotation ID or character position when citing evidence.
- Do not fabricate quotes.`;

  return `You are ScholarMark AI, an expert academic writing partner. You are collaborating with a student on a research paper.

${buildProjectContextBlock(project)}

You have access to ${sources.length} source document(s).

SOURCE MATERIALS:
${sourceMaterials}

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

Do not fabricate quotations, publication details, page numbers, or bibliography metadata. If source detail is uncertain, state uncertainty clearly and cite conservatively.${writingStyleBlock}

${contextToolsBlock}

${quotingRulesBlock}

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

function getToolContextLevel(toolName: string): number {
  switch (toolName) {
    case "get_source_summary":
    case "get_web_clips":
      return 1;
    case "get_source_annotations":
    case "get_source_chunks":
      return 2;
    default:
      return 2;
  }
}

function normalizeToolInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
}

function getToolInputString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveTieredSource(documentOrSourceId: string, sources: PromptSource[]): TieredSource | null {
  const target = documentOrSourceId.trim();
  if (!target) return null;

  for (const source of sources) {
    if (!isTieredSource(source)) continue;
    if (source.documentId === target || source.id === target) {
      return source;
    }
  }

  return null;
}

function resolveSourceTitle(documentOrSourceId: string, sources: PromptSource[]): string | null {
  const target = documentOrSourceId.trim();
  if (!target) return null;

  const tiered = resolveTieredSource(target, sources);
  if (tiered?.title) {
    return tiered.title;
  }

  for (const source of sources) {
    if (isTieredSource(source)) continue;
    if (source.id !== target) continue;
    return source.title || target;
  }

  return null;
}

function extractUrlFromStandaloneSource(source: WritingSource): string {
  if (source.citationData?.url) {
    return source.citationData.url;
  }
  const match = source.fullText.match(/^\s*URL:\s*(\S+)\s*$/im);
  return match?.[1] || "URL unavailable";
}

function countCategoryValues(annotations: TieredSource["annotations"]): string {
  const categoryCounts = new Map<string, number>();
  for (const annotation of annotations) {
    const key = annotation.category || "uncategorized";
    categoryCounts.set(key, (categoryCounts.get(key) || 0) + 1);
  }
  if (categoryCounts.size === 0) return "None";
  return Array.from(categoryCounts.entries())
    .map(([category, count]) => `${category}: ${count}`)
    .join(", ");
}

async function executeWritingTool(
  toolName: string,
  rawToolInput: unknown,
  userId: string,
  projectId: string | null | undefined,
  sources: PromptSource[]
): Promise<string> {
  const toolInput = normalizeToolInput(rawToolInput);

  switch (toolName) {
    case "get_source_summary": {
      const requestedId = getToolInputString(toolInput, "document_id");
      if (!requestedId) {
        return "Missing required field: document_id.";
      }

      const source = resolveTieredSource(requestedId, sources);
      if (!source) {
        return `Source "${requestedId}" is not available in this conversation.`;
      }

      const document = await storage.getDocument(source.documentId);
      if (!document) {
        return `Document "${source.documentId}" was not found.`;
      }

      const lines: string[] = [
        `[SOURCE SUMMARY] ${source.title}`,
        `Source ID: ${source.id}`,
        `Document ID: ${source.documentId}`,
      ];

      if (document.summary) {
        lines.push("", `Summary: ${document.summary}`);
      }
      if (document.mainArguments?.length) {
        lines.push(
          "",
          "Main arguments:",
          ...document.mainArguments.map((argument, index) => `${index + 1}. ${argument}`)
        );
      }
      if (document.keyConcepts?.length) {
        lines.push("", `Key concepts: ${document.keyConcepts.join(", ")}`);
      }
      if (source.roleInProject) {
        lines.push("", `Role in project: ${source.roleInProject}`);
      }
      if (source.projectContext) {
        lines.push("", `Project context note: ${source.projectContext}`);
      }

      if (lines.length <= 3) {
        lines.push("", "No AI summary fields are available for this source yet.");
      }

      return lines.join("\n");
    }

    case "get_source_annotations": {
      const requestedId = getToolInputString(toolInput, "document_id");
      if (!requestedId) {
        return "Missing required field: document_id.";
      }

      const source = resolveTieredSource(requestedId, sources);
      if (!source) {
        return `Source "${requestedId}" is not available in this conversation.`;
      }

      const annotations = await projectStorage.getProjectAnnotationsByDocument(source.id);
      if (annotations.length === 0) {
        return `No annotations found for source "${source.title}" (${source.id}).`;
      }

      const document = await storage.getDocument(source.documentId);
      const lines: string[] = [
        `[SOURCE ANNOTATIONS] ${source.title}`,
        `Source ID: ${source.id}`,
        `Document ID: ${source.documentId}`,
        `Annotation count: ${annotations.length}`,
        `Category distribution: ${countCategoryValues(annotations)}`,
      ];

      if (document?.summary) {
        lines.push("", `Importance summary: ${document.summary}`);
      }

      lines.push("");
      for (const annotation of annotations) {
        const confidence =
          typeof annotation.confidenceScore === "number"
            ? ` | Confidence: ${annotation.confidenceScore.toFixed(2)}`
            : "";
        lines.push(`[ANNOTATION ${annotation.id}] Category: ${annotation.category}${confidence}`);
        lines.push(`"${annotation.highlightedText}"`);
        if (annotation.note) {
          lines.push(`Note: ${annotation.note}`);
        }
        lines.push(`Position: chars ${annotation.startPosition}-${annotation.endPosition}`);
        lines.push(
          `Jump Link: ${buildProjectAnnotationJumpPath({
            projectId: source.projectId,
            projectDocumentId: source.id,
            annotationId: annotation.id,
            startPosition: annotation.startPosition,
            anchorFingerprint: buildTextFingerprint(annotation.highlightedText),
          })}`
        );
        lines.push("");
      }

      return lines.join("\n");
    }

    case "get_source_chunks": {
      const requestedId = getToolInputString(toolInput, "document_id");
      if (!requestedId) {
        return "Missing required field: document_id.";
      }

      const source = resolveTieredSource(requestedId, sources);
      if (!source) {
        return `Source "${requestedId}" is not available in this conversation.`;
      }

      const annotationId = getToolInputString(toolInput, "annotation_id");
      if (annotationId) {
        const sourceAnnotation = source.annotations.find((annotation) => annotation.id === annotationId);
        const annotation = sourceAnnotation || (await projectStorage.getProjectAnnotation(annotationId));
        if (!annotation) {
          return `Annotation "${annotationId}" was not found.`;
        }
        if (annotation.projectDocumentId !== source.id) {
          return `Annotation "${annotationId}" does not belong to source "${source.id}".`;
        }

        return loadSurroundingChunks(
          source.documentId,
          annotation.startPosition,
          annotation.endPosition
        );
      }

      const focusQuery = getToolInputString(toolInput, "focus_query");
      if (focusQuery) {
        const chunks = await storage.getChunksForDocument(source.documentId);
        if (chunks.length === 0) {
          return "[SURROUNDING CONTEXT unavailable]\nNo chunked text is available for this document.";
        }

        const queryTerms = focusQuery
          .toLowerCase()
          .split(/\s+/)
          .map((term) => term.trim())
          .filter((term) => term.length >= 3);

        let bestChunk = chunks[0];
        let bestScore = -1;

        for (const chunk of chunks) {
          const text = chunk.text.toLowerCase();
          let score = 0;
          for (const term of queryTerms) {
            if (text.includes(term)) {
              score += 1;
            }
          }
          if (score > bestScore) {
            bestScore = score;
            bestChunk = chunk;
          }
        }

        const context = await loadSurroundingChunks(
          source.documentId,
          bestChunk.startPosition,
          bestChunk.endPosition
        );
        return `[FOCUS QUERY] ${focusQuery}\n${context}`;
      }

      return loadSurroundingChunks(source.documentId, 0, 500);
    }

    case "get_web_clips": {
      const requestedProjectId = getToolInputString(toolInput, "project_id") || projectId || undefined;

      if (requestedProjectId) {
        const clips = await db
          .select()
          .from(webClips)
          .where(eq(webClips.projectId, requestedProjectId));

        if (clips.length === 0) {
          return `No web clips were found for project "${requestedProjectId}".`;
        }

        return clips
          .map((clip) => {
            const clipNote = clip.note || "No note";
            const highlight = clip.highlightedText || "No highlighted text";
            return [
              `[CLIP ${clip.id}]`,
              `Title: ${clip.pageTitle}`,
              `URL: ${clip.sourceUrl}`,
              `Highlight: "${highlight}"`,
              `Note: ${clipNote}`,
            ].join("\n");
          })
          .join("\n\n");
      }

      const standaloneClips = sources.filter((source): source is WritingSource => !isTieredSource(source));
      if (standaloneClips.length === 0) {
        return "No selected standalone web clips are available in this conversation.";
      }

      return standaloneClips
        .map((clip) =>
          [
            `[CLIP ${clip.id}]`,
            `Title: ${clip.title}`,
            `URL: ${extractUrlFromStandaloneSource(clip)}`,
            `Highlight: "${clip.excerpt}"`,
            `Note: ${clip.note || "No note"}`,
          ].join("\n")
        )
        .join("\n\n");
    }

    default:
      return `Unknown tool "${toolName}".`;
  }
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
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      const anthropic = getAnthropicClient();
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
            message: "Context window is nearly full. Further source retrieval may be limited. Consider starting a new conversation.",
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

      let usageEstimate = estimateContextUsage(systemPrompt, anthropicMessages, mode);
      sendContextWarningIfNeeded(usageEstimate);
      let deepDiveAllowed = usageEstimate.warningLevel !== "critical";
      const toolUseEnabled = USE_NATIVE_TOOL_USE && isWritingConversation;

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
          const toolParser = toolUseEnabled
            ? null
            : createToolRequestParser((request) => {
              detectedRequests.push(request);
            });

          const streamParams: Anthropic.MessageStreamParams = {
            model: models.chat,
            max_tokens: CHAT_MAX_TOKENS,
            system: systemPrompt,
            messages: messagesForTurn,
          };
          if (toolUseEnabled) {
            streamParams.tools = WRITING_TOOLS;
          }

          const stream = anthropic.messages.stream(streamParams);

          activeStream = stream;

          stream.on("text", (text) => {
            fullText += text;
            parser.pushText(text);
            toolParser?.pushText(text);
          });

          stream.on("message", (message) => {
            parser.finish();
            toolParser?.finish();
            activeStream = null;

            const assistantContentBlocks = message.content || [];
            const fullTextFromContent = assistantContentBlocks
              .filter((block): block is Anthropic.TextBlock => block.type === "text")
              .map((block) => block.text)
              .join("");
            const toolUseBlocks = assistantContentBlocks.filter(
              (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
            );

            resolve({
              fullText: fullTextFromContent || fullText,
              usage: message.usage || {},
              toolRequests: detectedRequests,
              toolUseBlocks,
              stopReason: message.stop_reason || null,
              assistantContentBlocks,
            });
          });

          stream.on("error", (error) => {
            parser.finish();
            toolParser?.finish();
            activeStream = null;

            if (closed) {
              resolve({
                fullText,
                usage: {},
                toolRequests: detectedRequests,
                toolUseBlocks: [],
                stopReason: null,
                assistantContentBlocks: [],
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
      const turnNumber = history
        .filter((message) => message.role === "user")
        .filter((message) => !isInternalContextMessage(message)).length;
      let hasAutoTitled = false;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let escalationCount = 0;
      let finalAssistantText = "";

      while (!closed) {
        const turn = await runTurn(anthropicMessages);
        const inputTokens = turn.usage.input_tokens || 0;
        const outputTokens = turn.usage.output_tokens || 0;
        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;

        if (toolUseEnabled) {
          const hasToolCalls = turn.stopReason === "tool_use" && turn.toolUseBlocks.length > 0;
          if (hasToolCalls) {
            if (usageEstimate.warningLevel === "critical") {
              sendEvent({
                type: "context_warning",
                message: "Context window nearly full. Writing with currently loaded context.",
                available: usageEstimate.available,
              });
              break;
            }

            if (escalationCount >= MAX_CONTEXT_ESCALATIONS) {
              sendEvent({
                type: "context_warning",
                message: `Tool escalation limit reached (${MAX_CONTEXT_ESCALATIONS}). Writing with currently loaded context.`,
                available: usageEstimate.available,
              });
              break;
            }

            const toolResults: Anthropic.ToolResultBlockParam[] = [];

            for (const toolCall of turn.toolUseBlocks) {
              const parsedInput = normalizeToolInput(toolCall.input);
              const level = getToolContextLevel(toolCall.name);
              const documentId = getToolInputString(parsedInput, "document_id");
              const sourceTitle = documentId
                ? resolveSourceTitle(documentId, sources) || documentId
                : undefined;

              sendEvent({
                type: "context_loading",
                level,
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                documentId,
                sourceTitle,
              });

              let toolOutput = "";
              try {
                toolOutput = await executeWritingTool(
                  toolCall.name,
                  toolCall.input,
                  req.user!.userId,
                  conv.projectId,
                  sources
                );
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : "Unknown tool execution error";
                void logToolCall({
                  conversationId: conv.id,
                  userId: req.user!.userId,
                  projectId: conv.projectId ?? null,
                  toolName: toolCall.name,
                  documentId: documentId || null,
                  escalationRound: escalationCount + 1,
                  turnNumber,
                  resultSizeChars: errorMessage.length,
                  success: false,
                  timestamp: Date.now(),
                  metadata: {
                    toolCallId: toolCall.id,
                    error: errorMessage,
                  },
                }).catch((err) => console.warn("[analytics] logToolCall error:", err));
                throw error;
              }

              toolResults.push({
                type: "tool_result",
                tool_use_id: toolCall.id,
                content: toolOutput,
              });
              void logToolCall({
                conversationId: conv.id,
                userId: req.user!.userId,
                projectId: conv.projectId ?? null,
                toolName: toolCall.name,
                documentId: documentId || null,
                escalationRound: escalationCount + 1,
                turnNumber,
                resultSizeChars: toolOutput.length,
                success: true,
                timestamp: Date.now(),
                metadata: {
                  toolCallId: toolCall.id,
                  sourceTitle: sourceTitle ?? null,
                },
              }).catch((err) => console.warn("[analytics] logToolCall error:", err));

              sendEvent({
                type: "context_loaded",
                level,
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                documentId,
                sourceTitle,
              });
            }

            sendEvent({ type: "tool_round_complete", round: escalationCount + 1 });

            anthropicMessages.push(
              { role: "assistant", content: turn.assistantContentBlocks },
              { role: "user", content: toolResults }
            );
            usageEstimate = estimateContextUsage(systemPrompt, anthropicMessages, mode);
            void logContextSnapshot({
              conversationId: conv.id,
              turnNumber,
              escalationRound: escalationCount + 1,
              estimatedTokens: usageEstimate.totalUsed,
              warningLevel: usageEstimate.warningLevel,
              trigger: turn.toolUseBlocks.map((block) => block.name).join(",") || null,
              timestamp: Date.now(),
              metadata: {
                toolCount: turn.toolUseBlocks.length,
              },
            }).catch((err) => console.warn("[analytics] logContextSnapshot error:", err));
            sendContextWarningIfNeeded(usageEstimate);
            escalationCount += 1;
            continue;
          }

          const cleanedTurnText = stripToolTagsForStorage(turn.fullText);
          finalAssistantText = applyJumpLinksToMarkdown(
            cleanedTurnText,
            collectConversationQuoteTargets(sources)
          );
          if (!containsDocumentTag(finalAssistantText) && finalAssistantText !== cleanedTurnText) {
            sendEvent({ type: "replace_text", text: finalAssistantText });
          }
          break;
        }

        // Legacy XML path: keep prior behavior for rollback safety.
        const cleanedAssistantText = applyJumpLinksToMarkdown(
          stripToolTagsForStorage(turn.fullText),
          collectConversationQuoteTargets(sources)
        );
        if (cleanedAssistantText.length > 0) {
          await chatStorage.createMessage({
            conversationId: conv.id,
            role: "assistant",
            content: cleanedAssistantText,
            tokensUsed: inputTokens + outputTokens,
          });
        }

        if (!hasAutoTitled && isFirstExchange && conv.title === "New Chat") {
          const autoTitle = content.length <= 50 ? content : `${content.slice(0, 47)}...`;
          await chatStorage.updateConversation(conv.id, { title: autoTitle });
          hasAutoTitled = true;
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
        }

        if (!contextMessage.trim()) {
          break;
        }

        // Keep context injections in-memory only — don't persist them to chat
        // history so they won't show up as user bubbles in the UI. The Anthropic
        // message array carries them for multi-turn escalation within this request.
        anthropicMessages.push(
          { role: "assistant", content: turn.fullText },
          { role: "user", content: contextMessage },
        );
        usageEstimate = estimateContextUsage(systemPrompt, anthropicMessages, mode);
        sendContextWarningIfNeeded(usageEstimate);
        deepDiveAllowed = usageEstimate.warningLevel !== "critical";
        escalationCount += 1;
      }

      if (toolUseEnabled) {
        const cleanedFinalText = finalAssistantText.trim();
        if (cleanedFinalText.length > 0) {
          await chatStorage.createMessage({
            conversationId: conv.id,
            role: "assistant",
            content: cleanedFinalText,
            tokensUsed: totalInputTokens + totalOutputTokens,
          });
        }

        if (!hasAutoTitled && isFirstExchange && conv.title === "New Chat") {
          const autoTitle = content.length <= 50 ? content : `${content.slice(0, 47)}...`;
          await chatStorage.updateConversation(conv.id, { title: autoTitle });
          hasAutoTitled = true;
        }
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
        .filter((message) => !isInternalContextMessage(message))
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
      let compiledText = "";
      const compileQuoteTargets = collectConversationQuoteTargets(sources);

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
          compiledText += text;
          res.write(`data: ${JSON.stringify({ type: "text", text })}\n\n`);
        }
      });

      stream.on("message", () => {
        if (aborted) return;
        const linkedText = applyJumpLinksToMarkdown(compiledText, compileQuoteTargets);
        if (linkedText && linkedText !== compiledText) {
          res.write(`data: ${JSON.stringify({ type: "replace_text", text: linkedText })}\n\n`);
        }
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
