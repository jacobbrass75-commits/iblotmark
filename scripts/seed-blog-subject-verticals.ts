import { and, eq } from "drizzle-orm";
import { db } from "../server/db";
import { DEFAULT_COMPANY_ID } from "../server/companyDefaults";
import { contextEntries, industryVerticals, type InsertContextEntry } from "../shared/schema";
import {
  BLOG_SUBJECT_VERTICAL_RUN_ID_2026_06_23,
  BLOG_SUBJECT_VERTICAL_SEEDS_2026_06_23,
  type BlogSubjectVerticalSeed,
} from "../server/blogSubjectVerticalSeeds";
import type { ContextEntrySourceType } from "../server/contextEnrichmentSeeds";

interface ScriptOptions {
  companyId: string;
  dryRun: boolean;
}

function parseOptions(argv: string[]): ScriptOptions {
  let companyId = process.env.DEFAULT_COMPANY_ID || DEFAULT_COMPANY_ID;
  let dryRun = false;

  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg.startsWith("--company-id=")) {
      const value = arg.slice("--company-id=".length).trim();
      if (value) companyId = value;
    }
  }

  return { companyId, dryRun };
}

function inferSourceType(sourceUrl?: string | null, explicit?: ContextEntrySourceType): ContextEntrySourceType {
  if (explicit) return explicit;
  if (!sourceUrl) return "manual";
  if (sourceUrl.includes("reddit.com")) return "reddit";
  if (sourceUrl.includes("youtube.com") || sourceUrl.includes("youtu.be")) return "youtube";
  return "web";
}

function key(category: string, content: string): string {
  return `${category.trim().toLowerCase()}::${content.trim().replace(/\s+/g, " ").toLowerCase()}`;
}

function defaultResearchYoutubeQueries(seed: BlogSubjectVerticalSeed): string[] {
  return [
    `${seed.name} mount setup`,
    `${seed.name} mounting problems`,
    `${seed.name} buyer questions`,
  ];
}

function defaultResearchWebQueries(seed: BlogSubjectVerticalSeed): string[] {
  return [
    `${seed.name} mounting guide`,
    `${seed.name} device mount comparison`,
    `${seed.name} mount buyer questions`,
  ];
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const now = new Date();

  const existingVerticals = await db
    .select()
    .from(industryVerticals)
    .where(eq(industryVerticals.companyId, options.companyId));
  const verticalBySlug = new Map(existingVerticals.map((vertical) => [vertical.slug, vertical]));

  const verticalsToInsert = BLOG_SUBJECT_VERTICAL_SEEDS_2026_06_23.filter(
    (seed) => !verticalBySlug.has(seed.slug),
  );
  const verticalsToUpdate = BLOG_SUBJECT_VERTICAL_SEEDS_2026_06_23.filter(
    (seed) => verticalBySlug.has(seed.slug),
  );

  const insertedVerticals: string[] = [];
  const updatedVerticals: string[] = [];

  if (!options.dryRun) {
    for (const seed of verticalsToInsert) {
      const [vertical] = await db
        .insert(industryVerticals)
        .values({
          companyId: options.companyId,
          name: seed.name,
          slug: seed.slug,
          description: seed.description,
          terminology: seed.terminology,
          painPoints: seed.painPoints,
          useCases: seed.useCases,
          regulations: seed.regulations,
          seasonalRelevance: seed.seasonalRelevance,
          compatibleDevices: seed.compatibleDevices,
          researchSubreddits: seed.researchSubreddits || [],
          researchYoutubeQueries: seed.researchYoutubeQueries || defaultResearchYoutubeQueries(seed),
          researchWebQueries: seed.researchWebQueries || defaultResearchWebQueries(seed),
          lastResearchedAt: now,
          updatedAt: now,
        })
        .returning();
      verticalBySlug.set(seed.slug, vertical);
      insertedVerticals.push(seed.slug);
    }

    for (const seed of verticalsToUpdate) {
      const [vertical] = await db
        .update(industryVerticals)
        .set({
          name: seed.name,
          description: seed.description,
          terminology: seed.terminology,
          painPoints: seed.painPoints,
          useCases: seed.useCases,
          regulations: seed.regulations,
          seasonalRelevance: seed.seasonalRelevance,
          compatibleDevices: seed.compatibleDevices,
          researchSubreddits: seed.researchSubreddits || [],
          researchYoutubeQueries: seed.researchYoutubeQueries || defaultResearchYoutubeQueries(seed),
          researchWebQueries: seed.researchWebQueries || defaultResearchWebQueries(seed),
          lastResearchedAt: now,
          updatedAt: now,
        })
        .where(and(eq(industryVerticals.companyId, options.companyId), eq(industryVerticals.slug, seed.slug)))
        .returning();
      verticalBySlug.set(seed.slug, vertical);
      updatedVerticals.push(seed.slug);
    }
  }

  if (options.dryRun) {
    for (const seed of BLOG_SUBJECT_VERTICAL_SEEDS_2026_06_23) {
      const existing = verticalBySlug.get(seed.slug);
      if (!existing) continue;
      verticalBySlug.set(seed.slug, existing);
    }
  }

  const refreshedVerticals = options.dryRun
    ? existingVerticals
    : await db.select().from(industryVerticals).where(eq(industryVerticals.companyId, options.companyId));
  const refreshedBySlug = new Map(refreshedVerticals.map((vertical) => [vertical.slug, vertical]));

  const existingEntries = await db
    .select({
      verticalId: contextEntries.verticalId,
      category: contextEntries.category,
      content: contextEntries.content,
    })
    .from(contextEntries)
    .where(eq(contextEntries.companyId, options.companyId));

  const existingKeysByVertical = new Map<string, Set<string>>();
  for (const entry of existingEntries) {
    if (!existingKeysByVertical.has(entry.verticalId)) {
      existingKeysByVertical.set(entry.verticalId, new Set());
    }
    existingKeysByVertical.get(entry.verticalId)!.add(key(entry.category, entry.content));
  }

  const entriesToInsert: InsertContextEntry[] = [];
  const skippedMissingVerticals = new Set<string>();
  const skippedDuplicates: string[] = [];
  const entriesByVertical = new Map<string, number>();
  let dryRunEntriesForNewVerticals = 0;
  const seenInRun = new Set<string>();

  for (const seed of BLOG_SUBJECT_VERTICAL_SEEDS_2026_06_23) {
    const vertical = refreshedBySlug.get(seed.slug);
    if (!vertical) {
      if (options.dryRun) {
        entriesByVertical.set(seed.slug, seed.contextEntries.length);
        dryRunEntriesForNewVerticals += seed.contextEntries.length;
        continue;
      }
      skippedMissingVerticals.add(seed.slug);
      continue;
    }

    for (const entry of seed.contextEntries) {
      const entryKey = key(entry.category, entry.content);
      const runKey = `${vertical.id}::${entryKey}`;
      if (seenInRun.has(runKey) || existingKeysByVertical.get(vertical.id)?.has(entryKey)) {
        skippedDuplicates.push(`${seed.slug}:${entry.category}`);
        continue;
      }
      seenInRun.add(runKey);
      entriesToInsert.push({
        companyId: options.companyId,
        verticalId: vertical.id,
        category: entry.category,
        content: entry.content,
        sourceType: inferSourceType(entry.sourceUrl, entry.sourceType),
        sourceUrl: entry.sourceUrl || null,
        confidence: entry.confidence ?? 0.9,
        isVerified: true,
      });
      entriesByVertical.set(seed.slug, (entriesByVertical.get(seed.slug) || 0) + 1);
    }
  }

  if (skippedMissingVerticals.size > 0) {
    throw new Error(`Missing blog-subject verticals: ${Array.from(skippedMissingVerticals).sort().join(", ")}`);
  }

  if (!options.dryRun && entriesToInsert.length > 0) {
    await db.insert(contextEntries).values(entriesToInsert);
  }

  const allVerticalsAfter = await db
    .select({ slug: industryVerticals.slug })
    .from(industryVerticals)
    .where(eq(industryVerticals.companyId, options.companyId));
  const blogSubjectSlugs = new Set(BLOG_SUBJECT_VERTICAL_SEEDS_2026_06_23.map((seed) => seed.slug));

  const summary = {
    runId: BLOG_SUBJECT_VERTICAL_RUN_ID_2026_06_23,
    companyId: options.companyId,
    dryRun: options.dryRun,
    blogSubjectVerticalsInRun: BLOG_SUBJECT_VERTICAL_SEEDS_2026_06_23.length,
    insertedVerticals: options.dryRun ? verticalsToInsert.map((seed) => seed.slug) : insertedVerticals,
    updatedVerticals: options.dryRun ? verticalsToUpdate.map((seed) => seed.slug) : updatedVerticals,
    insertedEntries: options.dryRun ? 0 : entriesToInsert.length,
    wouldInsertEntries: options.dryRun ? entriesToInsert.length + dryRunEntriesForNewVerticals : 0,
    skippedDuplicateEntries: skippedDuplicates.length,
    entriesByVertical: Object.fromEntries([...entriesByVertical.entries()].sort()),
    totalVerticalsAfter: allVerticalsAfter.length,
    totalBlogSubjectVerticalsPresent: allVerticalsAfter.filter((vertical) => blogSubjectSlugs.has(vertical.slug)).length,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
