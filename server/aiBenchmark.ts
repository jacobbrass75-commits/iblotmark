import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import {
  aiBenchmarkQueries,
  aiBenchmarkResults,
  aiBenchmarkRuns,
  blogPosts,
  industryVerticals,
  keywordClusters,
  productVerticals,
  products,
  keywords,
  type AiBenchmarkQuery,
  type AiBenchmarkResult,
  type AiBenchmarkRun,
  type InsertAiBenchmarkQuery,
} from "@shared/schema";
import { computeSimilarity, deriveBrandAliasVariants, toTitleCase } from "./aiBenchmarkUtils";
import { writingQueue } from "./writingQueue";
import { DEFAULT_COMPANY_ID } from "./companyDefaults";
import { getCompanyContext, type CompanyContext } from "./companyContext";

type PLimitFn = typeof import("p-limit")["default"];

let pLimitPromise: Promise<PLimitFn> | null = null;

function getPLimit(): Promise<PLimitFn> {
  if (!pLimitPromise) {
    pLimitPromise = import("p-limit").then((mod) => {
      const candidate = (mod as { default?: unknown }).default ?? mod;
      if (typeof candidate !== "function") {
        throw new Error("p-limit did not export a callable limiter.");
      }
      return candidate as PLimitFn;
    });
  }
  return pLimitPromise;
}

export const BENCHMARK_PROVIDERS = [
  "chatgpt",
  "claude",
  "gemini_plain",
  "gemini_google_search",
] as const;

export type BenchmarkProvider = typeof BENCHMARK_PROVIDERS[number];

const BENCHMARK_PROVIDER_LABELS: Record<BenchmarkProvider, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini_plain: "Gemini",
  gemini_google_search: "Gemini + Google Search",
};

const LEGACY_PROVIDER_ALIASES: Record<string, BenchmarkProvider> = {
  gemini: "gemini_plain",
  google_search: "gemini_google_search",
};

export function normalizeBenchmarkProvider(value: unknown): BenchmarkProvider | null {
  if (typeof value !== "string") return null;
  if (BENCHMARK_PROVIDERS.includes(value as BenchmarkProvider)) {
    return value as BenchmarkProvider;
  }
  return LEGACY_PROVIDER_ALIASES[value] || null;
}

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
  companyId?: string;
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
    persona: string | null;
    painPoint: string | null;
    iboltAngle: string | null;
    targetProducts: string[];
    benchmarkBaseline: Record<string, unknown> | null;
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
  persona?: string | null;
  painPoint?: string | null;
  iboltAngle?: string | null;
  targetProducts?: string[];
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

type ProductInventoryItem = {
  id: string;
  title: string;
  handle: string;
  description: string | null;
  productType: string | null;
};

type ProductVerticalMapping = {
  productId: string;
  verticalId: string;
  relevanceScore: number | null;
};

export interface MaterializeContentPlanOptions {
  item: ContentPlanItem;
  generateNow?: boolean;
  queueForGeneration?: boolean;
  companyId?: string;
}

const OPENAI_DEFAULT_MODEL = process.env.AI_BENCHMARK_OPENAI_MODEL || "gpt-4.1";
const ANTHROPIC_DEFAULT_MODEL = process.env.AI_BENCHMARK_ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
const GEMINI_DEFAULT_MODEL = process.env.AI_BENCHMARK_GEMINI_MODEL || "gemini-2.5-flash";
const OPENROUTER_CHATGPT_MODEL = process.env.AI_BENCHMARK_OPENROUTER_CHATGPT_MODEL || "openai/gpt-4o";
const OPENROUTER_CLAUDE_MODEL = process.env.AI_BENCHMARK_OPENROUTER_CLAUDE_MODEL || "anthropic/claude-sonnet-4";
const OPENROUTER_GEMINI_MODEL = process.env.AI_BENCHMARK_OPENROUTER_GEMINI_MODEL || "google/gemini-2.5-flash";
const OPENROUTER_SITE_URL = process.env.OPENROUTER_SITE_URL || process.env.PUBLIC_BASE_URL || "https://iboltmounts.com";
const OPENROUTER_APP_TITLE = process.env.OPENROUTER_APP_TITLE || "iBOLT AI Visibility Benchmark";
const FORCE_OPENROUTER = ["1", "true", "yes", "on"].includes((process.env.AI_BENCHMARK_FORCE_OPENROUTER || "").toLowerCase());
const QUERY_PRODUCT_STOP_WORDS = new Set([
  "best",
  "for",
  "with",
  "and",
  "the",
  "2026",
  "guide",
  "buyer",
  "buyers",
  "commercial",
]);

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
  { tag: "specialist", terms: ["purpose-built", "specialized", "specialist", "expert", "category leader"] },
  { tag: "budget", terms: ["budget", "cheap", "cheaper", "affordable", "low-cost", "economical"] },
  { tag: "value", terms: ["best value", "value pick", "cost-conscious", "cost effective"] },
  { tag: "premium", terms: ["premium", "high-end", "professional-grade", "professional grade"] },
  { tag: "durable", terms: ["durable", "heavy-duty", "long-lasting", "weather-resistant", "rugged"] },
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

function normalizeBenchmarkResult(result: AiBenchmarkResult): AiBenchmarkResult {
  const provider = normalizeBenchmarkProvider(result.provider) || result.provider;
  return provider === result.provider ? result : { ...result, provider };
}

function formatProviderList(providers: BenchmarkProvider[]): string {
  const labels = dedupeStrings(
    providers.map((provider) => BENCHMARK_PROVIDER_LABELS[provider] || provider),
  );
  return labels.join(", ");
}

function isUsableBenchmarkBaseline(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const providers = (value as { providers?: unknown }).providers;
  return Array.isArray(providers) && providers.some((provider) =>
    provider &&
    typeof provider === "object" &&
    (provider as { status?: unknown }).status === "completed",
  );
}

function toIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value < 10_000_000_000 ? value * 1000 : value;
    return new Date(millis).toISOString();
  }

  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return toIsoTimestamp(numeric);
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return null;
}

function buildBenchmarkBaselineSnapshot(
  run: AiBenchmarkRun,
  averageScore: number,
  averageMentionRate: number,
  completedResults: AiBenchmarkResult[],
): Record<string, unknown> | null {
  if (completedResults.length === 0) return null;

  return {
    runId: run.id,
    capturedAt: toIsoTimestamp(run.completedAt || run.startedAt || run.createdAt) || new Date().toISOString(),
    averageScore,
    averageMentionRate,
    providers: completedResults.map((result) => ({
      provider: normalizeBenchmarkProvider(result.provider) || result.provider,
      status: result.status,
      coverageScore: result.coverageScore,
      targetBrandMentioned: result.targetBrandMentioned ?? result.brandMentioned,
      brandMentioned: result.brandMentioned,
      targetDomainCited: result.targetDomainCited ?? result.iboltCited,
      iboltCited: result.iboltCited,
      topPickRank: result.topPickRank,
      mentionedProducts: result.mentionedProducts,
      competitors: result.competitors,
    })),
  };
}

function isProviderConfigured(provider: BenchmarkProvider): boolean {
  switch (provider) {
    case "chatgpt":
      return Boolean(process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY);
    case "claude":
      return Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY);
    case "gemini_plain":
      return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.OPENROUTER_API_KEY);
    case "gemini_google_search":
      return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY);
  }
}

export function getBenchmarkProviderConfigStatus(): Record<BenchmarkProvider, boolean> {
  return BENCHMARK_PROVIDERS.reduce((status, provider) => {
    status[provider] = isProviderConfigured(provider);
    return status;
  }, {} as Record<BenchmarkProvider, boolean>);
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return dedupeStrings(value.filter((item): item is string => typeof item === "string"));
  }
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return dedupeStrings(parsed.filter((item): item is string => typeof item === "string"));
    }
  } catch {
    // Fall through to comma/newline parsing.
  }
  return dedupeStrings(value.split(/[\n,]+/));
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

function getQueryTokens(query: string): string[] {
  return dedupeStrings(
    query
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 3 && !QUERY_PRODUCT_STOP_WORDS.has(token)),
  );
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

function extractOpenRouterText(response: any): string {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.content === "string") return part.content;
        return "";
      })
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }
  return "";
}

function extractGeminiGroundingUrls(response: any): string[] {
  const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const urls = chunks.map((chunk: any) => chunk?.web?.uri).filter(Boolean);
  return dedupeStrings(urls);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getBrandAliases(companyContext: CompanyContext): string[] {
  const aliases = [
    companyContext.brandProfile.displayName,
    companyContext.company.name,
    ...getTargetDomains(companyContext).map((domain) => domain.split(".")[0]),
  ].filter(Boolean);
  return dedupeStrings(aliases.flatMap((alias) => deriveBrandAliasVariants(alias)));
}

function hasTargetBrandMention(text: string, companyContext: CompanyContext): boolean {
  return getBrandAliases(companyContext).some((alias) => {
    const normalizedAlias = escapeRegExp(alias).replace(/\\ /g, "[\\s-]?");
    return new RegExp(`\\b${normalizedAlias}\\b`, "i").test(text);
  });
}

function getTargetDomains(companyContext: CompanyContext): string[] {
  const urls = [
    companyContext.company.websiteUrl,
    companyContext.brandProfile.websiteUrl,
  ].filter(Boolean);
  const domains = urls.flatMap((value) => {
    try {
      return [new URL(value).hostname.replace(/^www\./, "")];
    } catch {
      return [];
    }
  });
  if (companyContext.company.primaryDomain) domains.push(companyContext.company.primaryDomain.replace(/^www\./, ""));
  return dedupeStrings(domains.filter(Boolean));
}

function hasTargetDomainCitation(sourceUrls: string[], companyContext: CompanyContext): boolean {
  const targetDomains = getTargetDomains(companyContext);
  if (targetDomains.length === 0) return false;

  return sourceUrls.some((url) => {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, "");
      return targetDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
    } catch {
      return targetDomains.some((domain) => url.includes(domain));
    }
  });
}

function getKnownCompetitors(text: string, companyContext?: CompanyContext): string[] {
  const lower = text.toLowerCase();
  const configured = companyContext?.competitors.map((competitor) => competitor.name) || [];
  const demoDefaults = companyContext?.company.id === DEFAULT_COMPANY_ID ? KNOWN_COMPETITORS : [];
  return dedupeStrings([...configured, ...demoDefaults]).filter((brand) => lower.includes(brand.toLowerCase()));
}

function getPositioningTags(text: string): string[] {
  const lower = text.toLowerCase();
  return POSITIONING_TAGS
    .filter(({ terms }) => terms.some((term) => lower.includes(term)))
    .map(({ tag }) => tag);
}

function findTopPickRank(text: string, companyContext: CompanyContext): number | null {
  const lower = text.toLowerCase();
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    if (!hasTargetBrandMention(line, companyContext)) continue;

    const numberedMatch = line.match(/^(\d+)[.)-]\s/);
    if (numberedMatch) {
      return Number.parseInt(numberedMatch[1] || "", 10);
    }

    const hashMatch = line.match(/#\s?(\d+)/);
    if (hashMatch) {
      return Number.parseInt(hashMatch[1] || "", 10);
    }
  }

  if ((/best overall|top pick|overall winner/.test(lower)) && hasTargetBrandMention(text, companyContext)) {
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

function buildPositioningSummary(
  brandMentioned: boolean,
  cited: boolean,
  tags: string[],
  rank: number | null,
  companyContext: CompanyContext,
): string {
  const brandName = companyContext.brandProfile.displayName;
  const domain = getTargetDomains(companyContext)[0] || "the target domain";
  if (!brandMentioned) {
    return cited
      ? `${brandName} sources were cited but the brand still did not make the recommendation list.`
      : `${brandName} was absent from the recommendation set.`;
  }

  const tagSummary = tags.length > 0 ? tags.join(", ") : "general";
  const rankSummary = rank ? `Ranked at #${rank}.` : "No explicit list rank was detected.";
  const citationSummary = cited ? `${domain} was cited.` : `${domain} was not cited.`;
  return `${rankSummary} Framing tags: ${tagSummary}. ${citationSummary}`;
}

function analyzeResponse(
  query: AiBenchmarkQuery,
  responseText: string,
  sourceUrls: string[],
  allProducts: Array<{ title: string; handle: string }>,
  companyContext: CompanyContext,
): Omit<
  typeof aiBenchmarkResults.$inferInsert,
  "companyId" | "runId" | "queryId" | "provider" | "model" | "prompt" | "status" | "error"
> {
  const lower = responseText.toLowerCase();
  const brandMentioned = hasTargetBrandMention(responseText, companyContext);
  const iboltCited = hasTargetDomainCitation(sourceUrls, companyContext);
  const mentionedProducts = dedupeStrings(
    allProducts
      .filter((product) => {
        const normalizedHandle = product.handle.toLowerCase().replace(/-/g, " ");
        return lower.includes(product.title.toLowerCase()) || lower.includes(normalizedHandle);
      })
      .map((product) => product.title),
  );
  const competitors = dedupeStrings(getKnownCompetitors(responseText, companyContext).filter((brand) => {
    return !getBrandAliases(companyContext).some((alias) => alias.toLowerCase() === brand.toLowerCase());
  }));
  const topPickRank = findTopPickRank(responseText, companyContext);
  const positioningTags = getPositioningTags(responseText);
  const sentiment = getSentiment(brandMentioned, positioningTags, topPickRank);

  let coverageScore = 0;
  if (brandMentioned) coverageScore += 35;
  if (iboltCited) coverageScore += 20;
  if (topPickRank === 1) coverageScore += 25;
  else if (topPickRank && topPickRank <= 3) coverageScore += 18;
  else if (topPickRank) coverageScore += 10;
  if (positioningTags.includes("specialist")) coverageScore += 10;
  if (positioningTags.includes("budget") && !positioningTags.includes("specialist")) coverageScore -= 8;
  coverageScore += Math.min(10, mentionedProducts.length * 3);

  const analysisNotes = [
    brandMentioned ? `${companyContext.brandProfile.displayName} surfaced in the answer.` : `${companyContext.brandProfile.displayName} did not surface in the answer.`,
    iboltCited ? "Provider cited the target domain." : "Provider did not cite the target domain.",
    topPickRank ? `Detected explicit ranking at #${topPickRank}.` : "No explicit list ranking detected.",
    competitors.length > 0 ? `Competitors named: ${competitors.join(", ")}.` : "No known competitors detected.",
    query.benchmarkGoal ? `Benchmark goal: ${query.benchmarkGoal}` : null,
  ].filter(Boolean).join(" ");

  return {
    rawResponse: responseText,
    targetBrandMentioned: brandMentioned,
    brandMentioned,
    targetDomainCited: iboltCited,
    iboltCited,
    topPickRank,
    coverageScore: clampScore(coverageScore),
    sentiment,
    positioning: buildPositioningSummary(brandMentioned, iboltCited, positioningTags, topPickRank, companyContext),
    positioningTags,
    mentionedProducts,
    competitors,
    sourceUrls: dedupeStrings(sourceUrls),
    analysisNotes,
  };
}

async function runOpenAiProvider(prompt: string): Promise<ProviderExecution> {
  if (FORCE_OPENROUTER && process.env.OPENROUTER_API_KEY) {
    return runOpenRouterProvider(prompt, OPENROUTER_CHATGPT_MODEL);
  }

  if (!process.env.OPENAI_API_KEY) {
    if (process.env.OPENROUTER_API_KEY) {
      return runOpenRouterProvider(prompt, OPENROUTER_CHATGPT_MODEL);
    }
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

async function runOpenRouterProvider(prompt: string, model: string): Promise<ProviderExecution> {
  if (!process.env.OPENROUTER_API_KEY) {
    return {
      status: "skipped",
      model,
      prompt,
      error: "OPENROUTER_API_KEY is not configured.",
    };
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": OPENROUTER_SITE_URL,
        "X-Title": OPENROUTER_APP_TITLE,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 1100,
      }),
      signal: AbortSignal.timeout(75000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenRouter API returned ${response.status}: ${body}`);
    }

    const json = await response.json();
    return {
      status: "completed",
      model,
      prompt,
      responseText: extractOpenRouterText(json),
      sourceUrls: collectUrls(json),
    };
  } catch (error: any) {
    return {
      status: "failed",
      model,
      prompt,
      error: error.message || "OpenRouter benchmark call failed.",
    };
  }
}

async function runAnthropicProvider(prompt: string): Promise<ProviderExecution> {
  if (FORCE_OPENROUTER && process.env.OPENROUTER_API_KEY) {
    return runOpenRouterProvider(prompt, OPENROUTER_CLAUDE_MODEL);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    if (process.env.OPENROUTER_API_KEY) {
      return runOpenRouterProvider(prompt, OPENROUTER_CLAUDE_MODEL);
    }
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
  if (FORCE_OPENROUTER && !grounded && process.env.OPENROUTER_API_KEY) {
    return runOpenRouterProvider(prompt, OPENROUTER_GEMINI_MODEL);
  }

  if (!grounded && !apiKey && process.env.OPENROUTER_API_KEY) {
    return runOpenRouterProvider(prompt, OPENROUTER_GEMINI_MODEL);
  }
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
    case "gemini_plain":
      return runGeminiProvider(prompt, false);
    case "gemini_google_search":
      return runGeminiProvider(prompt, true);
  }
}

function sortQueries(rows: AiBenchmarkQuery[]): AiBenchmarkQuery[] {
  return [...rows].sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.query.localeCompare(b.query));
}

export async function listBenchmarkQueries(companyId = DEFAULT_COMPANY_ID): Promise<AiBenchmarkQuery[]> {
  const rows = await db.select().from(aiBenchmarkQueries).where(eq(aiBenchmarkQueries.companyId, companyId));
  return sortQueries(rows);
}

export async function createBenchmarkQuery(input: Omit<InsertAiBenchmarkQuery, "query"> & { query: string }): Promise<AiBenchmarkQuery> {
  const [row] = await db.insert(aiBenchmarkQueries).values({
    ...input,
    companyId: input.companyId || DEFAULT_COMPANY_ID,
    query: normalizeQuery(input.query),
    brandAngle: input.brandAngle || input.iboltAngle || null,
    iboltAngle: input.iboltAngle || input.brandAngle || null,
    targetProducts: parseStringArray(input.targetProducts),
    status: input.status || "active",
    updatedAt: new Date(),
  }).returning();
  return row;
}

export async function updateBenchmarkQuery(
  id: string,
  updates: Partial<Omit<InsertAiBenchmarkQuery, "query"> & { query: string }>,
  companyId = DEFAULT_COMPANY_ID,
): Promise<AiBenchmarkQuery> {
  const payload: Partial<typeof aiBenchmarkQueries.$inferInsert> = { updatedAt: new Date() };
  if (updates.category !== undefined) payload.category = updates.category;
  if (updates.label !== undefined) payload.label = updates.label;
  if (updates.query !== undefined) payload.query = normalizeQuery(updates.query);
  if (updates.verticalId !== undefined) payload.verticalId = updates.verticalId;
  if (updates.intentType !== undefined) payload.intentType = updates.intentType;
  if (updates.priority !== undefined) payload.priority = updates.priority;
  if (updates.benchmarkGoal !== undefined) payload.benchmarkGoal = updates.benchmarkGoal;
  if (updates.persona !== undefined) payload.persona = updates.persona;
  if (updates.painPoint !== undefined) payload.painPoint = updates.painPoint;
  if (updates.brandAngle !== undefined) payload.brandAngle = updates.brandAngle;
  if (updates.iboltAngle !== undefined) {
    payload.iboltAngle = updates.iboltAngle;
    if (updates.brandAngle === undefined) payload.brandAngle = updates.iboltAngle;
  }
  if (updates.targetProducts !== undefined) payload.targetProducts = parseStringArray(updates.targetProducts);
  if (updates.benchmarkBaseline !== undefined) payload.benchmarkBaseline = updates.benchmarkBaseline;
  if (updates.benchmarkBaselinedAt !== undefined) payload.benchmarkBaselinedAt = updates.benchmarkBaselinedAt;
  if (updates.notes !== undefined) payload.notes = updates.notes;
  if (updates.status !== undefined) payload.status = updates.status;

  const [row] = await db
    .update(aiBenchmarkQueries)
    .set(payload)
    .where(and(eq(aiBenchmarkQueries.companyId, companyId), eq(aiBenchmarkQueries.id, id)))
    .returning();
  return row;
}

export async function listBenchmarkRuns(limit = 10, companyId = DEFAULT_COMPANY_ID): Promise<AiBenchmarkRun[]> {
  const rows = await db
    .select()
    .from(aiBenchmarkRuns)
    .where(eq(aiBenchmarkRuns.companyId, companyId))
    .orderBy(desc(aiBenchmarkRuns.createdAt));
  return rows.slice(0, limit);
}

function buildRunSummary(
  run: AiBenchmarkRun,
  queries: AiBenchmarkQuery[],
  results: AiBenchmarkResult[],
): BenchmarkRunSummary {
  const normalizedResults = results.map(normalizeBenchmarkResult);
  const runProviders = dedupeStrings(
    ((run.providers || []) as string[]).map((provider) => normalizeBenchmarkProvider(provider) || provider),
  ) as BenchmarkProvider[];
  const normalizedRun = { ...run, providers: runProviders };

  const providerSummaries = runProviders.map((provider) => {
    const providerResults = normalizedResults.filter((result) => result.provider === provider);
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
    const queryResults = normalizedResults
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
      .map((result) => normalizeBenchmarkProvider(result.provider))
      .filter((provider): provider is BenchmarkProvider => Boolean(provider));

    return {
      queryId: query.id,
      query: query.query,
      category: query.category,
      label: query.label,
      verticalId: query.verticalId,
      priority: query.priority || 0,
      persona: query.persona || null,
      painPoint: query.painPoint || null,
      iboltAngle: query.iboltAngle || null,
      targetProducts: parseStringArray(query.targetProducts),
      benchmarkBaseline: isUsableBenchmarkBaseline(query.benchmarkBaseline)
        ? query.benchmarkBaseline
        : buildBenchmarkBaselineSnapshot(normalizedRun, averageScore, averageMentionRate, completed),
      averageScore,
      averageMentionRate,
      weakestProviders: dedupeStrings(weakestProviders) as BenchmarkProvider[],
      results: queryResults,
    };
  });

  const biggestGaps = normalizedResults
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

  const topWins = normalizedResults
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
    run: normalizedRun,
    providerSummaries,
    querySummaries,
    biggestGaps,
    topWins,
  };
}

export async function getBenchmarkRunSummary(runId: string, companyId = DEFAULT_COMPANY_ID): Promise<BenchmarkRunSummary | null> {
  const [run] = await db
    .select()
    .from(aiBenchmarkRuns)
    .where(and(eq(aiBenchmarkRuns.companyId, companyId), eq(aiBenchmarkRuns.id, runId)))
    .limit(1);
  if (!run) return null;

  const results = await db
    .select()
    .from(aiBenchmarkResults)
    .where(and(eq(aiBenchmarkResults.companyId, companyId), eq(aiBenchmarkResults.runId, runId)));
  const queryIds = dedupeStrings(results.map((result) => result.queryId));
  const queries = queryIds.length > 0
    ? await db
      .select()
      .from(aiBenchmarkQueries)
      .where(and(eq(aiBenchmarkQueries.companyId, companyId), inArray(aiBenchmarkQueries.id, queryIds)))
    : [];

  return buildRunSummary(run, queries, results);
}

export async function getLatestBenchmarkRunSummary(companyId = DEFAULT_COMPANY_ID): Promise<BenchmarkRunSummary | null> {
  const runs = await db
    .select()
    .from(aiBenchmarkRuns)
    .where(eq(aiBenchmarkRuns.companyId, companyId))
    .orderBy(desc(aiBenchmarkRuns.createdAt));
  const usableRun = runs.find((run) => run.status === "completed" && (run.resultCount || 0) > 0);
  const fallbackRun = runs[0];
  if (!usableRun && !fallbackRun) return null;
  return getBenchmarkRunSummary((usableRun || fallbackRun).id, companyId);
}

export async function reanalyzeBenchmarkRun(runId: string, companyId = DEFAULT_COMPANY_ID): Promise<BenchmarkRunSummary | null> {
  const [run] = await db
    .select()
    .from(aiBenchmarkRuns)
    .where(and(eq(aiBenchmarkRuns.companyId, companyId), eq(aiBenchmarkRuns.id, runId)))
    .limit(1);
  if (!run) return null;

  const results = await db
    .select()
    .from(aiBenchmarkResults)
    .where(and(eq(aiBenchmarkResults.companyId, companyId), eq(aiBenchmarkResults.runId, runId)));
  const queryIds = dedupeStrings(results.map((result) => result.queryId));
  const queries = queryIds.length > 0
    ? await db
      .select()
      .from(aiBenchmarkQueries)
      .where(and(eq(aiBenchmarkQueries.companyId, companyId), inArray(aiBenchmarkQueries.id, queryIds)))
    : [];
  const queryById = new Map(queries.map((query) => [query.id, query]));
  const productRows = await db
    .select({ title: products.title, handle: products.handle })
    .from(products)
    .where(eq(products.companyId, companyId));
  const companyContext = await getCompanyContext(companyId);

  for (const result of results) {
    if (result.status !== "completed" || !result.rawResponse) continue;
    const query = queryById.get(result.queryId);
    if (!query) continue;
    const analysis = analyzeResponse(
      query,
      result.rawResponse,
      result.sourceUrls || [],
      productRows,
      companyContext,
    );
    await db
      .update(aiBenchmarkResults)
      .set(analysis)
      .where(and(eq(aiBenchmarkResults.companyId, companyId), eq(aiBenchmarkResults.id, result.id)));
  }

  const updatedResults = await db
    .select()
    .from(aiBenchmarkResults)
    .where(and(eq(aiBenchmarkResults.companyId, companyId), eq(aiBenchmarkResults.runId, runId)));
  const fullSummary = buildRunSummary(run, queries, updatedResults);

  const [updatedRun] = await db
    .update(aiBenchmarkRuns)
    .set({
      resultCount: updatedResults.filter((result) => result.status === "completed").length,
      summary: {
        providerSummaries: fullSummary.providerSummaries,
        biggestGaps: fullSummary.biggestGaps,
        topWins: fullSummary.topWins,
      },
    })
    .where(and(eq(aiBenchmarkRuns.companyId, companyId), eq(aiBenchmarkRuns.id, runId)))
    .returning();

  return {
    ...fullSummary,
    run: updatedRun || run,
  };
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
  brandName: string,
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
    ? `${querySummary.query.toLowerCase().includes(brandName.toLowerCase()) ? `${brandName} Comparison Guide` : toTitleCase(querySummary.query)}: Which Option Fits Commercial Use?`
    : `${toTitleCase(querySummary.query)} (2026 Buyer's Guide)`;
  const lowestScore = Math.max(0, 100 - querySummary.averageScore);
  const supportingProducts = productTitles.slice(0, 4);
  const weakProviderLabels = formatProviderList(querySummary.weakestProviders);
  const humanAngleParts = [
    querySummary.persona ? `Persona: ${querySummary.persona}` : null,
    querySummary.painPoint ? `Pain point: ${querySummary.painPoint}` : null,
    querySummary.iboltAngle ? `Brand angle: ${querySummary.iboltAngle}` : null,
  ].filter(Boolean).join(" ");

  return {
    queryId: querySummary.queryId,
    query: querySummary.query,
    verticalId: querySummary.verticalId,
    title,
    primaryKeyword,
    secondaryKeywords,
    format,
    angle: querySummary.iboltAngle
      ? querySummary.iboltAngle
      : closest.similarity >= 0.55
      ? `Attack a narrower sub-intent around "${querySummary.query}" that existing content does not cover cleanly.`
      : `Create a direct answer page for "${querySummary.query}" with stronger product fit, proof, and operational detail.`,
    whyNow: `Average benchmark score is ${querySummary.averageScore}/100 with weak coverage from ${weakProviderLabels || "multiple providers"}.`,
    uniquenessReason: closest.title
      ? `Differentiate from "${closest.title}" by focusing on the exact buying intent, install constraints, and proof points the current inventory misses.`
      : "No close overlap with the current post inventory was detected.",
    supportingProducts: dedupeStrings([...(querySummary.targetProducts || []), ...supportingProducts]).slice(0, 5),
    researchNeeds: [
      humanAngleParts || "real buyer phrasing from Reddit and forums",
      "usage constraints, fit details, and product specifications",
      "competitor comparisons with pricing, positioning, and evidence",
    ],
    recommendedProviders: querySummary.weakestProviders.slice(0, 3),
    persona: querySummary.persona,
    painPoint: querySummary.painPoint,
    iboltAngle: querySummary.iboltAngle,
    targetProducts: querySummary.targetProducts,
    closestExistingTitle: closest.title,
    similarityScore: closest.similarity,
    gapScore: lowestScore,
  };
}

function getProductTitlesForQuery(
  querySummary: BenchmarkRunSummary["querySummaries"][number],
  productRows: ProductInventoryItem[],
  mappings: ProductVerticalMapping[],
): string[] {
  const tokens = getQueryTokens(querySummary.query);
  const verticalMappedIds = new Set(
    querySummary.verticalId
      ? mappings
        .filter((mapping) => mapping.verticalId === querySummary.verticalId && (mapping.relevanceScore ?? 0) >= 0.58)
        .map((mapping) => mapping.productId)
      : [],
  );

  const scored = productRows
    .map((product) => {
      const searchText = [
        product.title,
        product.handle,
        product.description,
        product.productType,
      ].filter(Boolean).join(" ").toLowerCase();
      let score = 0;
      if (verticalMappedIds.has(product.id)) score += 5;
      for (const token of tokens) {
        if (searchText.includes(token)) score += 2;
      }
      return { product, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.product.title.localeCompare(b.product.title));

  const selected = scored.length > 0
    ? scored.slice(0, 8).map((item) => item.product.title)
    : productRows.slice(0, 8).map((product) => product.title);

  return dedupeStrings([...(querySummary.targetProducts || []), ...selected]).slice(0, 8);
}

async function buildContentPlanWithClaude(
  querySummaries: BenchmarkRunSummary["querySummaries"],
  existingInventory: ExistingContentItem[],
  productTitles: string[],
  limit: number,
  companyContext: CompanyContext,
): Promise<ContentPlanItem[] | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const client = getAnthropicClient();
  const prompt = [
    `You are building a non-duplicative SEO content plan for ${companyContext.brandProfile.displayName}.`,
    `Return up to ${limit} plan items as a JSON array.`,
    "Every plan item must attack a benchmark gap and avoid thin rewrites of existing posts.",
    `Brand positioning: ${companyContext.brandProfile.positioning || companyContext.brandProfile.shortDescription || "Use the configured brand profile and product evidence."}`,
    "Favor specific use cases, constraints, compatibility details, and operational proof over generic fluff.",
    "",
    "Benchmark gaps:",
    JSON.stringify(
      querySummaries.slice(0, limit * 2).map((item) => ({
        queryId: item.queryId,
        query: item.query,
        category: item.category,
        averageScore: item.averageScore,
        weakestProviders: item.weakestProviders,
        persona: item.persona,
        painPoint: item.painPoint,
        iboltAngle: item.iboltAngle,
        targetProducts: item.targetProducts,
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
        persona: "who is asking",
        painPoint: "specific pain/problem",
        iboltAngle: "why the target brand is the right answer",
        targetProducts: ["target product"],
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

export async function generateContentPlan(runId?: string, limit = 8, companyId = DEFAULT_COMPANY_ID): Promise<ContentPlanItem[]> {
  const companyContext = await getCompanyContext(companyId);
  const summary = runId ? await getBenchmarkRunSummary(runId, companyId) : await getLatestBenchmarkRunSummary(companyId);
  if (!summary) return [];
  if ((summary.run.resultCount || 0) === 0) return [];

  const gapQueries = [...summary.querySummaries]
    .sort((a, b) => a.averageScore - b.averageScore || b.priority - a.priority)
    .slice(0, Math.max(limit * 2, limit));

  const posts = await db.select().from(blogPosts).where(eq(blogPosts.companyId, companyId));
  const clusters = await db.select().from(keywordClusters).where(eq(keywordClusters.companyId, companyId));
  const productRows = await db.select({
    id: products.id,
    title: products.title,
    handle: products.handle,
    description: products.description,
    productType: products.productType,
  }).from(products).where(eq(products.companyId, companyId));
  const productMappings = await db.select({
    productId: productVerticals.productId,
    verticalId: productVerticals.verticalId,
    relevanceScore: productVerticals.relevanceScore,
  }).from(productVerticals).where(eq(productVerticals.companyId, companyId));

  const existingInventory: ExistingContentItem[] = [
    ...posts.map((post) => ({ title: post.title, kind: "post" as const })),
    ...clusters.map((cluster) => ({ title: cluster.primaryKeyword, kind: "cluster" as const })),
  ];
  const productTitles = productRows.map((product) => product.title);

  const aiPlan = await buildContentPlanWithClaude(gapQueries, existingInventory, productTitles, limit, companyContext);
  const baseline = aiPlan && aiPlan.length > 0
    ? aiPlan
    : gapQueries.map((querySummary) =>
      buildDeterministicPlanItem(
        querySummary,
        existingInventory,
        getProductTitlesForQuery(querySummary, productRows, productMappings),
        companyContext.brandProfile.displayName,
      )
    );

  const filtered: ContentPlanItem[] = [];
  for (const item of baseline) {
    const closest = getClosestExistingContent(item.title || item.primaryKeyword, existingInventory);
    const normalizedItem: ContentPlanItem = {
      ...item,
      secondaryKeywords: dedupeStrings(item.secondaryKeywords).slice(0, 5),
      supportingProducts: dedupeStrings(item.supportingProducts).slice(0, 5),
      researchNeeds: dedupeStrings(item.researchNeeds).slice(0, 5),
      recommendedProviders: dedupeStrings(item.recommendedProviders)
        .map((provider) => normalizeBenchmarkProvider(provider))
        .filter((provider): provider is BenchmarkProvider => Boolean(provider)),
      targetProducts: dedupeStrings(item.targetProducts || []).slice(0, 5),
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
    const fallback = buildDeterministicPlanItem(
      querySummary,
      existingInventory,
      getProductTitlesForQuery(querySummary, productRows, productMappings),
      companyContext.brandProfile.displayName,
    );
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
  const companyId = options.companyId || DEFAULT_COMPANY_ID;
  const clusterRows = await db.select().from(keywordClusters).where(eq(keywordClusters.companyId, companyId));
  const candidates = [options.item.title, options.item.primaryKeyword, options.item.query];
  const duplicateCluster = clusterRows.find((cluster) =>
    candidates.some((candidate) =>
      computeSimilarity(candidate, cluster.name) >= 0.82 ||
      computeSimilarity(candidate, cluster.primaryKeyword) >= 0.82,
    ),
  );

  let cluster = duplicateCluster;
  let created = false;
  let verticalId = options.item.verticalId || null;
  if (verticalId) {
    const [vertical] = await db
      .select({ id: industryVerticals.id })
      .from(industryVerticals)
      .where(and(eq(industryVerticals.companyId, companyId), eq(industryVerticals.id, verticalId)))
      .limit(1);
    if (!vertical) {
      throw new Error("Vertical not found for active company.");
    }
  }

  if (!cluster) {
    const [createdCluster] = await db.insert(keywordClusters).values({
      companyId,
      name: options.item.title,
      primaryKeyword: options.item.primaryKeyword,
      verticalId,
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
      companyId,
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
    const job = writingQueue.addJob(cluster.id, options.item.title, companyId);
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

async function captureMissingQueryBaselines(summary: BenchmarkRunSummary, companyId = DEFAULT_COMPANY_ID): Promise<void> {
  const now = new Date();

  for (const querySummary of summary.querySummaries) {
    const [storedQuery] = await db.select({
      benchmarkBaseline: aiBenchmarkQueries.benchmarkBaseline,
    }).from(aiBenchmarkQueries).where(and(eq(aiBenchmarkQueries.companyId, companyId), eq(aiBenchmarkQueries.id, querySummary.queryId))).limit(1);
    if (isUsableBenchmarkBaseline(storedQuery?.benchmarkBaseline)) continue;

    const completedResults = querySummary.results.filter((result) => result.status === "completed");
    if (completedResults.length === 0) continue;

    await db.update(aiBenchmarkQueries).set({
      benchmarkBaseline: {
        runId: summary.run.id,
        capturedAt: now.toISOString(),
        averageScore: querySummary.averageScore,
        averageMentionRate: querySummary.averageMentionRate,
        providers: completedResults.map((result) => ({
          provider: normalizeBenchmarkProvider(result.provider) || result.provider,
          status: result.status,
          coverageScore: result.coverageScore,
          targetBrandMentioned: result.targetBrandMentioned ?? result.brandMentioned,
          brandMentioned: result.brandMentioned,
          targetDomainCited: result.targetDomainCited ?? result.iboltCited,
          iboltCited: result.iboltCited,
          topPickRank: result.topPickRank,
          mentionedProducts: result.mentionedProducts,
          competitors: result.competitors,
        })),
      },
      benchmarkBaselinedAt: now,
      updatedAt: now,
    }).where(and(eq(aiBenchmarkQueries.companyId, companyId), eq(aiBenchmarkQueries.id, querySummary.queryId)));
  }
}

export async function runAiBenchmark(
  options: BenchmarkRunOptions,
  onProgress?: (event: BenchmarkProgressEvent) => void,
): Promise<BenchmarkRunSummary> {
  const providers = dedupeStrings(
    (options.providers?.length ? options.providers : BENCHMARK_PROVIDERS)
      .map((provider) => normalizeBenchmarkProvider(provider)),
  ) as BenchmarkProvider[];
  const activeProviders = providers.length > 0 ? providers : [...BENCHMARK_PROVIDERS];
  if (!activeProviders.some((provider) => isProviderConfigured(provider))) {
    throw new Error("No benchmark provider API keys are configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY/GOOGLE_AI_API_KEY before running a benchmark.");
  }
  const companyId = options.companyId || DEFAULT_COMPANY_ID;
  const companyContext = await getCompanyContext(companyId);
  const availableQueries = options.queryIds?.length
    ? await db
      .select()
      .from(aiBenchmarkQueries)
      .where(and(eq(aiBenchmarkQueries.companyId, companyId), inArray(aiBenchmarkQueries.id, options.queryIds)))
    : await db
      .select()
      .from(aiBenchmarkQueries)
      .where(and(eq(aiBenchmarkQueries.companyId, companyId), eq(aiBenchmarkQueries.status, "active")));
  const queries = sortQueries(availableQueries);
  const productRows = await db
    .select({ title: products.title, handle: products.handle })
    .from(products)
    .where(eq(products.companyId, companyId));

  const [run] = await db.insert(aiBenchmarkRuns).values({
    companyId,
    name: options.name || `AI Benchmark ${new Date().toISOString().slice(0, 10)}`,
    providers: activeProviders,
    status: "running",
    queryCount: queries.length,
    startedAt: new Date(),
  }).returning();

  const totalTasks = queries.length * activeProviders.length;
  onProgress?.({
    type: "started",
    runId: run.id,
    message: `Starting benchmark for ${queries.length} queries across ${activeProviders.length} providers.`,
    current: 0,
    total: totalTasks,
  });

  const pLimit = await getPLimit();
  const limit = pLimit(Math.max(1, options.concurrency || Number.parseInt(process.env.AI_BENCHMARK_CONCURRENCY || "2", 10) || 2));
  let completed = 0;

  const tasks = queries.flatMap((query) =>
    activeProviders.map((provider) =>
      limit(async () => {
        const prompt = buildBenchmarkPrompt(query.query);
        const execution = await runProvider(provider, prompt);

        const insertBase = {
          companyId,
          runId: run.id,
          queryId: query.id,
          provider,
          model: execution.model,
          prompt: execution.prompt,
        };

        let saved: AiBenchmarkResult;
        if (execution.status === "completed") {
          const analysis = analyzeResponse(query, execution.responseText, execution.sourceUrls, productRows, companyContext);
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
            targetBrandMentioned: false,
            brandMentioned: false,
            targetDomainCited: false,
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
  await captureMissingQueryBaselines(fullSummary, companyId);

  const [updatedRun] = await db.update(aiBenchmarkRuns).set({
    status: results.some((result) => result.status === "completed") ? "completed" : "failed",
    resultCount: results.filter((result) => result.status === "completed").length,
    summary: {
      providerSummaries: fullSummary.providerSummaries,
      biggestGaps: fullSummary.biggestGaps,
      topWins: fullSummary.topWins,
    },
    completedAt: new Date(),
  }).where(and(eq(aiBenchmarkRuns.companyId, companyId), eq(aiBenchmarkRuns.id, run.id))).returning();

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
