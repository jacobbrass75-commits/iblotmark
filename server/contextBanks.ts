// Context bank CRUD and prompt formatting
// Manages industry knowledge entries used to enrich blog generation prompts.

import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";
import {
  contextEntries,
  industryVerticals,
  type InsertContextEntry,
  type ContextEntry,
  type IndustryVertical,
} from "@shared/schema";

// --- CRUD ---

export async function getVerticals(): Promise<IndustryVertical[]> {
  return db.select().from(industryVerticals).orderBy(industryVerticals.name);
}

export async function getVerticalBySlug(slug: string): Promise<IndustryVertical | undefined> {
  const [row] = await db
    .select()
    .from(industryVerticals)
    .where(eq(industryVerticals.slug, slug))
    .limit(1);
  return row;
}

export async function getVerticalById(id: string): Promise<IndustryVertical | undefined> {
  const [row] = await db
    .select()
    .from(industryVerticals)
    .where(eq(industryVerticals.id, id))
    .limit(1);
  return row;
}

export async function getContextEntries(
  verticalId: string,
  category?: string,
  verifiedOnly = true,
): Promise<ContextEntry[]> {
  const conditions = [eq(contextEntries.verticalId, verticalId)];
  if (category) conditions.push(eq(contextEntries.category, category));
  if (verifiedOnly) conditions.push(eq(contextEntries.isVerified, true));

  return db
    .select()
    .from(contextEntries)
    .where(and(...conditions))
    .orderBy(desc(contextEntries.confidence));
}

export async function addContextEntry(entry: InsertContextEntry): Promise<ContextEntry> {
  const [row] = await db.insert(contextEntries).values(entry).returning();
  return row;
}

export async function addContextEntries(entries: InsertContextEntry[]): Promise<number> {
  if (entries.length === 0) return 0;
  const result = await db.insert(contextEntries).values(entries).returning();
  return result.length;
}

export async function verifyContextEntry(id: string, verified: boolean): Promise<void> {
  await db
    .update(contextEntries)
    .set({ isVerified: verified })
    .where(eq(contextEntries.id, id));
}

export async function deleteContextEntry(id: string): Promise<void> {
  await db.delete(contextEntries).where(eq(contextEntries.id, id));
}

export async function getContextStats(verticalId: string): Promise<Record<string, number>> {
  const entries = await db
    .select()
    .from(contextEntries)
    .where(eq(contextEntries.verticalId, verticalId));

  const stats: Record<string, number> = {};
  for (const entry of entries) {
    stats[entry.category] = (stats[entry.category] || 0) + 1;
  }
  return stats;
}

// --- Prompt formatting ---

/**
 * Format all verified context entries for a vertical into a prompt-ready string.
 * Groups by category for structured context injection.
 */
export async function formatContextForPrompt(verticalId: string): Promise<string> {
  const vertical = await getVerticalById(verticalId);
  if (!vertical) return "";

  const entries = await getContextEntries(verticalId, undefined, true);
  if (entries.length === 0) {
    return `Industry: ${vertical.name}\nNo detailed context available yet.`;
  }

  // Group by category
  const grouped: Record<string, string[]> = {};
  for (const entry of entries) {
    if (!grouped[entry.category]) grouped[entry.category] = [];
    grouped[entry.category].push(entry.content);
  }

  const sections: string[] = [`## Industry Context: ${vertical.name}`];

  if (vertical.description) {
    sections.push(vertical.description);
  }

  const categoryLabels: Record<string, string> = {
    terminology: "Key Terminology",
    use_case: "Common Use Cases",
    pain_point: "Customer Pain Points",
    regulation: "Regulations & Compliance",
    trend: "Industry Trends",
    competitor: "Competitive Landscape",
    user_language: "How Customers Talk About This",
  };

  for (const [cat, entries] of Object.entries(grouped)) {
    const label = categoryLabels[cat] || cat;
    sections.push(`### ${label}`);
    sections.push(entries.map((e) => `- ${e}`).join("\n"));
  }

  // Add structured vertical data if present
  if (vertical.painPoints?.length) {
    if (!grouped["pain_point"]) {
      sections.push("### Customer Pain Points");
      sections.push(vertical.painPoints.map((p) => `- ${p}`).join("\n"));
    }
  }

  if (vertical.useCases?.length) {
    if (!grouped["use_case"]) {
      sections.push("### Common Use Cases");
      sections.push(vertical.useCases.map((u) => `- ${u}`).join("\n"));
    }
  }

  if (vertical.regulations?.length) {
    if (!grouped["regulation"]) {
      sections.push("### Regulations & Compliance");
      sections.push(vertical.regulations.map((r) => `- ${r}`).join("\n"));
    }
  }

  if (vertical.seasonalRelevance) {
    sections.push("### Seasonal Relevance");
    sections.push(vertical.seasonalRelevance);
  }

  return sections.join("\n\n");
}
