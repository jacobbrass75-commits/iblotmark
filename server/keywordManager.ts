// Keyword Manager — CSV import, scoring, and LLM-powered clustering
// Handles Ubersuggest/SEMrush position tracking CSV format.

import { db } from "./db";
import { eq, sql, and, isNull } from "drizzle-orm";
import {
  keywords,
  keywordImports,
  keywordClusters,
  industryVerticals,
  type InsertKeyword,
  type Keyword,
  type KeywordCluster,
  type KeywordImport,
} from "@shared/schema";
import Anthropic from "@anthropic-ai/sdk";

function getAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// --- CSV Parsing ---

interface RawCSVRow {
  No: string;
  Position: string;
  Keyword: string;
  Change: string;
  SD: string;
  "Search Volume": string;
  URL: string;
  Location: string;
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
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];

  const header = lines[0];
  // Simple CSV parsing that handles quoted fields
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseCSVLine(header);
  const keywordIdx = headers.findIndex((h) => h.toLowerCase() === "keyword");
  const volumeIdx = headers.findIndex((h) => h.toLowerCase().includes("search volume") || h.toLowerCase() === "volume");
  const difficultyIdx = headers.findIndex((h) => h.toLowerCase() === "sd" || h.toLowerCase().includes("difficulty"));
  const positionIdx = headers.findIndex((h) => h.toLowerCase() === "position");
  const urlIdx = headers.findIndex((h) => h.toLowerCase() === "url");

  if (keywordIdx === -1) {
    throw new Error("CSV must have a 'Keyword' column");
  }

  const results: Array<{
    keyword: string;
    volume: number;
    difficulty: number;
    position: number;
    url: string;
  }> = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCSVLine(line);
    const kw = cols[keywordIdx]?.replace(/^"|"$/g, "");
    if (!kw) continue;

    const posRaw = positionIdx >= 0 ? cols[positionIdx] : "";
    const position = posRaw === "Not ranked" || posRaw === "-" ? 0 : parseInt(posRaw) || 0;

    results.push({
      keyword: kw,
      volume: volumeIdx >= 0 ? parseInt(cols[volumeIdx]?.replace(/,/g, "")) || 0 : 0,
      difficulty: difficultyIdx >= 0 ? parseInt(cols[difficultyIdx]) || 0 : 0,
      position,
      url: urlIdx >= 0 ? cols[urlIdx]?.replace(/^"|"$/g, "") || "" : "",
    });
  }

  return results;
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
): Promise<{ importId: string; total: number; new_: number; duplicates: number }> {
  const parsed = parseKeywordCSV(csvText);
  if (parsed.length === 0) {
    throw new Error("No keywords found in CSV");
  }

  // Create import record
  const [importRecord] = await db
    .insert(keywordImports)
    .values({ filename, totalKeywords: parsed.length, newKeywords: 0, duplicateKeywords: 0 })
    .returning();

  let newCount = 0;
  let dupeCount = 0;

  for (const row of parsed) {
    // Check for duplicates
    const existing = await db
      .select()
      .from(keywords)
      .where(eq(keywords.keyword, row.keyword))
      .limit(1);

    if (existing.length > 0) {
      dupeCount++;
      // Update volume/difficulty if they've changed
      await db
        .update(keywords)
        .set({
          volume: row.volume,
          difficulty: row.difficulty,
          opportunityScore: calculateOpportunityScore(row.volume, row.difficulty, row.position),
        })
        .where(eq(keywords.id, existing[0].id));
      continue;
    }

    const score = calculateOpportunityScore(row.volume, row.difficulty, row.position);

    await db.insert(keywords).values({
      keyword: row.keyword,
      volume: row.volume,
      difficulty: row.difficulty,
      cpc: 0,
      opportunityScore: score,
      status: "new",
      importId: importRecord.id,
    });
    newCount++;
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
export async function clusterKeywords(): Promise<{ clusters: number; keywordsAssigned: number }> {
  const unclustered = await db
    .select()
    .from(keywords)
    .where(and(eq(keywords.status, "new"), isNull(keywords.clusterId)));

  if (unclustered.length === 0) return { clusters: 0, keywordsAssigned: 0 };

  const verticals = await db.select().from(industryVerticals);
  const verticalNames = verticals.map((v) => `${v.name} (${v.slug})`).join(", ");

  const client = getAnthropicClient();

  const kwList = unclustered.map((k) => `- "${k.keyword}" (vol: ${k.volume}, diff: ${k.difficulty})`).join("\n");

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are an SEO keyword clustering expert for iBolt Mounts (device mounting solutions).

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

  let totalAssigned = 0;

  for (const cluster of clusters) {
    // Find matching vertical
    const vertical = verticals.find((v) => v.slug === cluster.verticalSlug);

    // Calculate aggregate stats
    const clusterKws = unclustered.filter((k) => cluster.keywords.includes(k.keyword));
    const totalVol = clusterKws.reduce((sum, k) => sum + (k.volume || 0), 0);
    const avgDiff = clusterKws.length > 0
      ? clusterKws.reduce((sum, k) => sum + (k.difficulty || 0), 0) / clusterKws.length
      : 0;

    const [clusterRecord] = await db
      .insert(keywordClusters)
      .values({
        name: cluster.name,
        primaryKeyword: cluster.primaryKeyword,
        verticalId: vertical?.id || null,
        totalVolume: totalVol,
        avgDifficulty: Math.round(avgDiff * 10) / 10,
        priority: totalVol / (avgDiff || 1), // simple priority: volume/difficulty ratio
        status: "pending",
      })
      .returning();

    // Assign keywords to cluster
    for (const kw of clusterKws) {
      await db
        .update(keywords)
        .set({ clusterId: clusterRecord.id, status: "clustered" })
        .where(eq(keywords.id, kw.id));
      totalAssigned++;
    }
  }

  return { clusters: clusters.length, keywordsAssigned: totalAssigned };
}

/**
 * Get all keywords with optional filtering.
 */
export async function getKeywords(status?: string): Promise<Keyword[]> {
  if (status) {
    return db.select().from(keywords).where(eq(keywords.status, status));
  }
  return db.select().from(keywords);
}

/**
 * Get all clusters with their keywords.
 */
export async function getClusters(): Promise<Array<KeywordCluster & { keywords: Keyword[] }>> {
  const allClusters = await db.select().from(keywordClusters);
  const result: Array<KeywordCluster & { keywords: Keyword[] }> = [];

  for (const cluster of allClusters) {
    const kws = await db.select().from(keywords).where(eq(keywords.clusterId, cluster.id));
    result.push({ ...cluster, keywords: kws });
  }

  return result;
}

/**
 * Get import history.
 */
export async function getImports(): Promise<KeywordImport[]> {
  return db.select().from(keywordImports);
}
