// AI-Powered Vertical Creator — Generate full verticals from a short description
// Also handles keyword auto-mapping to verticals.

import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { and, eq, isNull, or } from "drizzle-orm";
import {
  aiBenchmarkQueries,
  industryVerticals,
  contextEntries,
  keywords,
  keywordClusters,
  type IndustryVertical,
} from "@shared/schema";
import { DEFAULT_COMPANY_ID } from "./companyDefaults";
import { getCompanyContext } from "./companyContext";

function getClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function summarizeBrandMarket(positioning: string): string {
  const trimmed = positioning.trim();
  if (!trimmed) return "the brand's products, services, and customer use cases";
  return trimmed.length > 220 ? `${trimmed.slice(0, 220).trim()}...` : trimmed;
}

function defaultVerticalSlug(verticals: IndustryVertical[]): string {
  const generic = verticals.find((vertical) => /general|other|misc|all/i.test(`${vertical.slug} ${vertical.name}`));
  return generic?.slug || verticals[0]?.slug || "";
}

/**
 * Generate a full industry vertical from a short description.
 * AI creates terminology, pain points, use cases, regulations, seasonal relevance, etc.
 */
export async function createVerticalFromDescription(description: string, companyId = DEFAULT_COMPANY_ID): Promise<IndustryVertical> {
  const client = getClient();
  const companyContext = await getCompanyContext(companyId);
  const brandName = companyContext.brandProfile.displayName || companyContext.company.name;
  const positioning = companyContext.brandProfile.positioning || companyContext.brandProfile.shortDescription || "an ecommerce brand";
  const marketSummary = summarizeBrandMarket(positioning);

  const response = await client.messages.create({
    model: process.env.BLOG_ANTHROPIC_MODEL || "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [{
      role: "user",
      content: `You are creating an industry vertical for ${brandName}.

Brand positioning:
${positioning}

Based on this description, generate a complete industry vertical:

"${description}"

Return JSON:
{
  "name": "Industry Name",
  "slug": "industry-slug",
  "description": "2-3 sentence description of this industry vertical and how it connects to ${brandName}'s market",
  "terminology": ["10-15 industry-specific terms"],
  "painPoints": ["6-8 customer pain points related to ${marketSummary}"],
  "useCases": ["5-7 specific use cases, buying scenarios, or evaluation moments for ${brandName}'s products"],
  "regulations": ["relevant regulations if any, empty array if none"],
  "seasonalRelevance": "when this industry peaks and how it affects demand, planning, or buying cycles",
  "compatibleDevices": ["relevant products, equipment, accessories, workflows, or compatibility constraints"],
  "researchSubreddits": ["5-8 real, active subreddit names without r/"],
  "researchYoutubeQueries": ["4-6 YouTube search queries for customer language and setup problems"],
  "researchWebQueries": ["4-6 web search queries for industry guides, forums, and buyer questions"],
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
    companyId,
    name: data.name,
    slug: data.slug.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
    description: data.description,
    terminology: data.terminology || [],
    painPoints: data.painPoints || [],
    useCases: data.useCases || [],
    regulations: data.regulations || [],
    seasonalRelevance: data.seasonalRelevance || "",
    compatibleDevices: data.compatibleDevices || [],
    researchSubreddits: Array.isArray(data.researchSubreddits) ? data.researchSubreddits : [],
    researchYoutubeQueries: Array.isArray(data.researchYoutubeQueries) ? data.researchYoutubeQueries : [],
    researchWebQueries: Array.isArray(data.researchWebQueries) ? data.researchWebQueries : [],
  }).returning();

  // Seed context entries
  if (data.contextEntries?.length > 0) {
    for (const entry of data.contextEntries) {
      await db.insert(contextEntries).values({
        companyId,
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

export async function suggestMissingVerticals(companyId = DEFAULT_COMPANY_ID): Promise<Array<{
  suggestedName: string;
  suggestedSlug: string;
  rationale: string;
  evidence: string[];
}>> {
  const companyContext = await getCompanyContext(companyId);
  const brandName = companyContext.brandProfile.displayName || companyContext.company.name;
  const verticals = await db.select().from(industryVerticals).where(eq(industryVerticals.companyId, companyId));
  const generalVertical = verticals.find((vertical) => vertical.slug === "general-mounting");

  const unmappedClusters = await db
    .select()
    .from(keywordClusters)
    .where(and(
      eq(keywordClusters.companyId, companyId),
      generalVertical
        ? or(isNull(keywordClusters.verticalId), eq(keywordClusters.verticalId, generalVertical.id))
        : isNull(keywordClusters.verticalId),
    ));

  const unmappedBenchmarkQueries = await db
    .select()
    .from(aiBenchmarkQueries)
    .where(and(eq(aiBenchmarkQueries.companyId, companyId), isNull(aiBenchmarkQueries.verticalId)));

  const evidence = [
    ...unmappedClusters.slice(0, 40).map((cluster) => `keyword cluster: ${cluster.name} / ${cluster.primaryKeyword}`),
    ...unmappedBenchmarkQueries.slice(0, 40).map((query) => `benchmark query: ${query.query}`),
  ];

  if (evidence.length === 0) return [];

  const verticalList = verticals.map((vertical) => `${vertical.slug}: ${vertical.name}`).join("\n");
  const response = await getClient().messages.create({
    model: process.env.BLOG_ANTHROPIC_MODEL || "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [{
      role: "user",
      content: `Analyze unmapped content demand for ${brandName}. Existing verticals:\n${verticalList}\n\nEvidence:\n${evidence.join("\n")}\n\nDo any items represent product categories not covered by existing verticals? Return JSON array only:\n[\n  { "suggestedName": "Vertical name", "suggestedSlug": "vertical-slug", "rationale": "why this is missing", "evidence": ["specific evidence item"] }\n]\nReturn [] if no new vertical is needed.`,
    }],
  });

  const text = response.content.find((item) => item.type === "text")?.text || "";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      suggestedName?: unknown;
      suggestedSlug?: unknown;
      rationale?: unknown;
      evidence?: unknown;
    }>;
    return parsed
      .map((item) => ({
        suggestedName: String(item.suggestedName || "").trim(),
        suggestedSlug: String(item.suggestedSlug || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        rationale: String(item.rationale || "").trim(),
        evidence: Array.isArray(item.evidence) ? item.evidence.map((value) => String(value)) : [],
      }))
      .filter((item) => item.suggestedName && item.suggestedSlug);
  } catch {
    return [];
  }
}

/**
 * Auto-map unclustered keywords to the best-matching vertical.
 */
export async function autoMapKeywordsToVerticals(companyId = DEFAULT_COMPANY_ID): Promise<{ mapped: number }> {
  const companyContext = await getCompanyContext(companyId);
  const brandName = companyContext.brandProfile.displayName || companyContext.company.name;
  const verticals = await db.select().from(industryVerticals).where(eq(industryVerticals.companyId, companyId));
  const unmappedClusters = await db
    .select()
    .from(keywordClusters)
    .where(and(eq(keywordClusters.companyId, companyId), isNull(keywordClusters.verticalId)));

  if (unmappedClusters.length === 0 || verticals.length === 0) return { mapped: 0 };

  const client = getClient();

  const clusterList = unmappedClusters.map((c) => `"${c.primaryKeyword}" (${c.name})`).join(", ");
  const verticalList = verticals.map((v) => `"${v.slug}": ${v.name} - ${v.description?.slice(0, 80)}`).join("\n");
  const fallbackSlug = defaultVerticalSlug(verticals);

  const response = await client.messages.create({
    model: process.env.BLOG_ANTHROPIC_MODEL || "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [{
      role: "user",
      content: `Map each keyword cluster to the best-matching industry vertical for ${brandName}.

Clusters to map: ${clusterList}

Available verticals:
${verticalList}

Return JSON array:
[
  {"clusterKeyword": "primary keyword", "verticalSlug": "best-match-slug"}
]

Every cluster must map to exactly one vertical. Use "${fallbackSlug}" if no more specific vertical fits.`,
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
      await db
        .update(keywordClusters)
        .set({ verticalId: vertical.id })
        .where(and(eq(keywordClusters.companyId, companyId), eq(keywordClusters.id, cluster.id)));
      mapped++;
    }
  }

  return { mapped };
}
