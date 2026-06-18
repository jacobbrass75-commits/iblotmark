import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createBenchmarkQuery,
  generateContentPlan,
  getBenchmarkRunSummary,
  listBenchmarkQueries,
  listBenchmarkRuns,
  runAiBenchmark,
  type BenchmarkProvider,
  type BenchmarkRunSummary,
  type ContentPlanItem,
} from "../server/aiBenchmark";
import { DEFAULT_COMPANY_ID } from "../server/companyDefaults";

type ExtraQuery = {
  category: string;
  label: string;
  query: string;
  priority: number;
  benchmarkGoal: string;
  notes?: string;
};

type QueryComparison = {
  query: string;
  category: string;
  priority: number;
  currentScore: number;
  previousScore: number | null;
  scoreDelta: number | null;
  currentMentionRate: number;
  previousMentionRate: number | null;
  mentionDelta: number | null;
  weakestProviders: string[];
};

const PROVIDERS: BenchmarkProvider[] = ["chatgpt", "gemini_plain", "claude"];

const EXTRA_QUERIES: ExtraQuery[] = [
  {
    category: "fishing",
    label: "Broad Fish Finder",
    query: "best fish finder",
    priority: 86,
    benchmarkGoal: "Measure whether broad fish finder intent ever surfaces mounting needs or iBOLT.",
    notes: "Broad consumer phrasing requested for one-at-a-time AI visibility testing.",
  },
  {
    category: "fishing",
    label: "Fish Finder In Water",
    query: "best fish finder in water",
    priority: 82,
    benchmarkGoal: "Catch awkward consumer phrasing around fish finder use in water and related mounting context.",
    notes: "Intentionally plain-language query mirroring user phrasing.",
  },
  {
    category: "tablet",
    label: "Broad Tablet Mount",
    query: "best tablet mount",
    priority: 88,
    benchmarkGoal: "Measure broad tablet mount answer sets across consumer AI assistants.",
    notes: "Broad consumer phrasing requested for one-at-a-time AI visibility testing.",
  },
  {
    category: "restaurant",
    label: "Multi Tablet Mount",
    query: "best multi tablet mount",
    priority: 89,
    benchmarkGoal: "Win multi-tablet station recommendations for restaurants and delivery app workflows.",
  },
];

function formatDateStamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("-");
}

function formatTimeStamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("-");
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value) ? value.join("; ") : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "n/a";
  return `${value}%`;
}

function signed(value: number | null | undefined): string {
  if (value === null || value === undefined) return "n/a";
  return value > 0 ? `+${value}` : String(value);
}

function markdownTable(rows: string[][]): string {
  if (rows.length === 0) return "";
  const [header, ...body] = rows;
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

async function ensureExtraQueries(companyId: string): Promise<number> {
  const existing = await listBenchmarkQueries(companyId);
  const existingQueries = new Set(existing.map((row) => row.query.toLowerCase()));
  let inserted = 0;

  for (const query of EXTRA_QUERIES) {
    if (existingQueries.has(query.query.toLowerCase())) continue;
    await createBenchmarkQuery({
      companyId,
      category: query.category,
      label: query.label,
      query: query.query,
      intentType: "buyer_guide",
      priority: query.priority,
      benchmarkGoal: query.benchmarkGoal,
      notes: query.notes || null,
      status: "active",
    });
    inserted += 1;
  }

  return inserted;
}

function choosePreviousRun(
  runs: Awaited<ReturnType<typeof listBenchmarkRuns>>,
  currentProviders: BenchmarkProvider[],
): Awaited<ReturnType<typeof listBenchmarkRuns>>[number] | null {
  return runs.find((run) =>
    run.status === "completed" &&
    (run.resultCount || 0) > 0 &&
    currentProviders.every((provider) => ((run.providers || []) as string[]).includes(provider))
  ) || null;
}

function buildComparison(
  current: BenchmarkRunSummary,
  previous: BenchmarkRunSummary | null,
): QueryComparison[] {
  const previousByQuery = new Map((previous?.querySummaries || []).map((item) => [item.query, item]));
  return current.querySummaries.map((item) => {
    const previousItem = previousByQuery.get(item.query) || null;
    return {
      query: item.query,
      category: item.category,
      priority: item.priority,
      currentScore: item.averageScore,
      previousScore: previousItem?.averageScore ?? null,
      scoreDelta: previousItem ? item.averageScore - previousItem.averageScore : null,
      currentMentionRate: item.averageMentionRate,
      previousMentionRate: previousItem?.averageMentionRate ?? null,
      mentionDelta: previousItem ? item.averageMentionRate - previousItem.averageMentionRate : null,
      weakestProviders: item.weakestProviders,
    };
  });
}

function buildReport(
  current: BenchmarkRunSummary,
  previous: BenchmarkRunSummary | null,
  comparison: QueryComparison[],
  contentPlan: ContentPlanItem[],
): string {
  const providerRows = [
    ["Provider", "Model family", "Completed", "Avg score", "Mention rate", "Citation rate", "Top-3 rate"],
    ...current.providerSummaries.map((provider) => [
      provider.provider,
      provider.provider === "chatgpt" ? "ChatGPT/OpenAI" : provider.provider === "gemini_plain" ? "Gemini" : "Claude",
      `${provider.completedCount}/${provider.queriesEvaluated}`,
      String(provider.avgScore),
      pct(provider.mentionRate),
      pct(provider.citationRate),
      pct(provider.topThreeRate),
    ]),
  ];

  const gapRows = [
    ["Query", "Category", "Avg score", "Mention", "Weak providers"],
    ...comparison
      .filter((item) => item.currentScore < 70 || item.currentMentionRate === 0)
      .sort((a, b) => a.currentScore - b.currentScore || b.priority - a.priority)
      .slice(0, 16)
      .map((item) => [
        item.query,
        item.category,
        String(item.currentScore),
        pct(item.currentMentionRate),
        item.weakestProviders.join(", ") || "n/a",
      ]),
  ];

  const movementRows = [
    ["Query", "Score", "Previous", "Change", "Mention change"],
    ...comparison
      .filter((item) => item.scoreDelta !== null)
      .sort((a, b) => Math.abs(b.scoreDelta || 0) - Math.abs(a.scoreDelta || 0))
      .slice(0, 12)
      .map((item) => [
        item.query,
        String(item.currentScore),
        String(item.previousScore ?? "n/a"),
        signed(item.scoreDelta),
        signed(item.mentionDelta),
      ]),
  ];

  const planRows = [
    ["Title", "Primary keyword", "Gap score", "Products"],
    ...contentPlan.slice(0, 10).map((item) => [
      item.title,
      item.primaryKeyword,
      String(item.gapScore),
      item.supportingProducts.join("; "),
    ]),
  ];

  return [
    `# OpenRouter AI Visibility Benchmark - ${formatDateStamp()}`,
    "",
    `Run ID: ${current.run.id}`,
    `Previous comparable run: ${previous?.run.id || "none"}`,
    `Providers: ${PROVIDERS.join(", ")}`,
    `Queries evaluated: ${current.querySummaries.length}`,
    "",
    "This run used separate provider-query requests with concurrency 1. It did not combine prompts into one large batch prompt.",
    "",
    "## Provider Summary",
    "",
    markdownTable(providerRows),
    "",
    "## Biggest Gaps",
    "",
    gapRows.length > 1 ? markdownTable(gapRows) : "No query gaps under the configured threshold.",
    "",
    "## Movement vs Previous Comparable Run",
    "",
    movementRows.length > 1 ? markdownTable(movementRows) : "No prior comparable three-provider OpenRouter run was available.",
    "",
    "## Next Content Actions",
    "",
    contentPlan.length ? markdownTable(planRows) : "No content plan items generated.",
    "",
  ].join("\n");
}

async function main() {
  const companyId = process.env.BENCHMARK_COMPANY_ID || DEFAULT_COMPANY_ID;
  const queryLimit = process.env.AI_BENCHMARK_QUERY_LIMIT
    ? Number.parseInt(process.env.AI_BENCHMARK_QUERY_LIMIT, 10)
    : 0;

  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is required for this benchmark runner.");
  }

  const inserted = await ensureExtraQueries(companyId);
  const runs = await listBenchmarkRuns(30, companyId);
  const previousRun = choosePreviousRun(runs, PROVIDERS);
  const previousSummary = previousRun ? await getBenchmarkRunSummary(previousRun.id, companyId) : null;
  const queries = (await listBenchmarkQueries(companyId))
    .filter((query) => query.status === "active")
    .filter((query) => !/smoke test/i.test(query.query));
  const selectedQueries = queryLimit > 0 ? queries.slice(0, queryLimit) : queries;

  if (selectedQueries.length === 0) {
    throw new Error("No active benchmark queries selected.");
  }

  console.log(`Inserted ${inserted} new benchmark queries.`);
  console.log(`Selected ${selectedQueries.length} active benchmark queries.`);
  console.log(`Providers: ${PROVIDERS.join(", ")}. Concurrency: 1.`);
  if (previousRun) {
    console.log(`Comparing against previous comparable run ${previousRun.id}.`);
  }

  const currentSummary = await runAiBenchmark({
    name: `OpenRouter Consumer AI Visibility Benchmark ${formatDateStamp()}`,
    providers: PROVIDERS,
    queryIds: selectedQueries.map((query) => query.id),
    concurrency: 1,
    companyId,
  }, (event) => {
    if (event.type === "started") {
      console.log(event.message);
      return;
    }
    if (event.type === "progress") {
      const score = event.result?.coverageScore ?? 0;
      const mention = event.result?.brandMentioned ? "mentioned" : "not mentioned";
      console.log(`${event.current}/${event.total} ${event.provider}: ${score} (${mention}) - ${event.query}`);
      return;
    }
    console.log(event.message);
  });

  const comparison = buildComparison(currentSummary, previousSummary);
  const contentPlan = await generateContentPlan(currentSummary.run.id, 12, companyId);
  const outputDir = path.join(process.cwd(), "content-output", `openrouter-ai-benchmark-${formatTimeStamp()}`);
  await mkdir(outputDir, { recursive: true });

  const resultRows = [
    [
      "provider",
      "query",
      "category",
      "priority",
      "status",
      "model",
      "coverage_score",
      "brand_mentioned",
      "domain_cited",
      "top_pick_rank",
      "sentiment",
      "competitors",
      "mentioned_products",
      "analysis_notes",
    ],
    ...currentSummary.querySummaries.flatMap((query) =>
      query.results.map((result) => [
        result.provider,
        query.query,
        query.category,
        query.priority,
        result.status,
        result.model,
        result.coverageScore,
        result.brandMentioned,
        result.iboltCited,
        result.topPickRank,
        result.sentiment,
        result.competitors || [],
        result.mentionedProducts || [],
        result.analysisNotes,
      ])
    ),
  ];

  await writeFile(
    path.join(outputDir, "summary.json"),
    JSON.stringify({ current: currentSummary, previous: previousSummary, comparison, contentPlan }, null, 2),
  );
  await writeFile(
    path.join(outputDir, "results.csv"),
    resultRows.map((row) => row.map(csvCell).join(",")).join("\n"),
  );
  await writeFile(path.join(outputDir, "content-plan.json"), JSON.stringify(contentPlan, null, 2));
  await writeFile(path.join(outputDir, "REPORT.md"), buildReport(currentSummary, previousSummary, comparison, contentPlan));

  console.log(`Wrote benchmark report to ${outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
