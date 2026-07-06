import { and, eq } from "drizzle-orm";
import { db } from "../server/db";
import { DEFAULT_COMPANY_ID } from "../server/companyDefaults";
import { seedVerticals } from "../server/contextSeeds";
import { contextEntries, industryVerticals, type InsertContextEntry } from "../shared/schema";
import {
  CONTEXT_ENRICHMENT_RUN_2026_06_22,
  CONTEXT_ENRICHMENT_RUN_ID_2026_06_22,
  type ContextEnrichmentEntry,
  type ContextEntrySourceType,
} from "../server/contextEnrichmentSeeds";

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

function inferSourceType(entry: ContextEnrichmentEntry): ContextEntrySourceType {
  if (entry.sourceType) return entry.sourceType;
  const sourceUrl = entry.sourceUrl || "";
  if (sourceUrl.includes("reddit.com")) return "reddit";
  if (sourceUrl.includes("youtube.com") || sourceUrl.includes("youtu.be")) return "youtube";
  if (sourceUrl) return "web";
  return "manual";
}

function entryKey(category: string, content: string): string {
  return `${category.trim().toLowerCase()}::${content.trim().replace(/\s+/g, " ").toLowerCase()}`;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  await seedVerticals(options.companyId);

  const verticalRows = await db
    .select()
    .from(industryVerticals)
    .where(eq(industryVerticals.companyId, options.companyId));
  const verticalBySlug = new Map(verticalRows.map((vertical) => [vertical.slug, vertical]));

  const existingRows = await db
    .select({
      verticalId: contextEntries.verticalId,
      category: contextEntries.category,
      content: contextEntries.content,
    })
    .from(contextEntries)
    .where(eq(contextEntries.companyId, options.companyId));

  const existingByVertical = new Map<string, Set<string>>();
  for (const row of existingRows) {
    if (!existingByVertical.has(row.verticalId)) {
      existingByVertical.set(row.verticalId, new Set<string>());
    }
    existingByVertical.get(row.verticalId)!.add(entryKey(row.category, row.content));
  }

  const missingVerticals = new Set<string>();
  const duplicateEntries: ContextEnrichmentEntry[] = [];
  const insertValues: InsertContextEntry[] = [];
  const countsByVertical = new Map<string, number>();
  const seenInRun = new Set<string>();

  for (const entry of CONTEXT_ENRICHMENT_RUN_2026_06_22) {
    const vertical = verticalBySlug.get(entry.verticalSlug);
    if (!vertical) {
      missingVerticals.add(entry.verticalSlug);
      continue;
    }

    const key = entryKey(entry.category, entry.content);
    const runKey = `${vertical.id}::${key}`;
    if (seenInRun.has(runKey) || existingByVertical.get(vertical.id)?.has(key)) {
      duplicateEntries.push(entry);
      continue;
    }

    seenInRun.add(runKey);
    insertValues.push({
      companyId: options.companyId,
      verticalId: vertical.id,
      category: entry.category,
      content: entry.content,
      sourceType: inferSourceType(entry),
      sourceUrl: entry.sourceUrl || null,
      confidence: entry.confidence ?? 0.88,
      isVerified: true,
    });
    countsByVertical.set(entry.verticalSlug, (countsByVertical.get(entry.verticalSlug) || 0) + 1);
  }

  if (missingVerticals.size > 0) {
    throw new Error(`Missing vertical slugs for enrichment: ${Array.from(missingVerticals).sort().join(", ")}`);
  }

  if (!options.dryRun && insertValues.length > 0) {
    await db.insert(contextEntries).values(insertValues);
  }

  const afterRows = await db
    .select({
      slug: industryVerticals.slug,
      entryId: contextEntries.id,
    })
    .from(industryVerticals)
    .leftJoin(
      contextEntries,
      and(
        eq(industryVerticals.id, contextEntries.verticalId),
        eq(contextEntries.companyId, options.companyId),
      ),
    )
    .where(eq(industryVerticals.companyId, options.companyId));

  const totalByVertical = new Map<string, number>();
  for (const row of afterRows) {
    totalByVertical.set(row.slug, (totalByVertical.get(row.slug) || 0) + (row.entryId ? 1 : 0));
  }

  const summary = {
    runId: CONTEXT_ENRICHMENT_RUN_ID_2026_06_22,
    companyId: options.companyId,
    dryRun: options.dryRun,
    entriesInRun: CONTEXT_ENRICHMENT_RUN_2026_06_22.length,
    inserted: options.dryRun ? 0 : insertValues.length,
    wouldInsert: options.dryRun ? insertValues.length : 0,
    skippedDuplicates: duplicateEntries.length,
    insertedByVertical: Object.fromEntries([...countsByVertical.entries()].sort()),
    totalContextEntriesByVertical: Object.fromEntries([...totalByVertical.entries()].sort()),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
