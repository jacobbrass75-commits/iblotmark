// Context Chunker — Intelligent context retrieval with token budgets
// Pre-chunks products + context entries, retrieves only relevant chunks per section.
// Reuses ScholarMark's chunking patterns from chunker.ts and contextCompaction.ts.

import { db } from "./db";
import { eq } from "drizzle-orm";
import {
  pipelineContextChunks,
  contextEntries,
  products,
  industryVerticals,
  type PipelineContextChunk,
} from "@shared/schema";
import { chunkText } from "./chunker";

// Token budget per pipeline phase (approximate — 1 token ≈ 4 chars)
export const TOKEN_BUDGETS = {
  planner: 3000,       // Needs breadth to plan well
  sectionWriter: 1500, // Needs depth for specific section
  stitcher: 800,       // Just voice consistency
  verifier: 500,       // Brand rules + keyword list
} as const;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// --- Chunk Building ---

/**
 * Rebuild the pipeline_context_chunks table for a vertical (or all verticals).
 * Call after context entries or products change.
 */
export async function rebuildContextChunks(verticalId?: string): Promise<number> {
  // Clear existing chunks for the target
  if (verticalId) {
    await db.delete(pipelineContextChunks).where(eq(pipelineContextChunks.verticalId, verticalId));
  } else {
    await db.delete(pipelineContextChunks);
  }

  let totalChunks = 0;

  // Get target verticals
  const verticals = verticalId
    ? await db.select().from(industryVerticals).where(eq(industryVerticals.id, verticalId))
    : await db.select().from(industryVerticals);

  for (const vertical of verticals) {
    // Chunk context entries
    const entries = await db.select().from(contextEntries).where(eq(contextEntries.verticalId, vertical.id));

    for (const entry of entries) {
      const chunks = chunkText(entry.content, 500, 50);
      for (let i = 0; i < chunks.length; i++) {
        await db.insert(pipelineContextChunks).values({
          sourceType: "context_entry",
          sourceId: entry.id,
          chunkIndex: i,
          chunkText: `[${entry.category}] ${chunks[i].text}`,
          tokenEstimate: estimateTokens(chunks[i].text),
          verticalId: vertical.id,
        });
        totalChunks++;
      }
    }

    // Chunk product descriptions for this vertical's products
    const allProducts = await db.select().from(products);
    // Filter products that have catalog descriptions (enriched)
    const enrichedProducts = allProducts.filter((p) => p.catalogDescription);

    for (const product of enrichedProducts) {
      const text = `Product: ${product.title}\n${product.catalogDescription || product.description || ""}`;
      const chunks = chunkText(text, 500, 50);
      for (let i = 0; i < chunks.length; i++) {
        await db.insert(pipelineContextChunks).values({
          sourceType: "product",
          sourceId: product.id,
          chunkIndex: i,
          chunkText: chunks[i].text,
          tokenEstimate: estimateTokens(chunks[i].text),
          verticalId: null, // Products can span verticals
        });
        totalChunks++;
      }
    }
  }

  console.log(`[ContextChunker] Rebuilt ${totalChunks} chunks`);
  return totalChunks;
}

// --- Retrieval ---

/**
 * Score a chunk's relevance to a set of keywords using word overlap.
 */
function scoreChunkRelevance(chunk: string, keywords: string[]): number {
  const chunkLower = chunk.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    if (chunkLower.includes(kwLower)) {
      score += kwLower.split(/\s+/).length; // Multi-word matches score higher
    }
  }
  return score;
}

/**
 * Get the most relevant context chunks for a query, staying within a token budget.
 */
export async function getRelevantChunks(
  keywords: string[],
  verticalId: string | null,
  tokenBudget: number,
): Promise<PipelineContextChunk[]> {
  // Get all chunks for the vertical (or all if no vertical)
  let allChunks: PipelineContextChunk[];
  if (verticalId) {
    const verticalChunks = await db.select().from(pipelineContextChunks)
      .where(eq(pipelineContextChunks.verticalId, verticalId));
    // Also get product chunks (verticalId is null)
    const productChunks = await db.select().from(pipelineContextChunks)
      .where(eq(pipelineContextChunks.sourceType, "product"));
    allChunks = [...verticalChunks, ...productChunks];
  } else {
    allChunks = await db.select().from(pipelineContextChunks);
  }

  if (allChunks.length === 0) return [];

  // Score and rank by relevance
  const scored = allChunks.map((chunk) => ({
    chunk,
    score: scoreChunkRelevance(chunk.chunkText, keywords),
  })).sort((a, b) => b.score - a.score);

  // Take chunks until we hit the token budget
  const selected: PipelineContextChunk[] = [];
  let usedTokens = 0;

  for (const { chunk, score } of scored) {
    if (score === 0) break; // No more relevant chunks
    const tokens = chunk.tokenEstimate || estimateTokens(chunk.chunkText);
    if (usedTokens + tokens > tokenBudget) continue; // Skip if too big, try smaller ones
    selected.push(chunk);
    usedTokens += tokens;
    if (usedTokens >= tokenBudget * 0.9) break; // 90% fill is good enough
  }

  return selected;
}

/**
 * Build a formatted context string for a specific blog section.
 * Uses token budgets to control size.
 */
export async function buildSectionContext(
  sectionKeywords: string[],
  sectionProductMentions: string[],
  verticalId: string | null,
  phase: keyof typeof TOKEN_BUDGETS,
): Promise<string> {
  const budget = TOKEN_BUDGETS[phase];
  const allKeywords = [...sectionKeywords, ...sectionProductMentions];

  const chunks = await getRelevantChunks(allKeywords, verticalId, budget);

  if (chunks.length === 0) {
    return "No specific context available for this section.";
  }

  // Group by source type
  const contextChunks = chunks.filter((c) => c.sourceType === "context_entry");
  const productChunks = chunks.filter((c) => c.sourceType === "product");

  const sections: string[] = [];

  if (contextChunks.length > 0) {
    sections.push("### Industry Context");
    sections.push(contextChunks.map((c) => `- ${c.chunkText}`).join("\n"));
  }

  if (productChunks.length > 0) {
    sections.push("### Relevant Products");
    sections.push(productChunks.map((c) => c.chunkText).join("\n\n"));
  }

  return sections.join("\n\n");
}

/**
 * Compact a long context string down to a target token count.
 * Used for stitcher/verifier phases that need less context.
 */
export function compactContext(context: string, maxTokens: number): string {
  const currentTokens = estimateTokens(context);
  if (currentTokens <= maxTokens) return context;

  // Simple truncation with indicator
  const maxChars = maxTokens * 4;
  return context.slice(0, maxChars) + "\n\n[...context truncated for token budget]";
}

/**
 * Get chunk stats for monitoring.
 */
export async function getChunkStats(): Promise<{ total: number; byType: Record<string, number>; byVertical: Record<string, number> }> {
  const all = await db.select().from(pipelineContextChunks);
  const byType: Record<string, number> = {};
  const byVertical: Record<string, number> = {};

  for (const chunk of all) {
    byType[chunk.sourceType] = (byType[chunk.sourceType] || 0) + 1;
    if (chunk.verticalId) {
      byVertical[chunk.verticalId] = (byVertical[chunk.verticalId] || 0) + 1;
    }
  }

  return { total: all.length, byType, byVertical };
}
