// AI-Powered Vertical Creator — Generate full verticals from a short description
// Also handles keyword auto-mapping to verticals.

import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { eq, isNull } from "drizzle-orm";
import {
  industryVerticals,
  contextEntries,
  keywords,
  keywordClusters,
  type IndustryVertical,
} from "@shared/schema";

function getClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

/**
 * Generate a full industry vertical from a short description.
 * AI creates terminology, pain points, use cases, regulations, seasonal relevance, etc.
 */
export async function createVerticalFromDescription(description: string): Promise<IndustryVertical> {
  const client = getClient();

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [{
      role: "user",
      content: `You are creating an industry vertical for iBolt Mounts (device mounting solutions company).

Based on this description, generate a complete industry vertical:

"${description}"

Return JSON:
{
  "name": "Industry Name",
  "slug": "industry-slug",
  "description": "2-3 sentence description of this industry vertical and how device mounting applies",
  "terminology": ["10-15 industry-specific terms"],
  "painPoints": ["6-8 customer pain points related to device mounting in this industry"],
  "useCases": ["5-7 specific use cases for iBolt mounts in this industry"],
  "regulations": ["relevant regulations if any, empty array if none"],
  "seasonalRelevance": "when this industry peaks and how it affects mount sales",
  "compatibleDevices": ["devices commonly mounted in this industry"],
  "contextEntries": [
    {"category": "terminology", "content": "explanation of a key term"},
    {"category": "pain_point", "content": "specific customer frustration"},
    {"category": "use_case", "content": "detailed use case scenario"},
    {"category": "user_language", "content": "how real people talk about this"},
    {"category": "trend", "content": "current industry trend"}
  ]
}

Generate 8-12 context entries covering all categories. Make them specific and useful for blog writing.`,
    }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Failed to parse vertical generation response");

  const data = JSON.parse(jsonMatch[0]);

  // Create the vertical
  const [vertical] = await db.insert(industryVerticals).values({
    name: data.name,
    slug: data.slug.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
    description: data.description,
    terminology: data.terminology || [],
    painPoints: data.painPoints || [],
    useCases: data.useCases || [],
    regulations: data.regulations || [],
    seasonalRelevance: data.seasonalRelevance || "",
    compatibleDevices: data.compatibleDevices || [],
  }).returning();

  // Seed context entries
  if (data.contextEntries?.length > 0) {
    for (const entry of data.contextEntries) {
      await db.insert(contextEntries).values({
        verticalId: vertical.id,
        category: entry.category,
        content: entry.content,
        sourceType: "seed",
        confidence: 1.0,
        isVerified: true,
      });
    }
  }

  return vertical;
}

/**
 * Auto-map unclustered keywords to the best-matching vertical.
 */
export async function autoMapKeywordsToVerticals(): Promise<{ mapped: number }> {
  const verticals = await db.select().from(industryVerticals);
  const unmappedClusters = await db.select().from(keywordClusters).where(isNull(keywordClusters.verticalId));

  if (unmappedClusters.length === 0 || verticals.length === 0) return { mapped: 0 };

  const client = getClient();

  const clusterList = unmappedClusters.map((c) => `"${c.primaryKeyword}" (${c.name})`).join(", ");
  const verticalList = verticals.map((v) => `"${v.slug}": ${v.name} - ${v.description?.slice(0, 80)}`).join("\n");

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    messages: [{
      role: "user",
      content: `Map each keyword cluster to the best-matching industry vertical for iBolt Mounts.

Clusters to map: ${clusterList}

Available verticals:
${verticalList}

Return JSON array:
[
  {"clusterKeyword": "primary keyword", "verticalSlug": "best-match-slug"}
]

Every cluster must map to exactly one vertical. Use "general-mounting" if nothing else fits.`,
    }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return { mapped: 0 };

  const mappings = JSON.parse(jsonMatch[0]) as Array<{ clusterKeyword: string; verticalSlug: string }>;
  let mapped = 0;

  for (const mapping of mappings) {
    const vertical = verticals.find((v) => v.slug === mapping.verticalSlug);
    const cluster = unmappedClusters.find((c) => c.primaryKeyword === mapping.clusterKeyword);
    if (vertical && cluster) {
      await db.update(keywordClusters).set({ verticalId: vertical.id }).where(eq(keywordClusters.id, cluster.id));
      mapped++;
    }
  }

  return { mapped };
}
