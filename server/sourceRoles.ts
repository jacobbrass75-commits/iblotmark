export const SOURCE_ROLES = ["evidence", "style_reference", "background"] as const;

export type SourceRole = typeof SOURCE_ROLES[number];

export interface StyleAnalysis {
  avgSentenceLength: string;
  vocabularyLevel: "academic" | "conversational" | "mixed";
  paragraphStructure: string;
  toneMarkers: string[];
  commonTransitions: string[];
}

interface AnthropicLike {
  messages: {
    create: (...args: any[]) => Promise<{
      content: Array<{ type: string; text?: string }>;
    }>;
  };
}

export function isSourceRole(value: unknown): value is SourceRole {
  return typeof value === "string" && SOURCE_ROLES.includes(value as SourceRole);
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function normalizeStringList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeVocabularyLevel(value: unknown): StyleAnalysis["vocabularyLevel"] {
  return value === "academic" || value === "conversational" || value === "mixed"
    ? value
    : "mixed";
}

function normalizeStyleAnalysis(value: Partial<StyleAnalysis> | null): StyleAnalysis {
  return {
    avgSentenceLength: value?.avgSentenceLength?.trim() || "Mixed sentence lengths",
    vocabularyLevel: normalizeVocabularyLevel(value?.vocabularyLevel),
    paragraphStructure: value?.paragraphStructure?.trim() || "Balanced analytical paragraphs",
    toneMarkers: normalizeStringList(value?.toneMarkers, 5),
    commonTransitions: normalizeStringList(value?.commonTransitions, 8),
  };
}

function formatStyleProfile(analysis: StyleAnalysis): string {
  return `Style profile:
- Sentence length: ${analysis.avgSentenceLength}
- Vocabulary: ${analysis.vocabularyLevel}
- Paragraph style: ${analysis.paragraphStructure}
- Tone: ${analysis.toneMarkers.join(", ") || "Not enough data"}
- Transitions: ${analysis.commonTransitions.slice(0, 5).join(", ") || "Not enough data"}`;
}

function extractText(response: { content?: Array<{ type: string; text?: string }> }): string {
  if (!Array.isArray(response.content)) return "";
  return response.content
    .filter((block): block is { type: string; text: string } => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export function formatSourceStubByRole(source: {
  id: string;
  title: string;
  sourceRole: SourceRole;
  styleAnalysis?: StyleAnalysis | null;
  summary?: string | null;
  annotationCount?: number | null;
  chunkCount?: number | null;
}): string {
  switch (source.sourceRole) {
    case "style_reference":
      return `[STYLE REFERENCE] "${source.title}"
MATCH this author's voice, sentence structure, and vocabulary level.
DO NOT cite, quote, or reference this document.
${source.styleAnalysis ? formatStyleProfile(source.styleAnalysis) : "Style analysis pending."}`;
    case "background":
      return `[BACKGROUND] "${source.title}" - ${source.summary || "Summary available via tools."}
Use for general context. Light citation only, no direct quotes needed.`;
    case "evidence":
    default:
      return `[EVIDENCE] "${source.title}" - ${source.summary || "Summary available."}
Annotations: ${source.annotationCount || 0} | Chunks: ${source.chunkCount || 0}
Full citation pipeline: quote directly, cite precisely.`;
  }
}

export async function analyzeWritingStyle(
  anthropic: AnthropicLike,
  documentText: string,
  title: string,
): Promise<StyleAnalysis> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: `You are a writing style analyst. Analyze the provided text and return a JSON object with these fields:
- avgSentenceLength: string description (for example "Short, punchy (12-15 words avg)")
- vocabularyLevel: "academic" | "conversational" | "mixed"
- paragraphStructure: string description
- toneMarkers: string[] of 3-5 tone descriptors
- commonTransitions: string[] of 5-8 transition phrases used
Return ONLY valid JSON, no markdown.`,
    messages: [
      {
        role: "user",
        content: `Analyze the writing style of "${title}":\n\n${documentText.slice(0, 8000)}`,
      },
    ],
  });

  const raw = extractText(response).replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
  const parsed = safeJsonParse<Partial<StyleAnalysis>>(raw);
  return normalizeStyleAnalysis(parsed);
}

export function buildStyleSection(styleSources: Array<{
  title: string;
  styleAnalysis: StyleAnalysis | null;
}>): string {
  if (styleSources.length === 0) return "";

  return `\n## WRITING STYLE GUIDE
The student has provided writing samples. Match this voice:
${styleSources
  .map((source) => {
    if (!source.styleAnalysis) {
      return `- "${source.title}": style analysis pending`;
    }

    return `- "${source.title}":
  Sentences: ${source.styleAnalysis.avgSentenceLength}
  Vocabulary: ${source.styleAnalysis.vocabularyLevel}
  Tone: ${source.styleAnalysis.toneMarkers.join(", ")}
  Transitions: ${source.styleAnalysis.commonTransitions.join(", ")}`;
  })
  .join("\n")}
Do NOT cite or quote from style reference documents. They are purely style guides.`;
}
