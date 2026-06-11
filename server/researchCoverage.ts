import { eq } from "drizzle-orm";
import { db } from "./db";
import { contextEntries, industryVerticals } from "@shared/schema";
import { DEFAULT_COMPANY_ID } from "./companyDefaults";

export type ResearchStaleness = "fresh" | "aging" | "stale" | "never";

export interface ResearchCoverageRow {
  verticalId: string;
  name: string;
  slug: string;
  totalEntries: number;
  entriesByCategory: Record<string, number>;
  seedOnlyEntries: boolean;
  lastResearchedAt: Date | null;
  staleness: ResearchStaleness;
  hasResearchSources: boolean;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

export function getResearchStaleness(lastResearchedAt: Date | null, now = new Date()): ResearchStaleness {
  if (!lastResearchedAt) return "never";
  const ageMs = now.getTime() - lastResearchedAt.getTime();
  if (ageMs < 7 * 24 * 60 * 60 * 1000) return "fresh";
  if (ageMs < 30 * 24 * 60 * 60 * 1000) return "aging";
  return "stale";
}

export async function getResearchCoverage(companyId = DEFAULT_COMPANY_ID): Promise<ResearchCoverageRow[]> {
  const verticals = await db
    .select()
    .from(industryVerticals)
    .where(eq(industryVerticals.companyId, companyId));
  const entries = await db
    .select()
    .from(contextEntries)
    .where(eq(contextEntries.companyId, companyId));

  return verticals.map((vertical) => {
    const verticalEntries = entries.filter((entry) => entry.verticalId === vertical.id);
    const entriesByCategory: Record<string, number> = {};
    let nonSeedEntries = 0;

    for (const entry of verticalEntries) {
      entriesByCategory[entry.category] = (entriesByCategory[entry.category] || 0) + 1;
      if (entry.sourceType !== "seed") nonSeedEntries++;
    }

    const lastResearchedAt = vertical.lastResearchedAt ? new Date(vertical.lastResearchedAt) : null;
    const hasResearchSources = [
      ...stringArray(vertical.researchSubreddits),
      ...stringArray(vertical.researchYoutubeQueries),
      ...stringArray(vertical.researchWebQueries),
    ].length > 0;

    return {
      verticalId: vertical.id,
      name: vertical.name,
      slug: vertical.slug,
      totalEntries: verticalEntries.length,
      entriesByCategory,
      seedOnlyEntries: verticalEntries.length > 0 && nonSeedEntries === 0,
      lastResearchedAt,
      staleness: getResearchStaleness(lastResearchedAt),
      hasResearchSources,
    };
  });
}
