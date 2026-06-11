// Keyword Manager — CSV import, scoring, and LLM-powered clustering
// Handles Ubersuggest/SEMrush position tracking CSV format.

import { db } from "./db";
import { eq, sql, and, isNull } from "drizzle-orm";
import Papa from "papaparse";
import {
  keywords,
  keywordImports,
  keywordClusters,
  industryVerticals,
  type Keyword,
  type KeywordCluster,
  type KeywordImport,
} from "@shared/schema";
import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_COMPANY_ID } from "./companyDefaults";
import { getCompanyContext } from "./companyContext";

function getAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// --- CSV Parsing ---

interface RawCSVRow {
  [key: string]: string | undefined;
}

function getCSVValue(row: RawCSVRow, names: string[]): string {
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = key.trim().toLowerCase();
    if (names.some((name) => normalizedKey === name || normalizedKey.includes(name))) {
      return String(value || "").trim();
    }
  }
  return "";
}

function parseInteger(value: string | undefined): number {
  if (!value) return 0;
  const normalized = value.replace(/,/g, "").replace(/[^\d.-]/g, "").trim();
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parsePosition(value: string | undefined): number {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "-" || normalized === "not ranked" || normalized === "not-ranking") {
    return 0;
  }
  return parseInteger(normalized);
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Parse a position tracking CSV string into keyword records.
 * Handles Ubersuggest format: No, Position, Keyword, Change, SD, Search Volume, URL, Location
 */
export function parseKeywordCSV(csvText: string): Array<{
  keyword: string;
  volume: number;
  difficulty: number;
  position: number;
  url: string;
}> {
  const parsed = Papa.parse<RawCSVRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
    transform: (value) => typeof value === "string" ? value.trim() : value,
  });

  if (parsed.errors.length > 0) {
    const fatal = parsed.errors.find((error) => error.type === "Quotes");
    if (fatal) throw new Error(`CSV parse error: ${fatal.message}`);
  }

  const rows = parsed.data.filter((row) => Object.values(row).some((value) => String(value || "").trim()));
  if (rows.length === 0) return [];
  const hasKeywordColumn = parsed.meta.fields?.some((field) => field.trim().toLowerCase() === "keyword");
  if (!hasKeywordColumn) {
    throw new Error("CSV must have a 'Keyword' column");
  }

  return rows
    .map((row) => {
      const keyword = getCSVValue(row, ["keyword"]);
      return {
        keyword,
        volume: parseInteger(getCSVValue(row, ["search volume", "volume"])),
        difficulty: parseInteger(getCSVValue(row, ["sd", "difficulty"])),
        position: parsePosition(getCSVValue(row, ["position"])),
        url: getCSVValue(row, ["url"]),
      };
    })
    .filter((row) => row.keyword);
}

/**
 * Calculate opportunity score: high volume + low difficulty + not-yet-ranking = high opportunity.
 */
function calculateOpportunityScore(volume: number, difficulty: number, position: number): number {
  // Normalize volume (log scale, 0-100)
  const volumeScore = volume > 0 ? Math.min(100, Math.log10(volume) * 25) : 0;
  // Difficulty inverted (low difficulty = high score)
  const difficultyScore = Math.max(0, 100 - difficulty);
  // Position score: not ranked or low rank = higher opportunity
  const positionScore = position === 0 ? 80 : position > 10 ? 60 : position > 3 ? 30 : 10;

  return Math.round((volumeScore * 0.4 + difficultyScore * 0.3 + positionScore * 0.3) * 10) / 10;
}

/**
 * Import a keyword CSV file into the database.
 */
export async function importKeywordCSV(
  csvText: string,
  filename: string,
  companyId = DEFAULT_COMPANY_ID,
): Promise<{ importId: string; total: number; new_: number; duplicates: number }> {
  const parsed = parseKeywordCSV(csvText);
  if (parsed.length === 0) {
    throw new Error("No keywords found in CSV");
  }

  // Create import record
  const [importRecord] = await db
    .insert(keywordImports)
    .values({ companyId, filename, totalKeywords: parsed.length, newKeywords: 0, duplicateKeywords: 0 })
    .returning();

  let newCount = 0;
  let dupeCount = 0;
  const existingRows = await db
    .select({
      id: keywords.id,
      keyword: keywords.keyword,
    })
    .from(keywords)
    .where(eq(keywords.companyId, companyId));
  const existingByKeyword = new Map(existingRows.map((row) => [row.keyword.trim().toLowerCase(), row]));
  const rowsToInsert: Array<typeof keywords.$inferInsert> = [];

  for (const row of parsed) {
    const key = row.keyword.trim().toLowerCase();
    const existing = existingByKeyword.get(key);
    if (existing) {
      dupeCount++;
      // Update volume/difficulty if they've changed
      await db
        .update(keywords)
        .set({
          volume: row.volume,
          difficulty: row.difficulty,
          opportunityScore: calculateOpportunityScore(row.volume, row.difficulty, row.position),
        })
        .where(and(eq(keywords.companyId, companyId), eq(keywords.id, existing.id)));
      continue;
    }

    const score = calculateOpportunityScore(row.volume, row.difficulty, row.position);
    rowsToInsert.push({
      companyId,
      keyword: row.keyword,
      volume: row.volume,
      difficulty: row.difficulty,
      cpc: 0,
      opportunityScore: score,
      status: "new",
      importId: importRecord.id,
    });
    newCount++;
    existingByKeyword.set(key, { id: "", keyword: row.keyword });
  }

  for (let i = 0; i < rowsToInsert.length; i += 100) {
    const chunk = rowsToInsert.slice(i, i + 100);
    if (chunk.length > 0) {
      await db.insert(keywords).values(chunk);
    }
  }

  // Update import record
  await db
    .update(keywordImports)
    .set({ newKeywords: newCount, duplicateKeywords: dupeCount })
    .where(eq(keywordImports.id, importRecord.id));

  return { importId: importRecord.id, total: parsed.length, new_: newCount, duplicates: dupeCount };
}

/**
 * Use Claude to cluster unclustered keywords into topic groups and assign verticals.
 */
export async function clusterKeywords(companyId = DEFAULT_COMPANY_ID): Promise<{ clusters: number; keywordsAssigned: number }> {
  const unclustered = await db
    .select()
    .from(keywords)
    .where(and(eq(keywords.companyId, companyId), eq(keywords.status, "new"), isNull(keywords.clusterId)));

  if (unclustered.length === 0) return { clusters: 0, keywordsAssigned: 0 };

  const companyContext = await getCompanyContext(companyId);
  const brandName = companyContext.brandProfile.displayName || companyContext.company.name;
  const positioning = companyContext.brandProfile.positioning || companyContext.brandProfile.shortDescription || "an ecommerce brand";
  const verticals = await db.select().from(industryVerticals).where(eq(industryVerticals.companyId, companyId));
  const verticalNames = verticals.map((v) => `${v.name} (${v.slug})`).join(", ");

  const client = getAnthropicClient();
  const keywordChunks = chunkArray(unclustered, 150);
  let clustersCreated = 0;
  let totalAssigned = 0;
  const assignedKeywordIds = new Set<string>();

  for (const keywordChunk of keywordChunks) {
    const kwList = keywordChunk.map((k) => `- "${k.keyword}" (vol: ${k.volume}, diff: ${k.difficulty})`).join("\n");

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `You are an SEO keyword clustering expert for ${brandName}.

Brand positioning:
${positioning}

Group these keywords into clusters that could each become one comprehensive blog post. Each cluster should target a primary keyword and include supporting keywords.

Available industry verticals: ${verticalNames}

Keywords to cluster:
${kwList}

Return JSON array:
[
  {
    "name": "Descriptive Cluster Name",
    "primaryKeyword": "main target keyword",
    "keywords": ["keyword1", "keyword2", ...],
    "verticalSlug": "matching-vertical-slug",
    "rationale": "why these keywords belong together"
  }
]

Rules:
- Group by search intent — keywords someone would expect answered in one post
- Every keyword must appear in exactly one cluster
- Primary keyword should be the highest-volume keyword in the group
- Assign the best-matching vertical slug from the list above`,
        },
      ],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("Failed to parse clustering response");

    const clusters = JSON.parse(jsonMatch[0]) as Array<{
      name: string;
      primaryKeyword: string;
      keywords: string[];
      verticalSlug: string;
    }>;

    for (const cluster of clusters) {
    // Find matching vertical
      const vertical = verticals.find((v) => v.slug === cluster.verticalSlug);

    // Calculate aggregate stats
      const clusterKws = keywordChunk.filter((k) => cluster.keywords.includes(k.keyword) && !assignedKeywordIds.has(k.id));
      if (clusterKws.length === 0) continue;
      const totalVol = clusterKws.reduce((sum, k) => sum + (k.volume || 0), 0);
      const avgDiff = clusterKws.length > 0
        ? clusterKws.reduce((sum, k) => sum + (k.difficulty || 0), 0) / clusterKws.length
        : 0;

      const [clusterRecord] = await db
        .insert(keywordClusters)
        .values({
          companyId,
          name: cluster.name,
          primaryKeyword: cluster.primaryKeyword,
          verticalId: vertical?.id || null,
          totalVolume: totalVol,
          avgDifficulty: Math.round(avgDiff * 10) / 10,
          priority: totalVol / (avgDiff || 1), // simple priority: volume/difficulty ratio
          status: "pending",
        })
        .returning();
      clustersCreated++;

    // Assign keywords to cluster
      for (const kw of clusterKws) {
        await db
          .update(keywords)
          .set({ clusterId: clusterRecord.id, status: "clustered" })
          .where(and(eq(keywords.companyId, companyId), eq(keywords.id, kw.id)));
        assignedKeywordIds.add(kw.id);
        totalAssigned++;
      }
    }
  }

  return { clusters: clustersCreated, keywordsAssigned: totalAssigned };
}

/**
 * Get all keywords with optional filtering.
 */
export async function getKeywords(status?: string, companyId = DEFAULT_COMPANY_ID): Promise<Keyword[]> {
  if (status) {
    return db.select().from(keywords).where(and(eq(keywords.companyId, companyId), eq(keywords.status, status)));
  }
  return db.select().from(keywords).where(eq(keywords.companyId, companyId));
}

/**
 * Get all clusters with their keywords.
 */
export async function getClusters(companyId = DEFAULT_COMPANY_ID): Promise<Array<KeywordCluster & { keywords: Keyword[] }>> {
  const allClusters = await db.select().from(keywordClusters).where(eq(keywordClusters.companyId, companyId));
  const result: Array<KeywordCluster & { keywords: Keyword[] }> = [];

  for (const cluster of allClusters) {
    const kws = await db.select().from(keywords).where(and(eq(keywords.companyId, companyId), eq(keywords.clusterId, cluster.id)));
    result.push({ ...cluster, keywords: kws });
  }

  return result;
}

/**
 * Get import history.
 */
export async function getImports(companyId = DEFAULT_COMPANY_ID): Promise<KeywordImport[]> {
  return db.select().from(keywordImports).where(eq(keywordImports.companyId, companyId));
}
