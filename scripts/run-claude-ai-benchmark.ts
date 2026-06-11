import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  getBenchmarkRunSummary,
  listBenchmarkQueries,
  listBenchmarkRuns,
  runAiBenchmark,
  type BenchmarkRunSummary,
} from "../server/aiBenchmark";
import { DEFAULT_COMPANY_ID } from "../server/companyDefaults";

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

function formatDateStamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-");
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
  if (value > 0) return `+${value}`;
  return String(value);
}

function summaryForProvider(summary: BenchmarkRunSummary | null) {
  return summary?.providerSummaries.find((item) => item.provider === "claude") || null;
}

function buildComparison(
  current: BenchmarkRunSummary,
  previous: BenchmarkRunSummary | null,
): QueryComparison[] {
  const previousByQuery = new Map(
    (previous?.querySummaries || []).map((item) => [item.query, item]),
  );

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

function markdownTable(rows: string[][]): string {
  if (rows.length === 0) return "";
  const [header, ...body] = rows;
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function buildReport(
  current: BenchmarkRunSummary,
  previous: BenchmarkRunSummary | null,
  comparison: QueryComparison[],
): string {
  const currentProvider = summaryForProvider(current);
  const previousProvider = summaryForProvider(previous);
  const improved = [...comparison]
    .filter((item) => item.scoreDelta !== null && item.scoreDelta > 0)
    .sort((a, b) => (b.scoreDelta || 0) - (a.scoreDelta || 0))
    .slice(0, 8);
  const regressions = [...comparison]
    .filter((item) => item.scoreDelta !== null && item.scoreDelta < 0)
    .sort((a, b) => (a.scoreDelta || 0) - (b.scoreDelta || 0))
    .slice(0, 8);
  const currentGaps = [...comparison]
    .filter((item) => item.currentScore < 70 || item.currentMentionRate === 0)
    .sort((a, b) => a.currentScore - b.currentScore || b.priority - a.priority)
    .slice(0, 10);
  const currentWins = [...comparison]
    .filter((item) => item.currentScore >= 70 && item.currentMentionRate > 0)
    .sort((a, b) => b.currentScore - a.currentScore || b.priority - a.priority)
    .slice(0, 10);

  const metricRows = [
    ["Metric", "Current", "Previous", "Change"],
    [
      "Avg coverage score",
      String(currentProvider?.avgScore ?? 0),
      String(previousProvider?.avgScore ?? "n/a"),
      signed(previousProvider ? (currentProvider?.avgScore || 0) - previousProvider.avgScore : null),
    ],
    [
      "Brand mention rate",
      pct(currentProvider?.mentionRate ?? 0),
      pct(previousProvider?.mentionRate ?? null),
      signed(previousProvider ? (currentProvider?.mentionRate || 0) - previousProvider.mentionRate : null),
    ],
    [
      "Citation rate",
      pct(currentProvider?.citationRate ?? 0),
      pct(previousProvider?.citationRate ?? null),
      signed(previousProvider ? (currentProvider?.citationRate || 0) - previousProvider.citationRate : null),
    ],
    [
      "Top-3 recommendation rate",
      pct(currentProvider?.topThreeRate ?? 0),
      pct(previousProvider?.topThreeRate ?? null),
      signed(previousProvider ? (currentProvider?.topThreeRate || 0) - previousProvider.topThreeRate : null),
    ],
    [
      "Completed queries",
      String(currentProvider?.completedCount ?? 0),
      String(previousProvider?.completedCount ?? "n/a"),
      signed(previousProvider ? (currentProvider?.completedCount || 0) - previousProvider.completedCount : null),
    ],
  ];

  const gapRows = [
    ["Query", "Category", "Score", "Mention", "Priority"],
    ...currentGaps.map((item) => [
      item.query,
      item.category,
      String(item.currentScore),
      pct(item.currentMentionRate),
      String(item.priority),
    ]),
  ];

  const winRows = [
    ["Query", "Category", "Score", "Mention", "Priority"],
    ...currentWins.map((item) => [
      item.query,
      item.category,
      String(item.currentScore),
      pct(item.currentMentionRate),
      String(item.priority),
    ]),
  ];

  const improvedRows = [
    ["Query", "Score", "Previous", "Change"],
    ...improved.map((item) => [
      item.query,
      String(item.currentScore),
      String(item.previousScore ?? "n/a"),
      signed(item.scoreDelta),
    ]),
  ];

  const regressionRows = [
    ["Query", "Score", "Previous", "Change"],
    ...regressions.map((item) => [
      item.query,
      String(item.currentScore),
      String(item.previousScore ?? "n/a"),
      signed(item.scoreDelta),
    ]),
  ];

  return [
    `# Claude AI Visibility Benchmark - ${formatDateStamp()}`,
    "",
    `Run ID: ${current.run.id}`,
    `Previous run: ${previous?.run.id || "none"}`,
    `Provider: Claude`,
    `Queries evaluated: ${currentProvider?.queriesEvaluated ?? current.querySummaries.length}`,
    "",
    "## Overall Movement",
    "",
    markdownTable(metricRows),
    "",
    "## Strongest Current Results",
    "",
    currentWins.length ? markdownTable(winRows) : "No current wins met the score and mention threshold.",
    "",
    "## Current Gaps",
    "",
    currentGaps.length ? markdownTable(gapRows) : "No current gaps found.",
    "",
    "## Biggest Improvements",
    "",
    improved.length ? markdownTable(improvedRows) : "No positive score movement versus the previous Claude run.",
    "",
    "## Biggest Regressions",
    "",
    regressions.length ? markdownTable(regressionRows) : "No negative score movement versus the previous Claude run.",
    "",
    "## Notes",
    "",
    "- This run used the Claude provider only because OpenAI and Gemini API keys are not configured in this workspace.",
    "- The smoke-test query was excluded so the report reflects real iBOLT visibility prompts.",
    "- Citation rate is less meaningful for plain Claude API runs than for search-connected providers such as Gemini with Google Search or Perplexity.",
    "",
  ].join("\n");
}

async function main() {
  const companyId = process.env.BENCHMARK_COMPANY_ID || DEFAULT_COMPANY_ID;
  const queryLimit = process.env.AI_BENCHMARK_QUERY_LIMIT
    ? Number.parseInt(process.env.AI_BENCHMARK_QUERY_LIMIT, 10)
    : 0;

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  const previousRun = (await listBenchmarkRuns(25, companyId)).find((run) =>
    run.status === "completed"
    && (run.resultCount || 0) > 0
    && ((run.providers || []) as string[]).includes("claude")
  ) || null;
  const previousSummary = previousRun
    ? await getBenchmarkRunSummary(previousRun.id, companyId)
    : null;

  const queries = (await listBenchmarkQueries(companyId))
    .filter((query) => query.status === "active")
    .filter((query) => !/smoke test/i.test(query.query))
    .filter((query) => query.priority >= 80);
  const selectedQueries = queryLimit > 0 ? queries.slice(0, queryLimit) : queries;

  if (selectedQueries.length === 0) {
    throw new Error("No active benchmark queries selected.");
  }

  console.log(`Selected ${selectedQueries.length} active benchmark queries.`);
  if (previousRun) {
    console.log(`Comparing against previous Claude run ${previousRun.id}: ${previousRun.name || "(unnamed)"}.`);
  } else {
    console.log("No previous completed Claude run found.");
  }

  const currentSummary = await runAiBenchmark({
    name: `Claude Search Visibility Benchmark ${formatDateStamp()}`,
    providers: ["claude"],
    queryIds: selectedQueries.map((query) => query.id),
    concurrency: Number.parseInt(process.env.AI_BENCHMARK_CONCURRENCY || "2", 10) || 2,
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
  const outputDir = path.join(
    process.cwd(),
    "content-output",
    `ai-benchmark-${formatTimeStamp()}`,
  );
  await mkdir(outputDir, { recursive: true });

  const csvRows = [
    [
      "query",
      "category",
      "priority",
      "current_score",
      "previous_score",
      "score_delta",
      "current_mention_rate",
      "previous_mention_rate",
      "mention_delta",
      "weakest_providers",
    ],
    ...comparison.map((item) => [
      item.query,
      item.category,
      item.priority,
      item.currentScore,
      item.previousScore,
      item.scoreDelta,
      item.currentMentionRate,
      item.previousMentionRate,
      item.mentionDelta,
      item.weakestProviders,
    ]),
  ];

  await writeFile(
    path.join(outputDir, "summary.json"),
    JSON.stringify({
      current: currentSummary,
      previous: previousSummary,
      comparison,
    }, null, 2),
  );
  await writeFile(
    path.join(outputDir, "results.csv"),
    csvRows.map((row) => row.map(csvCell).join(",")).join("\n"),
  );
  await writeFile(
    path.join(outputDir, "REPORT.md"),
    buildReport(currentSummary, previousSummary, comparison),
  );

  console.log(`Wrote benchmark report to ${outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
