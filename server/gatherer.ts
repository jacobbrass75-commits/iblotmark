import { formatClipboardForPrompt, type EvidenceClipboard } from "./evidenceClipboard";
import { formatSourceStubByRole, type SourceRole } from "./sourceRoles";

export interface SourceStub {
  docId: string;
  title: string;
  role: SourceRole;
  summary?: string | null;
  annotationCount?: number | null;
  chunkCount?: number | null;
}

export interface EvidenceFinding {
  type: "quote" | "paraphrase" | "data_point" | "concept";
  text: string;
  location?: string;
  relevance: string;
}

export interface EvidenceBrief {
  relevantSources: Array<{
    docId: string;
    title: string;
    role: "evidence" | "background";
    findings: EvidenceFinding[];
  }>;
  styleNotes?: string;
  suggestedApproach?: string;
  tokenEstimate: number;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface AnthropicResponse {
  stop_reason?: string | null;
  content: AnthropicContentBlock[];
}

interface AnthropicLike {
  messages: {
    create: (...args: any[]) => Promise<AnthropicResponse>;
  };
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function extractTextBlock(response: AnthropicResponse): string {
  return response.content
    .filter((block): block is AnthropicContentBlock & { text: string } => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function normalizeFindingType(value: unknown): EvidenceFinding["type"] | null {
  return value === "quote" || value === "paraphrase" || value === "data_point" || value === "concept"
    ? value
    : null;
}

function normalizeRole(value: unknown): "evidence" | "background" | null {
  return value === "evidence" || value === "background" ? value : null;
}

function normalizeEvidenceBrief(value: Partial<EvidenceBrief> | null): EvidenceBrief {
  const relevantSources = Array.isArray(value?.relevantSources)
    ? value.relevantSources
        .map((source) => {
          const docId = typeof source?.docId === "string" ? source.docId.trim() : "";
          const title = typeof source?.title === "string" ? source.title.trim() : "";
          const role = normalizeRole(source?.role);
          const findings = Array.isArray(source?.findings)
            ? source.findings
                .map((finding) => {
                  const type = normalizeFindingType(finding?.type);
                  const text = typeof finding?.text === "string" ? finding.text.trim() : "";
                  const relevance = typeof finding?.relevance === "string" ? finding.relevance.trim() : "";
                  const location = typeof finding?.location === "string" ? finding.location.trim() : "";

                  if (!type || !text || !relevance) {
                    return null;
                  }

                  return {
                    type,
                    text,
                    relevance,
                    ...(location ? { location } : {}),
                  };
                })
                .filter((finding): finding is EvidenceFinding => finding !== null)
            : [];

          if (!docId || !title || !role) {
            return null;
          }

          return { docId, title, role, findings };
        })
        .filter((source): source is EvidenceBrief["relevantSources"][number] => source !== null)
    : [];

  const brief: EvidenceBrief = {
    relevantSources,
    ...(typeof value?.styleNotes === "string" && value.styleNotes.trim()
      ? { styleNotes: value.styleNotes.trim() }
      : {}),
    ...(typeof value?.suggestedApproach === "string" && value.suggestedApproach.trim()
      ? { suggestedApproach: value.suggestedApproach.trim() }
      : {}),
    tokenEstimate: 0,
  };

  brief.tokenEstimate = Math.ceil(formatEvidenceBrief(brief).length / 4);
  return brief;
}

export function formatEvidenceBrief(brief: EvidenceBrief): string {
  if (brief.relevantSources.length === 0) return "[No new evidence gathered for this turn]";

  let output = "## Evidence Gathered This Turn\n";
  for (const source of brief.relevantSources) {
    output += `\n### ${source.title} [${source.role}]\n`;
    for (const finding of source.findings) {
      const prefix = finding.type === "quote" ? `"${finding.text}"` : finding.text;
      output += `- [${finding.type}] ${prefix}${finding.location ? ` (${finding.location})` : ""}\n  Relevance: ${finding.relevance}\n`;
    }
  }

  if (brief.styleNotes) {
    output += `\n## Style Notes\n${brief.styleNotes}\n`;
  }
  if (brief.suggestedApproach) {
    output += `\n## Suggested Approach\n${brief.suggestedApproach}\n`;
  }

  return output;
}

function formatGatherableSource(source: SourceStub): string {
  return formatSourceStubByRole({
    id: source.docId,
    title: source.title,
    sourceRole: source.role,
    summary: source.summary,
    annotationCount: source.annotationCount,
    chunkCount: source.chunkCount,
  });
}

function parseEvidenceBrief(response: AnthropicResponse): EvidenceBrief {
  const text = extractTextBlock(response);
  if (!text) return { relevantSources: [], tokenEstimate: 0 };

  const parsed = safeJsonParse<Partial<EvidenceBrief>>(text);
  if (!parsed) {
    return {
      relevantSources: [],
      suggestedApproach: text,
      tokenEstimate: Math.ceil(text.length / 4),
    };
  }

  return normalizeEvidenceBrief(parsed);
}

export async function gatherEvidence(
  anthropic: AnthropicLike,
  userMessage: string,
  sourceStubs: SourceStub[],
  clipboard: EvidenceClipboard,
  thesis: string,
  tools: unknown[],
  toolExecutor: (name: string, input: unknown) => Promise<string>,
): Promise<EvidenceBrief> {
  const gatherableSources = sourceStubs.filter((source) => source.role !== "style_reference");
  if (gatherableSources.length === 0) {
    return { relevantSources: [], tokenEstimate: 0 };
  }

  const gathererPrompt = `You are a research assistant. The student is writing a paper and just said:
"${userMessage}"
Thesis: ${thesis || "Not yet defined"}
Current evidence collected:
${formatClipboardForPrompt(clipboard)}
Available sources:
${gatherableSources.map((source) => formatGatherableSource(source)).join("\n\n")}

Your job:
1. Decide which sources, if any, are relevant to what the student just asked.
2. Call tools to gather evidence from relevant sources only.
3. For "evidence" sources, find specific quotes and data points.
4. For "background" sources, get summary-level context only. Use get_source_summary, not chunk tools.
5. Do not gather evidence already present in the clipboard above.
6. Return valid JSON with this shape:
{
  "relevantSources": [
    {
      "docId": "source-id",
      "title": "Source title",
      "role": "evidence" | "background",
      "findings": [
        {
          "type": "quote" | "paraphrase" | "data_point" | "concept",
          "text": "Finding text",
          "location": "optional location",
          "relevance": "Why it matters"
        }
      ]
    }
  ],
  "styleNotes": "optional",
  "suggestedApproach": "optional"
}
Call the minimum number of tools needed. Be selective.`;

  const messages: Array<{ role: string; content: unknown }> = [
    { role: "user", content: "Gather evidence for this turn." },
  ];

  let response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    system: gathererPrompt,
    messages,
    tools,
  });

  let iterations = 0;
  while (response.stop_reason === "tool_use" && iterations < 3) {
    const toolUseBlocks = response.content.filter(
      (block): block is AnthropicContentBlock & { id: string; name: string } =>
        block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string",
    );

    const toolResults = [];
    for (const toolUse of toolUseBlocks) {
      const result = await toolExecutor(toolUse.name, toolUse.input);
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result,
      });
    }

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResults });

    response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system: gathererPrompt,
      messages,
      tools,
    });
    iterations += 1;
  }

  return parseEvidenceBrief(response);
}
