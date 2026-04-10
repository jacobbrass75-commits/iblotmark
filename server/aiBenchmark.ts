import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import pLimit from "p-limit";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import {
  aiBenchmarkQueries,
  aiBenchmarkResults,
  aiBenchmarkRuns,
  blogPosts,
  keywordClusters,
  products,
  keywords,
  type AiBenchmarkQuery,
  type AiBenchmarkResult,
  type AiBenchmarkRun,
  type InsertAiBenchmarkQuery,
} from "@shared/schema";
import { computeSimilarity, toTitleCase } from "./aiBenchmarkUtils";
import { writingQueue } from "./writingQueue";

export const BENCHMARK_PROVIDERS = [
  "chatgpt",
  "claude",
  "gemini",
  "google_search",
] as const;

export type BenchmarkProvider = typeof BENCHMARK_PROVIDERS[number];

export interface BenchmarkProgressEvent {
  type: "started" | "progress" | "completed";
  runId: string;
  message: string;
  current?: number;
  total?: number;
  query?: string;
  provider?: BenchmarkProvider;
  result?: AiBenchmarkResult;
  summary?: BenchmarkRunSummary;
}

export interface BenchmarkRunOptions {
  name?: string;
  queryIds?: string[];
  providers?: BenchmarkProvider[];
  concurrency?: number;
}

export interface BenchmarkRunSummary {
  run: AiBenchmarkRun;
  providerSummaries: Array<{
    provider: BenchmarkProvider;
    queriesEvaluated: number;
    completedCount: number;
    skippedCount: number;
    failedCount: number;
    mentionRate: number;
    citationRate: number;
    topThreeRate: number;
    avgScore: number;
  }>;
  querySummaries: Array<{
    queryId: string;
    query: string;
    category: string;
    label: string | null;
    verticalId: string | null;
    priority: number;
    averageScore: number;
    averageMentionRate: number;
    weakestProviders: BenchmarkProvider[];
    results: AiBenchmarkResult[];
  }>;
  biggestGaps: Array<{
    queryId: string;
    query: string;
    provider: BenchmarkProvider;
    score: number;
    reason: string;
  }>;
  topWins: Array<{
    queryId: string;
    query: string;
    provider: BenchmarkProvider;
    score: number;
  }>;
}

export interface ContentPlanItem {
  queryId: string;
  query: string;
  verticalId?: string | null;
  title: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  format: "comparison" | "buying_guide" | "use_case" | "compatibility" | "problem_solution";
  angle: string;
  whyNow: string;
  uniquenessReason: string;
  supportingProducts: string[];
  researchNeeds: string[];
  recommendedProviders: BenchmarkProvider[];
  closestExistingTitle?: string;
  similarityScore?: number;
  gapScore: number;
}

type ProviderExecution =
  | {
      status: "completed";
      model: string;
      prompt: string;
      responseText: string;
      sourceUrls: string[];
    }
  | {
      status: "skipped" | "failed";
      model: string;
      prompt: string;
      error: string;
      responseText?: string;
      sourceUrls?: string[];
    };

type ExistingContentItem = {
  title: string;
  kind: "post" | "cluster";
};

export interface MaterializeContentPlanOptions {
  item: ContentPlanItem;
  generateNow?: boolean;
  queueForGeneration?: boolean;
}

const OPENAI_DEFAULT_MODEL = process.env.AI_BENCHMARK_OPENAI_MODEL || "gpt-4.1";
const ANTHROPIC_DEFAULT_MODEL = process.env.AI_BENCHMARK_ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
const GEMINI_DEFAULT_MODEL = process.env.AI_BENCHMARK_GEMINI_MODEL || "gemini-2.5-flash";

const KNOWN_COMPETITORS = [
  "RAM",
  "RAM Mounts",
  "Havis",
  "Zebra",
  "Agoz",
  "iOttie",
  "ROKFORM",
  "Peak Design",
  "MagTough",
  "MobNetic",
  "Bracketron",
  "Mount-It!",
  "Bouncepad",
  "Arkon",
  "Square",
  "SIIG",
  "ProClip",
  "Tackform",
  "CTA Digital",
  "Heckler",
  "Kensington",
];

const POSITIONING_TAGS: Array<{ tag: string; terms: string[] }> = [
  { tag: "specialist", terms: ["purpose-built", "specialized", "warehouse", "forklift", "fleet", "commercial", "eld", "restaurant"] },
  { tag: "budget", terms: ["budget", "cheap", "cheaper", "affordable", "low-cost", "economical"] },
  { tag: "value", terms: ["best value", "value pick", "cost-conscious", "cost effective"] },
  { tag: "modular", terms: ["modular", "amps", "ball size", "interchangeable", "configurator"] },
  { tag: "rugged", terms: ["heavy-duty", "industrial", "rugged", "locking", "drill-in"] },
];

let openaiClient: OpenAI | null = null;
function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "missing" });
  }
  return openaiClient;
}

function getAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function buildBenchmarkPrompt(query: string): string {
  return [
    "Answer this buyer-style product query using the best current information you can find.",
    "If you recommend products, rank the strongest options in order and explain why each one is there.",
    "Be specific about commercial use cases, durability, installation style, and tradeoffs when relevant.",
    `Query: "${query}"`,
  ].join("\n");
}

function normalizeQuery(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value && value.trim())).map((value) => value.trim())));
}

function collectUrls(value: unknown, sink = new Set<string>()): string[] {
  if (typeof value === "string") {
    const matches = value.match(/https?:\/\/[^\s)<>"']+/g) || [];
    for (const match of matches) {
      sink.add(match.replace(/[),.;]+$/, ""));
    }
    return Array.from(sink);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectUrls(item, sink);
    }
    return Array.from(sink);
  }

  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (typeof nested === "string" && key.toLowerCase().includes("url") && nested.startsWith("http")) {
        sink.add(nested);
      } else {
        collectUrls(nested, sink);
      }
    }
  }

  return Array.from(sink);
}

function extractOpenAIText(response: any): string {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const texts: string[] = [];
  for (const block of response?.output || []) {
    for (const part of block?.content || []) {
      if (typeof part?.text === "string") {
        texts.push(part.text);
      }
    }
  }

  return texts.join("\n\n").trim();
}

function extractAnthropicText(message: any): string {
  return (message?.content || [])
    .filter((block: any) => block?.type === "text" && typeof block?.text === "string")
    .map((block: any) => block.text)
    .join("\n\n")
    .trim();
}

function extractGeminiText(response: any): string {
  const parts = response?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function extractGeminiGroundingUrls(response: any): string[] {
  const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const urls = chunks.map((chunk: any) => chunk?.web?.uri).filter(Boolean);
  return dedupeStrings(urls);
}

function getKnownCompetitors(text: string): string[] {
  const lower = text.toLowerCase();
  return KNOWN_COMPETITORS.filter((brand) => lower.includes(brand.toLowerCase()));
}

function getPositioningTags(text: string): string[] {
  const lower = text.toLowerCase();
  return POSITIONING_TAGS
    .filter(({ terms }) => terms.some((term) => lower.includes(term)))
    .map(({ tag }) => tag);
}

function findTopPickRank(text: string): number | null {
  const lower = text.toLowerCase();
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    if (!/\bibolt\b/i.test(line)) continue;

    const numberedMatch = line.match(/^(\d+)[.)-]\s/);
    if (numberedMatch) {
      return Number.parseInt(numberedMatch[1] || "", 10);
    }

    const hashMatch = line.match(/#\s?(\d+)/);
    if (hashMatch) {
      return Number.parseInt(hashMatch[1] || "", 10);
    }
  }

  if ((/best overall|top pick|overall winner/.test(lower)) && /\bibolt\b/.test(lower)) {
    return 1;
  }

  return null;
}

function getSentiment(brandMentioned: boolean, positioningTags: string[], rank: number | null): string {
  if (!brandMentioned) return "absent";
  if (rank && rank <= 3) return "strong";
  if (positioningTags.includes("specialist")) return "specialist";
  if (positioningTags.includes("budget") && !positioningTags.includes("specialist")) return "budget";
  return "mixed";
}

function buildPositioningSummary(brandMentioned: boolean, cited: boolean, tags: string[], rank: number | null): string {
  if (!brandMentioned) {
    return cited
      ? "iBolt sources were cited but the brand still did not make the recommendation list."
      : "iBolt was absent from the recommendation set.";
  }

  const tagSummary = tags.length > 0 ? tags.join(", ") : "general";
  const rankSummary = rank ? `Ranked at #${rank}.` : "No explicit list rank was detected.";
  const citationSummary = cited ? "iboltmounts.com was cited." : "iboltmounts.com was not cited.";
  return `${rankSummary} Framing tags: ${tagSummary}. ${citationSummary}`;
}

function analyzeResponse(
  query: AiBenchmarkQuery,
  responseText: string,
  sourceUrls: string[],
  allProducts: Array<{ title: string; handle: string }>,
): Omit<
  typeof aiBenchmarkResults.$inferInsert,
  "runId" | "queryId" | "provider" | "model" | "prompt" | "status" | "error"
> {
  const lower = responseText.toLowerCase();
  const brandMentioned = /\bi[\s-]?bolt\b/i.test(responseText);
  const iboltCited = sourceUrls.some((url) => {
    try {
      return new URL(url).hostname.includes("iboltmounts.com");
    } catch {
      return url.includes("iboltmounts.com");
    }
  });
  const mentionedProducts = dedupeStrings(
    allProducts
      .filter((product) => {
        const normalizedHandle = product.handle.toLowerCase().replace(/-/g, " ");
        return lower.includes(product.title.toLowerCase()) || lower.includes(normalizedHandle);
      })
      .map((product) => product.title),
  );
  const competitors = dedupeStrings(getKnownCompetitors(responseText).filter((brand) => !/ibolt/i.test(brand)));
  const topPickRank = findTopPickRank(responseText);
  const positioningTags = getPositioningTags(responseText);
  const sentiment = getSentiment(brandMentioned, positioningTags, topPickRank);

  let coverageScore = 0;
  if (brandMentioned) coverageScore += 35;
  if (iboltCited) coverageScore += 20;
  if (topPickRank === 1) coverageScore += 25;
  else if (topPickRank && topPickRank <= 3) coverageScore += 18;
  else if (topPickRank) coverageScore += 10;
  if (positioningTags.includes("specialist")) coverageScore += 10;
  if (positioningTags.includes("modular")) coverageScore += 5;
  if (positioningTags.includes("budget") && !positioningTags.includes("specialist")) coverageScore -= 8;
  coverageScore += Math.min(10, mentionedProducts.length * 3);

  const analysisNotes = [
    brandMentioned ? "iBolt surfaced in the answer." : "iBolt did not surface in the answer.",
    iboltCited ? "Provider cited iboltmounts.com." : "Provider did not cite iboltmounts.com.",
    topPickRank ? `Detected explicit ranking at #${topPickRank}.` : "No explicit list ranking detected.",
    competitors.length > 0 ? `Competitors named: ${competitors.join(", ")}.` : "No known competitors detected.",
    query.benchmarkGoal ? `Benchmark goal: ${query.benchmarkGoal}` : null,
  ].filter(Boolean).join(" ");

  return {
    rawResponse: responseText,
    brandMentioned,
    iboltCited,
    topPickRank,
    coverageScore: clampScore(coverageScore),
    sentiment,
    positioning: buildPositioningSummary(brandMentioned, iboltCited, positioningTags, topPickRank),
    positioningTags,
    mentionedProducts,
    competitors,
    sourceUrls: dedupeStrings(sourceUrls),
    analysisNotes,
  };
}

async function runOpenAiProvider(prompt: string): Promise<ProviderExecution> {
  if (!process.env.OPENAI_API_KEY) {
    return {
      status: "skipped",
      model: OPENAI_DEFAULT_MODEL,
      prompt,
      error: "OPENAI_API_KEY is not configured.",
    };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_DEFAULT_MODEL,
        input: prompt,
        tools: [{ type: "web_search" }],
        max_output_tokens: 900,
      }),
      signal: AbortSignal.timeout(75000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI API returned ${response.status}: ${body}`);
    }

    const json = await response.json();

    return {
      status: "completed",
      model: OPENAI_DEFAULT_MODEL,
      prompt,
      responseText: extractOpenAIText(json),
      sourceUrls: collectUrls(json),
    };
  } catch (error: any) {
    return {
      status: "failed",
      model: OPENAI_DEFAULT_MODEL,
      prompt,
      error: error.message || "OpenAI benchmark call failed.",
    };
  }
}

async function runAnthropicProvider(prompt: string): Promise<ProviderExecution> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      status: "skipped",
      model: ANTHROPIC_DEFAULT_MODEL,
      prompt,
      error: "ANTHROPIC_API_KEY is not configured.",
    };
  }

  const client = getAnthropicClient();
  const toolTypes = ["web_search_20260209", "web_search_20250305"];

  for (const toolType of toolTypes) {
    try {
      const message = await client.messages.create({
        model: ANTHROPIC_DEFAULT_MODEL,
        max_tokens: 1600,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: toolType, name: "web_search", max_uses: 3 }],
      } as any);

      return {
        status: "completed",
        model: ANTHROPIC_DEFAULT_MODEL,
        prompt,
        responseText: extractAnthropicText(message),
        sourceUrls: collectUrls(message),
      };
    } catch (error: any) {
      if (toolType !== toolTypes[toolTypes.length - 1]) {
        continue;
      }

      return {
        status: "failed",
        model: ANTHROPIC_DEFAULT_MODEL,
        prompt,
        error: error.message || "Anthropic benchmark call failed.",
      };
    }
  }

  return {
    status: "failed",
    model: ANTHROPIC_DEFAULT_MODEL,
    prompt,
    error: "Anthropic web search tool is unavailable.",
  };
}

async function runGeminiProvider(prompt: string, grounded: boolean): Promise<ProviderExecution> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  const models = dedupeStrings([GEMINI_DEFAULT_MODEL, "gemini-2.5-flash-lite"]);
  if (!apiKey) {
    return {
      status: "skipped",
      model: GEMINI_DEFAULT_MODEL,
      prompt,
      error: "GEMINI_API_KEY or GOOGLE_AI_API_KEY is not configured.",
    };
  }

  let lastError = "Gemini benchmark call failed.";

  for (const model of models) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.2,
            },
            ...(grounded ? { tools: [{ google_search: {} }] } : {}),
          }),
          signal: AbortSignal.timeout(45000),
        },
      );

      if (!response.ok) {
        const body = await response.text();
        lastError = `Gemini API returned ${response.status}: ${body}`;
        if (response.status === 503 || response.status === 429) {
          continue;
        }
        throw new Error(lastError);
      }

      const json = await response.json();
      return {
        status: "completed",
        model,
        prompt,
        responseText: extractGeminiText(json),
        sourceUrls: grounded ? extractGeminiGroundingUrls(json) : collectUrls(json),
      };
    } catch (error: any) {
      lastError = error.message || lastError;
      if (/503|429|timeout/i.test(lastError)) {
        continue;
      }
      return {
        status: "failed",
        model,
        prompt,
        error: lastError,
      };
    }
  }

  return {
    status: "failed",
    model: models[models.length - 1] || GEMINI_DEFAULT_MODEL,
    prompt,
    error: lastError,
  };
}

async function runProvider(provider: BenchmarkProvider, prompt: string): Promise<ProviderExecution> {
  switch (provider) {
    case "chatgpt":
      return runOpenAiProvider(prompt);
    case "claude":
      return runAnthropicProvider(prompt);
    case "gemini":
      return runGeminiProvider(prompt, true);
    case "google_search":
      return runGeminiProvider(prompt, true);
  }
}

function sortQueries(rows: AiBenchmarkQuery[]): AiBenchmarkQuery[] {
  return [...rows].sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.query.localeCompare(b.query));
}

export async function listBenchmarkQueries(): Promise<AiBenchmarkQuery[]> {
  const rows = await db.select().from(aiBenchmarkQueries);
  return sortQueries(rows);
}

export async function createBenchmarkQuery(input: Omit<InsertAiBenchmarkQuery, "query"> & { query: string }): Promise<AiBenchmarkQuery> {
  const [row] = await db.insert(aiBenchmarkQueries).values({
    ...input,
    query: normalizeQuery(input.query),
    status: input.status || "active",
    updatedAt: new Date(),
  }).returning();
  return row;
}

export async function updateBenchmarkQuery(
  id: string,
  updates: Partial<Omit<InsertAiBenchmarkQuery, "query"> & { query: string }>,
): Promise<AiBenchmarkQuery> {
  const payload: Partial<typeof aiBenchmarkQueries.$inferInsert> = { updatedAt: new Date() };
  if (updates.category !== undefined) payload.category = updates.category;
  if (updates.label !== undefined) payload.label = updates.label;
  if (updates.query !== undefined) payload.query = normalizeQuery(updates.query);
  if (updates.verticalId !== undefined) payload.verticalId = updates.verticalId;
  if (updates.intentType !== undefined) payload.intentType = updates.intentType;
  if (updates.priority !== undefined) payload.priority = updates.priority;
  if (updates.benchmarkGoal !== undefined) payload.benchmarkGoal = updates.benchmarkGoal;
  if (updates.notes !== undefined) payload.notes = updates.notes;
  if (updates.status !== undefined) payload.status = updates.status;

  const [row] = await db.update(aiBenchmarkQueries).set(payload).where(eq(aiBenchmarkQueries.id, id)).returning();
  return row;
}

export async function listBenchmarkRuns(limit = 10): Promise<AiBenchmarkRun[]> {
  const rows = await db.select().from(aiBenchmarkRuns).orderBy(desc(aiBenchmarkRuns.createdAt));
  return rows.slice(0, limit);
}

function buildRunSummary(
  run: AiBenchmarkRun,
  queries: AiBenchmarkQuery[],
  results: AiBenchmarkResult[],
): BenchmarkRunSummary {
  const providerSummaries = (run.providers as BenchmarkProvider[]).map((provider) => {
    const providerResults = results.filter((result) => result.provider === provider);
    const completed = providerResults.filter((result) => result.status === "completed");
    const mentionRate = completed.length > 0
      ? Math.round((completed.filter((result) => result.brandMentioned).length / completed.length) * 100)
      : 0;
    const citationRate = completed.length > 0
      ? Math.round((completed.filter((result) => result.iboltCited).length / completed.length) * 100)
      : 0;
    const topThreeRate = completed.length > 0
      ? Math.round((completed.filter((result) => (result.topPickRank || 99) <= 3).length / completed.length) * 100)
      : 0;
    const avgScore = completed.length > 0
      ? Math.round(completed.reduce((sum, result) => sum + (result.coverageScore || 0), 0) / completed.length)
      : 0;

    return {
      provider,
      queriesEvaluated: providerResults.length,
      completedCount: completed.length,
      skippedCount: providerResults.filter((result) => result.status === "skipped").length,
      failedCount: providerResults.filter((result) => result.status === "failed").length,
      mentionRate,
      citationRate,
      topThreeRate,
      avgScore,
    };
  });

  const querySummaries = queries.map((query) => {
    const queryResults = results
      .filter((result) => result.queryId === query.id)
      .sort((a, b) => (b.coverageScore || 0) - (a.coverageScore || 0));
    const completed = queryResults.filter((result) => result.status === "completed");
    const averageScore = completed.length > 0
      ? Math.round(completed.reduce((sum, result) => sum + (result.coverageScore || 0), 0) / completed.length)
      : 0;
    const averageMentionRate = completed.length > 0
      ? Math.round((completed.filter((result) => result.brandMentioned).length / completed.length) * 100)
      : 0;
    const weakestProviders = queryResults
      .filter((result) => result.status !== "completed" || !result.brandMentioned || (result.coverageScore || 0) < 60)
      .sort((a, b) => (a.coverageScore || 0) - (b.coverageScore || 0))
      .map((result) => result.provider as BenchmarkProvider);

    return {
      queryId: query.id,
      query: query.query,
      category: query.category,
      label: query.label,
      verticalId: query.verticalId,
      priority: query.priority || 0,
      averageScore,
      averageMentionRate,
      weakestProviders: dedupeStrings(weakestProviders) as BenchmarkProvider[],
      results: queryResults,
    };
  });

  const biggestGaps = results
    .filter((result) => result.status !== "completed" || !result.brandMentioned || (result.coverageScore || 0) < 70)
    .sort((a, b) => (a.coverageScore || 0) - (b.coverageScore || 0))
    .slice(0, 8)
    .map((result) => {
      const query = queries.find((item) => item.id === result.queryId);
      return {
        queryId: result.queryId,
        query: query?.query || "Unknown query",
        provider: result.provider as BenchmarkProvider,
        score: result.coverageScore || 0,
        reason: result.status === "failed"
          ? result.error || "Provider failed."
          : result.status === "skipped"
            ? result.error || "Provider skipped."
            : result.analysisNotes || result.positioning || "Weak benchmark result.",
      };
    });

  const topWins = results
    .filter((result) => result.status === "completed" && result.brandMentioned)
    .sort((a, b) => (b.coverageScore || 0) - (a.coverageScore || 0))
    .slice(0, 6)
    .map((result) => {
      const query = queries.find((item) => item.id === result.queryId);
      return {
        queryId: result.queryId,
        query: query?.query || "Unknown query",
        provider: result.provider as BenchmarkProvider,
        score: result.coverageScore || 0,
      };
    });

  return {
    run,
    providerSummaries,
    querySummaries,
    biggestGaps,
    topWins,
  };
}

export async function getBenchmarkRunSummary(runId: string): Promise<BenchmarkRunSummary | null> {
  const [run] = await db.select().from(aiBenchmarkRuns).where(eq(aiBenchmarkRuns.id, runId)).limit(1);
  if (!run) return null;

  const results = await db.select().from(aiBenchmarkResults).where(eq(aiBenchmarkResults.runId, runId));
  const queryIds = dedupeStrings(results.map((result) => result.queryId));
  const queries = queryIds.length > 0
    ? await db.select().from(aiBenchmarkQueries).where(inArray(aiBenchmarkQueries.id, queryIds))
    : [];

  return buildRunSummary(run, queries, results);
}

export async function getLatestBenchmarkRunSummary(): Promise<BenchmarkRunSummary | null> {
  const [run] = await db.select().from(aiBenchmarkRuns).orderBy(desc(aiBenchmarkRuns.createdAt)).limit(1);
  if (!run) return null;
  return getBenchmarkRunSummary(run.id);
}

function getClosestExistingContent(
  planText: string,
  existingInventory: ExistingContentItem[],
): { title?: string; similarity: number } {
  let closest: ExistingContentItem | null = null;
  let bestScore = 0;

  for (const item of existingInventory) {
    const score = computeSimilarity(planText, item.title);
    if (score > bestScore) {
      bestScore = score;
      closest = item;
    }
  }

  return {
    title: closest?.title,
    similarity: bestScore,
  };
}

function classifyFormatFromQuery(query: string): ContentPlanItem["format"] {
  if (/\bvs\b/.test(query)) return "comparison";
  if (query.startsWith("best ")) return "buying_guide";
  if (query.includes("compatible") || query.includes("fits")) return "compatibility";
  if (query.includes("how to") || query.includes("install")) return "problem_solution";
  return "use_case";
}

function buildDeterministicPlanItem(
  querySummary: BenchmarkRunSummary["querySummaries"][number],
  existingInventory: ExistingContentItem[],
  productTitles: string[],
): ContentPlanItem {
  const closest = getClosestExistingContent(querySummary.query, existingInventory);
  const format = classifyFormatFromQuery(querySummary.query);
  const primaryKeyword = querySummary.query;
  const secondaryKeywords = dedupeStrings([
    querySummary.query.replace(/\bbest\b/i, "top"),
    `${querySummary.query} comparison`,
    `${querySummary.query} buyer's guide`,
  ]).slice(0, 3);
  const title = format === "comparison"
    ? `${querySummary.query.toUpperCase().includes("IBOLT") ? "iBOLT vs RAM Mount for Commercial Workflows" : toTitleCase(querySummary.query)}: Which Option Fits Commercial Use?`
    : `${toTitleCase(querySummary.query)} (2026 Buyer's Guide)`;
  const lowestScore = Math.max(0, 100 - querySummary.averageScore);
  const supportingProducts = productTitles
    .filter((titleItem) => querySummary.query.toLowerCase().split(" ").some((token) => token.length > 4 && titleItem.toLowerCase().includes(token)))
    .slice(0, 4);

  return {
    queryId: querySummary.queryId,
    query: querySummary.query,
    verticalId: querySummary.verticalId,
    title,
    primaryKeyword,
    secondaryKeywords,
    format,
    angle: closest.similarity >= 0.55
      ? `Attack a narrower sub-intent around "${querySummary.query}" that existing content does not cover cleanly.`
      : `Create a direct answer page for "${querySummary.query}" with stronger product fit, proof, and operational detail.`,
    whyNow: `Average benchmark score is ${querySummary.averageScore}/100 with weak coverage from ${querySummary.weakestProviders.join(", ") || "multiple providers"}.`,
    uniquenessReason: closest.title
      ? `Differentiate from "${closest.title}" by focusing on the exact buying intent, install constraints, and proof points the current inventory misses.`
      : "No close overlap with the current post inventory was detected.",
    supportingProducts,
    researchNeeds: [
      "real buyer phrasing from Reddit and forums",
      "installation constraints and device dimensions",
      "competitor comparisons with pricing and mounting style",
    ],
    recommendedProviders: querySummary.weakestProviders.slice(0, 3),
    closestExistingTitle: closest.title,
    similarityScore: closest.similarity,
    gapScore: lowestScore,
  };
}

async function buildContentPlanWithClaude(
  querySummaries: BenchmarkRunSummary["querySummaries"],
  existingInventory: ExistingContentItem[],
  productTitles: string[],
  limit: number,
): Promise<ContentPlanItem[] | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const client = getAnthropicClient();
  const prompt = [
    "You are building a non-duplicative SEO content plan for iBolt Mounts.",
    `Return up to ${limit} plan items as a JSON array.`,
    "Every plan item must attack a benchmark gap and avoid thin rewrites of existing posts.",
    "Favor specific commercial use cases, install constraints, device compatibility, and operational proof over generic fluff.",
    "",
    "Benchmark gaps:",
    JSON.stringify(
      querySummaries.slice(0, limit * 2).map((item) => ({
        queryId: item.queryId,
        query: item.query,
        category: item.category,
        averageScore: item.averageScore,
        weakestProviders: item.weakestProviders,
      })),
      null,
      2,
    ),
    "",
    "Existing content inventory:",
    JSON.stringify(existingInventory.map((item) => item.title).slice(0, 80), null, 2),
    "",
    "Relevant products:",
    JSON.stringify(productTitles.slice(0, 50), null, 2),
    "",
    "Return this shape:",
    JSON.stringify([
      {
        queryId: "query id",
        query: "gap query",
        title: "new post title",
        primaryKeyword: "primary keyword",
        secondaryKeywords: ["secondary keyword"],
        format: "comparison|buying_guide|use_case|compatibility|problem_solution",
        angle: "specific editorial angle",
        whyNow: "why this closes an AI benchmark gap",
        uniquenessReason: "why this is not a rewrite of an existing post",
        supportingProducts: ["product title"],
        researchNeeds: ["research task"],
        recommendedProviders: ["provider"],
      },
    ], null, 2),
  ].join("\n");

  try {
    const response = await client.messages.create({
      model: ANTHROPIC_DEFAULT_MODEL,
      max_tokens: 2500,
      messages: [{ role: "user", content: prompt }],
    });

    const text = extractAnthropicText(response);
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as ContentPlanItem[];
    return parsed.slice(0, limit);
  } catch {
    return null;
  }
}

export async function generateContentPlan(runId?: string, limit = 8): Promise<ContentPlanItem[]> {
  const summary = runId ? await getBenchmarkRunSummary(runId) : await getLatestBenchmarkRunSummary();
  if (!summary) return [];

  const gapQueries = [...summary.querySummaries]
    .sort((a, b) => a.averageScore - b.averageScore || b.priority - a.priority)
    .slice(0, Math.max(limit * 2, limit));

  const posts = await db.select().from(blogPosts);
  const clusters = await db.select().from(keywordClusters);
  const productRows = await db.select().from(products);

  const existingInventory: ExistingContentItem[] = [
    ...posts.map((post) => ({ title: post.title, kind: "post" as const })),
    ...clusters.map((cluster) => ({ title: cluster.primaryKeyword, kind: "cluster" as const })),
  ];
  const productTitles = productRows.map((product) => product.title);

  const aiPlan = await buildContentPlanWithClaude(gapQueries, existingInventory, productTitles, limit);
  const baseline = aiPlan && aiPlan.length > 0
    ? aiPlan
    : gapQueries.map((querySummary) => buildDeterministicPlanItem(querySummary, existingInventory, productTitles));

  const filtered: ContentPlanItem[] = [];
  for (const item of baseline) {
    const closest = getClosestExistingContent(item.title || item.primaryKeyword, existingInventory);
    const normalizedItem: ContentPlanItem = {
      ...item,
      secondaryKeywords: dedupeStrings(item.secondaryKeywords).slice(0, 5),
      supportingProducts: dedupeStrings(item.supportingProducts).slice(0, 5),
      researchNeeds: dedupeStrings(item.researchNeeds).slice(0, 5),
      recommendedProviders: dedupeStrings(item.recommendedProviders) as BenchmarkProvider[],
      closestExistingTitle: closest.title,
      similarityScore: closest.similarity,
      gapScore: item.gapScore || Math.max(0, 100 - (gapQueries.find((querySummary) => querySummary.queryId === item.queryId)?.averageScore || 0)),
    };

    if ((closest.similarity || 0) >= 0.82) {
      continue;
    }

    filtered.push(normalizedItem);
    if (filtered.length >= limit) break;
  }

  if (filtered.length >= limit) {
    return filtered;
  }

  for (const querySummary of gapQueries) {
    if (filtered.some((item) => item.queryId === querySummary.queryId)) continue;
    const fallback = buildDeterministicPlanItem(querySummary, existingInventory, productTitles);
    if ((fallback.similarityScore || 0) >= 0.82) continue;
    filtered.push(fallback);
    if (filtered.length >= limit) break;
  }

  return filtered;
}

export async function materializeContentPlanItem(
  options: MaterializeContentPlanOptions,
): Promise<{
  created: boolean;
  duplicate: boolean;
  cluster: typeof keywordClusters.$inferSelect;
  queued: boolean;
  jobId?: string;
}> {
  const clusterRows = await db.select().from(keywordClusters);
  const candidates = [options.item.title, options.item.primaryKeyword, options.item.query];
  const duplicateCluster = clusterRows.find((cluster) =>
    candidates.some((candidate) =>
      computeSimilarity(candidate, cluster.name) >= 0.82 ||
      computeSimilarity(candidate, cluster.primaryKeyword) >= 0.82,
    ),
  );

  let cluster = duplicateCluster;
  let created = false;

  if (!cluster) {
    const [createdCluster] = await db.insert(keywordClusters).values({
      name: options.item.title,
      primaryKeyword: options.item.primaryKeyword,
      verticalId: options.item.verticalId || null,
      totalVolume: 0,
      avgDifficulty: 0,
      priority: options.item.gapScore || 75,
      status: "pending",
    }).returning();

    cluster = createdCluster;
    created = true;

    const keywordValues = dedupeStrings([
      options.item.primaryKeyword,
      options.item.query,
      ...(options.item.secondaryKeywords || []),
    ]).map((keyword) => ({
      keyword,
      volume: 0,
      difficulty: 0,
      cpc: 0,
      opportunityScore: options.item.gapScore || 75,
      status: "clustered" as const,
      clusterId: createdCluster.id,
      importId: null,
    }));

    if (keywordValues.length > 0) {
      await db.insert(keywords).values(keywordValues);
    }
  }

  let queued = false;
  let jobId: string | undefined;
  if (options.generateNow || options.queueForGeneration) {
    const job = writingQueue.addJob(cluster.id, options.item.title);
    queued = true;
    jobId = job.id;
  }

  return {
    created,
    duplicate: !created,
    cluster,
    queued,
    jobId,
  };
}

export async function runAiBenchmark(
  options: BenchmarkRunOptions,
  onProgress?: (event: BenchmarkProgressEvent) => void,
): Promise<BenchmarkRunSummary> {
  const providers = (options.providers?.length ? options.providers : BENCHMARK_PROVIDERS) as BenchmarkProvider[];
  const availableQueries = options.queryIds?.length
    ? await db.select().from(aiBenchmarkQueries).where(inArray(aiBenchmarkQueries.id, options.queryIds))
    : await db.select().from(aiBenchmarkQueries).where(eq(aiBenchmarkQueries.status, "active"));
  const queries = sortQueries(availableQueries);
  const productRows = await db.select({ title: products.title, handle: products.handle }).from(products);

  const [run] = await db.insert(aiBenchmarkRuns).values({
    name: options.name || `AI Benchmark ${new Date().toISOString().slice(0, 10)}`,
    providers,
    status: "running",
    queryCount: queries.length,
    startedAt: new Date(),
  }).returning();

  const totalTasks = queries.length * providers.length;
  onProgress?.({
    type: "started",
    runId: run.id,
    message: `Starting benchmark for ${queries.length} queries across ${providers.length} providers.`,
    current: 0,
    total: totalTasks,
  });

  const limit = pLimit(Math.max(1, options.concurrency || Number.parseInt(process.env.AI_BENCHMARK_CONCURRENCY || "2", 10) || 2));
  let completed = 0;

  const tasks = queries.flatMap((query) =>
    providers.map((provider) =>
      limit(async () => {
        const prompt = buildBenchmarkPrompt(query.query);
        const execution = await runProvider(provider, prompt);

        const insertBase = {
          runId: run.id,
          queryId: query.id,
          provider,
          model: execution.model,
          prompt: execution.prompt,
        };

        let saved: AiBenchmarkResult;
        if (execution.status === "completed") {
          const analysis = analyzeResponse(query, execution.responseText, execution.sourceUrls, productRows);
          [saved] = await db.insert(aiBenchmarkResults).values({
            ...insertBase,
            ...analysis,
            status: "completed",
          }).returning();
        } else {
          [saved] = await db.insert(aiBenchmarkResults).values({
            ...insertBase,
            rawResponse: execution.responseText || null,
            status: execution.status,
            error: execution.error,
            brandMentioned: false,
            iboltCited: false,
            coverageScore: 0,
            sentiment: execution.status,
            positioning: execution.error,
            positioningTags: [],
            mentionedProducts: [],
            competitors: [],
            sourceUrls: execution.sourceUrls || [],
            analysisNotes: execution.error,
          }).returning();
        }

        completed += 1;
        onProgress?.({
          type: "progress",
          runId: run.id,
          message: `${provider} finished "${query.query}"`,
          current: completed,
          total: totalTasks,
          query: query.query,
          provider,
          result: saved,
        });

        return saved;
      }),
    ),
  );

  const results = await Promise.all(tasks);
  const fullSummary = buildRunSummary(run, queries, results);

  const [updatedRun] = await db.update(aiBenchmarkRuns).set({
    status: results.some((result) => result.status === "completed") ? "completed" : "failed",
    resultCount: results.filter((result) => result.status === "completed").length,
    summary: {
      providerSummaries: fullSummary.providerSummaries,
      biggestGaps: fullSummary.biggestGaps,
      topWins: fullSummary.topWins,
    },
    completedAt: new Date(),
  }).where(eq(aiBenchmarkRuns.id, run.id)).returning();

  const summary = {
    ...fullSummary,
    run: updatedRun,
  };

  onProgress?.({
    type: "completed",
    runId: run.id,
    message: `Benchmark complete. ${summary.run.resultCount} completed results saved.`,
    current: totalTasks,
    total: totalTasks,
    summary,
  });

  return summary;
}
