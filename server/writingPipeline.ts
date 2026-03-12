import Anthropic from "@anthropic-ai/sdk";
import type { CitationData, ProjectAnnotation } from "@shared/schema";

// --- Interfaces ---

export interface WritingRequest {
  topic: string;
  annotationIds: string[];
  sourceDocumentIds?: string[];
  projectId?: string;
  citationStyle: "mla" | "apa" | "chicago";
  tone: "academic" | "casual" | "ap_style";
  targetLength: "short" | "medium" | "long";
  noEnDashes: boolean;
  deepWrite: boolean;
}

export interface WritingPlanSection {
  title: string;
  description: string;
  sourceIds: string[];
  targetWords: number;
}

export interface WritingPlan {
  thesis: string;
  sections: WritingPlanSection[];
  bibliography: string[];
}

export interface WritingSource {
  id: string;
  kind: "project_document" | "annotation" | "web_clip";
  title: string;
  author: string;
  excerpt: string;
  fullText: string;
  category: string;
  note: string | null;
  citationData: CitationData | null;
  documentFilename: string;
}

export interface TieredSource {
  id: string;
  kind: "project_document";
  title: string;
  author: string;
  category: string;
  citationData: CitationData | null;
  documentFilename: string;
  summary: string | null;
  mainArguments: string[] | null;
  keyConcepts: string[] | null;
  roleInProject: string | null;
  projectContext: string | null;
  annotations: ProjectAnnotation[];
  excerpt: string;
  documentId: string;
}

export interface WritingSSEEvent {
  type: "status" | "plan" | "section" | "complete" | "error" | "saved";
  phase?: string;
  message?: string;
  plan?: WritingPlan;
  index?: number;
  title?: string;
  content?: string;
  fullText?: string;
  usage?: { inputTokens: number; outputTokens: number };
  error?: string;
  savedPaper?: {
    documentId: string;
    projectDocumentId: string;
    filename: string;
    savedAt: number;
  };
}

// --- Constants ---

const TARGET_WORDS: Record<string, number> = {
  short: 1500,
  medium: 2500,
  long: 4000,
};

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEEP_WRITE_MODEL = "claude-sonnet-4-5-20241022";

// --- Helpers ---

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to your .env file."
    );
  }
  return new Anthropic({ apiKey });
}

export function formatSourceForPrompt(source: WritingSource): string {
  const parts: string[] = [];
  parts.push(`[SOURCE ${source.id}]`);
  parts.push(`Type: ${source.kind}`);
  parts.push(`Document: ${source.documentFilename}`);
  parts.push(`Title: ${source.title}`);
  parts.push(`Author(s): ${source.author}`);
  parts.push(`Category: ${source.category}`);
  if (source.note) parts.push(`Note: ${source.note}`);
  if (source.citationData) {
    const cd = source.citationData;
    const authorStr =
      cd.authors && cd.authors.length > 0
        ? cd.authors.map((a) => `${a.firstName} ${a.lastName}`).join(", ")
        : "Unknown Author";
    parts.push(`Citation Author(s): ${authorStr}`);
    parts.push(`Citation Title: ${cd.title}${cd.subtitle ? ": " + cd.subtitle : ""}`);
    if (cd.publicationDate) parts.push(`Date: ${cd.publicationDate}`);
    if (cd.publisher) parts.push(`Publisher: ${cd.publisher}`);
    if (cd.containerTitle) parts.push(`In: ${cd.containerTitle}`);
    if (cd.pageStart) {
      parts.push(
        `Pages: ${cd.pageStart}${cd.pageEnd ? "-" + cd.pageEnd : ""}`
      );
    }
    if (cd.url) parts.push(`URL: ${cd.url}`);
  }
  parts.push(`Excerpt: "${source.excerpt}"`);
  parts.push(`Content Snippet:\n${source.fullText}`);
  return parts.join("\n");
}

export function formatSourceForPromptTiered(source: TieredSource): string {
  const parts: string[] = [];
  parts.push(`[SOURCE ${source.id}]`);
  parts.push(`Document: ${source.documentFilename}`);
  parts.push(`Title: ${source.title}`);
  parts.push(`Author(s): ${source.author}`);

  if (source.citationData) {
    const cd = source.citationData;
    const authorStr =
      cd.authors && cd.authors.length > 0
        ? cd.authors.map((a) => `${a.firstName} ${a.lastName}`).join(", ")
        : "Unknown Author";
    parts.push(`Citation Author(s): ${authorStr}`);
    parts.push(`Citation Title: ${cd.title}${cd.subtitle ? ": " + cd.subtitle : ""}`);
    if (cd.publicationDate) parts.push(`Date: ${cd.publicationDate}`);
    if (cd.publisher) parts.push(`Publisher: ${cd.publisher}`);
    if (cd.containerTitle) parts.push(`In: ${cd.containerTitle}`);
    if (cd.pageStart) {
      parts.push(`Pages: ${cd.pageStart}${cd.pageEnd ? "-" + cd.pageEnd : ""}`);
    }
    if (cd.url) parts.push(`URL: ${cd.url}`);
  }

  if (source.summary) parts.push(`Summary: ${source.summary}`);
  if (source.mainArguments?.length) {
    parts.push(`Main Arguments: ${source.mainArguments.join("; ")}`);
  }
  if (source.keyConcepts?.length) {
    parts.push(`Key Concepts: ${source.keyConcepts.join(", ")}`);
  }
  if (source.roleInProject) parts.push(`Role in Project: ${source.roleInProject}`);
  if (source.projectContext) parts.push(`Project Context: ${source.projectContext}`);

  if (source.annotations.length > 0) {
    parts.push("");
    parts.push(`ANNOTATED PASSAGES (${source.annotations.length} annotations):`);
    parts.push("");

    for (const ann of source.annotations) {
      const confidence = typeof ann.confidenceScore === "number"
        ? ` | Confidence: ${ann.confidenceScore.toFixed(2)}`
        : "";
      const promptInfo = ann.promptText ? ` | Prompt: "${ann.promptText}"` : "";

      parts.push(`[ANNOTATION ${ann.id}] Category: ${ann.category}${confidence}${promptInfo}`);
      parts.push(`"${ann.highlightedText}"`);
      if (ann.note) parts.push(`Note: ${ann.note}`);
      parts.push(`Position: chars ${ann.startPosition}-${ann.endPosition}`);
      parts.push(`Document: ${source.documentId}`);
      parts.push("");
    }
  } else {
    parts.push(`Excerpt: "${source.excerpt}"`);
  }

  return parts.join("\n");
}

// --- Phase 1: PLANNER ---

async function runPlanner(
  client: Anthropic,
  request: WritingRequest,
  sources: WritingSource[],
  model: string
): Promise<WritingPlan> {
  const totalWords = TARGET_WORDS[request.targetLength] || 2500;

  const sourceBlock = sources
    .map((source, i) => `--- Source ${i + 1} ---\n${formatSourceForPrompt(source)}`)
    .join("\n\n");

  const systemPrompt = `You are an academic writing planner. Given a topic, tone, and source materials,
create a detailed outline for a paper.

Output ONLY a JSON object (no markdown fences, no extra text) with:
- thesis: The main argument/thesis statement
- sections: Array of sections, each with:
  - title: Section heading
  - description: What this section should cover
  - sourceIds: Array of source IDs to use in this section
  - targetWords: Target word count for this section
- bibliography: Array of formatted ${request.citationStyle.toUpperCase()} bibliography entries based on available citation data

The total word count across sections should be approximately ${totalWords} words.

Target lengths:
- short: ~1500 words (3 pages)
- medium: ~2500 words (5 pages)
- long: ~4000 words (8 pages)

Always include an Introduction and Conclusion section. Distribute sources logically across sections.
Do not invent fake source metadata. If source metadata is missing, use conservative placeholders in bibliography entries.`;

  const userPrompt = `Topic: ${request.topic}
Tone: ${request.tone}
Target length: ${request.targetLength} (~${totalWords} words)
Citation style: ${request.citationStyle}

Source materials (${sources.length} total):
${sourceBlock || "(No sources provided - write based on topic alone)"}`;

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Parse JSON from response (strip markdown fences if present)
  const jsonStr = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
  try {
    type RawPlanSection = {
      title: string;
      description: string;
      targetWords: number;
      sourceIds?: string[];
      annotationIds?: string[];
    };
    const parsed = JSON.parse(jsonStr) as {
      thesis: string;
      bibliography?: string[];
      sections?: RawPlanSection[];
    };

    if (!parsed.thesis || !Array.isArray(parsed.sections)) {
      throw new Error("Invalid plan structure");
    }

    const sectionCount = Math.max(1, parsed.sections.length);
    const fallbackWords = Math.max(250, Math.round(totalWords / sectionCount));

    const sections: WritingPlanSection[] = parsed.sections.map((section) => {
      const sourceIds = Array.isArray(section.sourceIds)
        ? section.sourceIds
        : Array.isArray(section.annotationIds)
          ? section.annotationIds
          : [];
      return {
        title: section.title,
        description: section.description,
        sourceIds,
        targetWords:
          Number.isFinite(section.targetWords) && section.targetWords > 0
            ? section.targetWords
            : fallbackWords,
      };
    });

    return {
      thesis: parsed.thesis,
      sections,
      bibliography: Array.isArray(parsed.bibliography) ? parsed.bibliography : [],
    };
  } catch (e) {
    throw new Error(
      `Failed to parse writing plan from AI response: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

// --- Phase 2: WRITER (per section) ---

async function writeSection(
  client: Anthropic,
  plan: WritingPlan,
  sectionIndex: number,
  request: WritingRequest,
  sources: WritingSource[],
  model: string
): Promise<string> {
  const section = plan.sections[sectionIndex];

  // Get relevant sources for this section
  const relevantSources = section.sourceIds.length > 0
    ? sources.filter((source) => section.sourceIds.includes(source.id))
    : sources;

  const sourceBlock = relevantSources
    .map((source) => formatSourceForPrompt(source))
    .join("\n\n---\n\n");

  const planSummary = plan.sections
    .map(
      (s, i) =>
        `${i + 1}. ${s.title} (~${s.targetWords} words): ${s.description}`
    )
    .join("\n");

  const noEnDashesLine = request.noEnDashes
    ? "\n- NEVER use em-dashes or en-dashes. Use commas, periods, or semicolons instead."
    : "";

  const systemPrompt = `You are an academic writer. Write the following section of a paper.

Full outline (for context on the paper's arc):
Thesis: ${plan.thesis}
${planSummary}

Your assignment: Write section "${section.title}"
Description: ${section.description}
Target length: ${section.targetWords} words
Tone: ${request.tone}
Citation style: ${request.citationStyle}

Source material (from the student's selected project sources):
${sourceBlock || "(No specific sources for this section)"}

Requirements:
- Write ONLY this section, not the whole paper
- Include in-text citations in ${request.citationStyle.toUpperCase()} format where appropriate
- Use ONLY the provided sources as primary evidence
- Match the specified tone${noEnDashesLine}
- Do not fabricate quotations, page numbers, publication details, or bibliography entries
- If uncertain, cite conservatively and state uncertainty plainly

Output the section text in markdown format. Start with the section heading as ## ${section.title}`;

  const messageParams: Anthropic.MessageCreateParams = {
    model,
    max_tokens: Math.max(2048, section.targetWords * 2),
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Write the "${section.title}" section now.`,
      },
    ],
  };

  // Deep Write: add extended thinking on Sonnet
  if (request.deepWrite) {
    messageParams.thinking = { type: "enabled", budget_tokens: 4096 };
    // Extended thinking requires higher max_tokens
    messageParams.max_tokens = Math.max(8192, section.targetWords * 3);
  }

  const response = await client.messages.create(messageParams);

  // Extract text content (skip thinking blocks)
  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === "text"
  );
  return textBlocks.map((b) => b.text).join("\n\n");
}

// --- Phase 3: STITCHER ---

async function stitch(
  client: Anthropic,
  plan: WritingPlan,
  sectionTexts: string[],
  request: WritingRequest,
  model: string
): Promise<string> {
  const combinedSections = sectionTexts.join("\n\n---\n\n");

  const noEnDashesLine = request.noEnDashes
    ? "\n- NEVER use em-dashes or en-dashes. Use commas, periods, or semicolons instead."
    : "";

  const systemPrompt = `You are an academic editor. You have been given all sections of a paper written by different writers.
Your job is to:
1. Add smooth transitions between sections
2. Ensure consistent voice and tone throughout
3. Write a compelling introduction (if not already present)
4. Write a conclusion that ties the argument together
5. Append a complete bibliography/works cited section in ${request.citationStyle.toUpperCase()} format
6. Do NOT rewrite the sections - only add transitions, intro, conclusion, and bibliography${noEnDashesLine}
7. Do not fabricate source details that are not supported by the source material

The thesis of the paper is: ${plan.thesis}

Output the complete paper in markdown format.`;

  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Here are the sections to stitch together:\n\n${combinedSections}\n\nBibliography entries from the plan:\n${plan.bibliography.join("\n")}`,
      },
    ],
  });

  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === "text"
  );
  return textBlocks.map((b) => b.text).join("\n\n");
}

// --- Main pipeline (streaming via callback) ---

export async function runWritingPipeline(
  request: WritingRequest,
  sources: WritingSource[],
  onEvent: (event: WritingSSEEvent) => void
): Promise<void> {
  const client = getClient();
  const model = request.deepWrite ? DEEP_WRITE_MODEL : DEFAULT_MODEL;

  let totalInput = 0;
  let totalOutput = 0;

  try {
    // Phase 1: Planning
    onEvent({
      type: "status",
      phase: "planning",
      message: "Creating outline...",
    });

    const plan = await runPlanner(client, request, sources, model);

    onEvent({ type: "plan", plan });

    // Phase 2: Writing each section
    const sectionTexts: string[] = [];

    for (let i = 0; i < plan.sections.length; i++) {
      const section = plan.sections[i];
      onEvent({
        type: "status",
        phase: "writing",
        message: `Writing section ${i + 1} of ${plan.sections.length}: "${section.title}"...`,
      });

      const sectionContent = await writeSection(
        client,
        plan,
        i,
        request,
        sources,
        model
      );
      sectionTexts.push(sectionContent);

      onEvent({
        type: "section",
        index: i,
        title: section.title,
        content: sectionContent,
      });
    }

    // Phase 3: Stitching
    onEvent({
      type: "status",
      phase: "stitching",
      message: "Polishing and adding transitions...",
    });

    const fullText = await stitch(client, plan, sectionTexts, request, model);

    onEvent({
      type: "complete",
      fullText,
      usage: { inputTokens: totalInput, outputTokens: totalOutput },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    onEvent({ type: "error", error: message });
  }
}
