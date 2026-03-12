import OpenAI from "openai";
import { getEmbedding } from "./openai";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || "missing",
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  return _openai;
}

const CONTEXT_MODEL = "gpt-4.1-nano";

export async function generateRetrievalContext(
  documentSummary: string,
  mainArguments: string[],
  keyConcepts: string[],
  projectThesis: string,
  roleInProject: string
): Promise<string> {
  try {
    const prompt = `Generate a concise retrieval context (200-300 words) for this document that will be used for semantic search. Optimize for:
- Key terminology inclusion
- Relationship to project thesis
- Main arguments and claims
- Searchable phrases

Document Summary: ${documentSummary}

Main Arguments:
${mainArguments.map((a, i) => `${i + 1}. ${a}`).join('\n')}

Key Concepts: ${keyConcepts.join(', ')}

Project Thesis: ${projectThesis}

Role in Project: ${roleInProject}

Generate a search-optimized context paragraph:`;

    const response = await getOpenAI().chat.completions.create({
      model: CONTEXT_MODEL,
      messages: [
        { role: "system", content: "You generate concise, search-optimized document contexts for academic research." },
        { role: "user", content: prompt },
      ],
      max_tokens: 500,
      temperature: 0.3,
    });

    return response.choices[0]?.message?.content || "";
  } catch (error) {
    console.error("Error generating retrieval context:", error);
    return `${documentSummary} ${mainArguments.join(' ')} ${keyConcepts.join(' ')}`;
  }
}

export async function generateProjectContextSummary(
  thesis: string,
  scope: string,
  documentContexts: string[]
): Promise<string> {
  try {
    const prompt = `Generate a unified project context summary (150-200 words) for semantic search across this research project.

Project Thesis: ${thesis}

Project Scope: ${scope}

Document Contexts (${documentContexts.length} documents):
${documentContexts.slice(0, 5).map((c, i) => `[Doc ${i + 1}]: ${c.slice(0, 200)}...`).join('\n\n')}

Generate a search-optimized project summary:`;

    const response = await getOpenAI().chat.completions.create({
      model: CONTEXT_MODEL,
      messages: [
        { role: "system", content: "You generate concise project summaries for academic research retrieval." },
        { role: "user", content: prompt },
      ],
      max_tokens: 400,
      temperature: 0.3,
    });

    return response.choices[0]?.message?.content || "";
  } catch (error) {
    console.error("Error generating project context:", error);
    return `${thesis} ${scope}`;
  }
}

export async function generateFolderContextSummary(
  folderDescription: string,
  documentContexts: string[],
  parentFolderContext?: string
): Promise<string> {
  try {
    const parentInfo = parentFolderContext ? `\nParent Folder Context: ${parentFolderContext}` : "";
    
    const prompt = `Generate a folder context summary (100-150 words) for semantic search.

Folder Description: ${folderDescription}${parentInfo}

Documents in Folder (${documentContexts.length}):
${documentContexts.slice(0, 3).map((c, i) => `[Doc ${i + 1}]: ${c.slice(0, 150)}...`).join('\n\n')}

Generate a search-optimized folder summary:`;

    const response = await getOpenAI().chat.completions.create({
      model: CONTEXT_MODEL,
      messages: [
        { role: "system", content: "You generate concise folder summaries for research organization." },
        { role: "user", content: prompt },
      ],
      max_tokens: 300,
      temperature: 0.3,
    });

    return response.choices[0]?.message?.content || "";
  } catch (error) {
    console.error("Error generating folder context:", error);
    return folderDescription;
  }
}

export async function generateSearchableContent(
  highlightedText: string,
  note: string | null,
  category: string,
  documentContext?: string
): Promise<string> {
  return `[${category}] ${highlightedText} ${note || ''} ${documentContext?.slice(0, 100) || ''}`.trim();
}

export async function embedText(text: string): Promise<number[]> {
  return getEmbedding(text);
}
