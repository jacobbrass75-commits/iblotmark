import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_COMPANY_ID } from "../server/companyDefaults";
import type { BenchmarkProvider, BenchmarkRunSummary, ContentPlanItem } from "../server/aiBenchmark";

type ExpandedPrompt = {
  prompt: string;
  category: string;
  source: string;
  priority: number;
  reason: string;
  closestPost?: string;
  pageUrl?: string;
  promptType?: string;
  refreshState?: string;
  expectedMetric?: string;
};

type ProviderManifestRow = ExpandedPrompt & {
  batchId?: string;
  provider?: BenchmarkProvider;
};

type ProviderRequestRow = ExpandedPrompt & {
  batchId?: string;
  provider: BenchmarkProvider;
};

type AiBenchmarkModule = typeof import("../server/aiBenchmark");

const PROVIDERS: BenchmarkProvider[] = ["chatgpt", "gemini_plain", "claude"];

const PROVIDER_SET = new Set<BenchmarkProvider>(PROVIDERS);

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

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => value !== "")) rows.push(row);
  }

  const [headers = [], ...records] = rows;
  return records.map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])));
}

function parsePriority(value: unknown): number {
  const parsed = Number.parseInt(String(value || "70"), 10);
  return Number.isFinite(parsed) ? parsed : 70;
}

function normalizeProvider(value: string): BenchmarkProvider | null {
  const normalized = value.trim() as BenchmarkProvider;
  return PROVIDER_SET.has(normalized) ? normalized : null;
}

function promptFromCsvRow(row: Record<string, string>): ExpandedPrompt {
  return {
    prompt: row.prompt || row.query || "",
    category: row.category || "general",
    source: row.source || "csv_manifest",
    priority: parsePriority(row.priority),
    reason: row.reason || row.notes || row.expected_metric || "Expanded AI visibility benchmark prompt.",
    closestPost: row.closest_post || row.closestPost || "",
    pageUrl: row.page_url || row.pageUrl || "",
    promptType: row.prompt_type || row.promptType || "",
    refreshState: row.refresh_state || row.refreshState || "",
    expectedMetric: row.expected_metric || row.expectedMetric || "",
  };
}

function dedupePrompts(prompts: ExpandedPrompt[]): ExpandedPrompt[] {
  const byPrompt = new Map<string, ExpandedPrompt>();
  for (const prompt of prompts) {
    const key = prompt.prompt.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key) continue;
    const existing = byPrompt.get(key);
    if (!existing || prompt.priority > existing.priority) byPrompt.set(key, prompt);
  }
  return [...byPrompt.values()];
}

function promptDedupeKey(prompt: ExpandedPrompt): string {
  return prompt.prompt.toLowerCase().replace(/\s+/g, " ").trim();
}

function selectedProviderRequests(
  manifestRows: ProviderManifestRow[],
  selectedPrompts: ExpandedPrompt[],
): ProviderRequestRow[] {
  const selectedKeys = new Set(selectedPrompts.map(promptDedupeKey));
  const byRequest = new Map<string, ProviderRequestRow>();
  for (const row of manifestRows) {
    if (!row.provider || !selectedKeys.has(promptDedupeKey(row))) continue;
    const key = `${row.provider}|${promptDedupeKey(row)}`;
    const existing = byRequest.get(key);
    if (!existing || row.priority > existing.priority) {
      byRequest.set(key, { ...row, provider: row.provider });
    }
  }
  return [...byRequest.values()].sort((a, b) =>
    b.priority - a.priority
    || a.provider.localeCompare(b.provider)
    || a.prompt.localeCompare(b.prompt)
  );
}

function expandedProviderRequests(
  prompts: ExpandedPrompt[],
  providers: BenchmarkProvider[],
): ProviderRequestRow[] {
  return prompts.flatMap((prompt) => providers.map((provider) => ({ ...prompt, provider })));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "answer";
}

function truncateText(value: unknown, limit = 360): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 3).trim()}...` : text;
}

function markdownTable(rows: string[][]): string {
  if (!rows.length) return "";
  const [header, ...body] = rows;
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "n/a";
  return `${value}%`;
}

async function findLatestExpandedPromptFile(): Promise<string> {
  const outputRoot = path.join(process.cwd(), "content-output");
  const entries = await import("node:fs/promises").then((fs) => fs.readdir(outputRoot, { withFileTypes: true }));
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("openrouter-ai-benchmark-"))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const dir of dirs) {
    const candidate = path.join(outputRoot, dir, "deep-dive", "expanded-benchmark-prompts.json");
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch {
      // Try the next benchmark output directory.
    }
  }
  throw new Error("No expanded-benchmark-prompts.json file found. Run scripts/build-ai-visibility-deep-dive.mjs first.");
}

async function loadPromptSource(promptFile: string): Promise<{
  prompts: ExpandedPrompt[];
  providers: BenchmarkProvider[];
  manifestRows: ProviderManifestRow[];
}> {
  const text = await readFile(promptFile, "utf8");
  if (promptFile.endsWith(".json")) {
    return {
      prompts: JSON.parse(text) as ExpandedPrompt[],
      providers: PROVIDERS,
      manifestRows: [],
    };
  }

  const rows = parseCsv(text);
  const manifestRows = rows.map((row) => {
    const provider = normalizeProvider(row.provider || "");
    return {
      ...promptFromCsvRow(row),
      batchId: row.batch_id || row.batchId || "",
      provider: provider || undefined,
    };
  }).filter((row) => row.prompt);
  const providers = [...new Set(manifestRows.map((row) => row.provider).filter(Boolean))] as BenchmarkProvider[];

  return {
    prompts: dedupePrompts(manifestRows),
    providers: providers.length ? providers : PROVIDERS,
    manifestRows,
  };
}

function parseListEnv(name: string): Set<string> | null {
  const raw = process.env[name];
  if (!raw) return null;
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  return values.length ? new Set(values) : null;
}

function selectPrompts(prompts: ExpandedPrompt[]): ExpandedPrompt[] {
  const categoryFilter = parseListEnv("AI_BENCHMARK_EXPANDED_CATEGORY");
  const sourceFilter = parseListEnv("AI_BENCHMARK_EXPANDED_SOURCE");
  const limit = process.env.AI_BENCHMARK_EXPANDED_LIMIT
    ? Number.parseInt(process.env.AI_BENCHMARK_EXPANDED_LIMIT, 10)
    : 36;

  const filtered = prompts
    .filter((prompt) => !categoryFilter || categoryFilter.has(prompt.category))
    .filter((prompt) => !sourceFilter || sourceFilter.has(prompt.source))
    .sort((a, b) => b.priority - a.priority || a.prompt.localeCompare(b.prompt));

  return limit > 0 ? filtered.slice(0, limit) : filtered;
}

function labelFor(prompt: ExpandedPrompt): string {
  const clean = prompt.prompt.replace(/[^\w\s:/&-]/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > 72 ? `${clean.slice(0, 69).trim()}...` : clean;
}

async function ensureQueries(
  aiBenchmark: AiBenchmarkModule,
  prompts: ExpandedPrompt[],
  companyId: string,
): Promise<{ queryIds: string[]; inserted: number }> {
  const existing = await aiBenchmark.listBenchmarkQueries(companyId);
  const byQuery = new Map(existing.map((query) => [query.query.toLowerCase(), query]));
  const queryIds: string[] = [];
  let inserted = 0;

  for (const prompt of prompts) {
    const existingQuery = byQuery.get(prompt.prompt.toLowerCase());
    if (existingQuery) {
      queryIds.push(existingQuery.id);
      continue;
    }

    const created = await aiBenchmark.createBenchmarkQuery({
      companyId,
      category: prompt.category || "general",
      label: labelFor(prompt),
      query: prompt.prompt,
      intentType: "buyer_guide",
      priority: prompt.priority || 70,
      benchmarkGoal: "Expanded AI visibility benchmark prompt generated from current blog inventory, competitor gaps, or low-visibility benchmark gaps.",
      notes: [
        `Source: ${prompt.source}`,
        prompt.reason,
        prompt.closestPost ? `Closest post: ${prompt.closestPost}` : "",
      ].filter(Boolean).join("\n"),
      status: "active",
    });
    inserted += 1;
    byQuery.set(created.query.toLowerCase(), created);
    queryIds.push(created.id);
  }

  return { queryIds, inserted };
}

function buildReport(
  summary: BenchmarkRunSummary,
  contentPlan: ContentPlanItem[],
  selectedPrompts: ExpandedPrompt[],
  providers: BenchmarkProvider[],
) {
  const providerRows = [
    ["Provider", "Completed", "Avg score", "Mention rate", "Citation rate", "Top-3 rate"],
    ...summary.providerSummaries.map((provider) => [
      provider.provider,
      `${provider.completedCount}/${provider.queriesEvaluated}`,
      String(provider.avgScore),
      pct(provider.mentionRate),
      pct(provider.citationRate),
      pct(provider.topThreeRate),
    ]),
  ];
  const sourceCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  for (const prompt of selectedPrompts) {
    sourceCounts.set(prompt.source, (sourceCounts.get(prompt.source) || 0) + 1);
    categoryCounts.set(prompt.category, (categoryCounts.get(prompt.category) || 0) + 1);
  }
  const gapRows = [
    ["Query", "Category", "Avg score", "Mention", "Weak providers"],
    ...summary.querySummaries
      .filter((query) => query.averageScore < 70 || query.averageMentionRate === 0)
      .sort((a, b) => a.averageScore - b.averageScore || b.priority - a.priority)
      .slice(0, 20)
      .map((query) => [
        query.query,
        query.category,
        String(query.averageScore),
        pct(query.averageMentionRate),
        query.weakestProviders.join(", ") || "n/a",
      ]),
  ];
  const planRows = [
    ["Title", "Primary keyword", "Gap score"],
    ...contentPlan.slice(0, 12).map((item) => [item.title, item.primaryKeyword, String(item.gapScore)]),
  ];

  return [
    `# Expanded OpenRouter AI Visibility Benchmark - ${formatDateStamp()}`,
    "",
    `Run ID: ${summary.run.id}`,
    `Providers: ${providers.join(", ")}`,
    `Prompts tested: ${selectedPrompts.length}`,
    "",
    "This run uses the expanded prompt backlog and sends one provider-query request at a time with concurrency 1.",
    "",
    "## Prompt Mix",
    "",
    markdownTable([
      ["Dimension", "Count"],
      ...[...sourceCounts.entries()].sort((a, b) => b[1] - a[1]).map(([source, count]) => [`source: ${source}`, String(count)]),
      ...[...categoryCounts.entries()].sort((a, b) => b[1] - a[1]).map(([category, count]) => [`category: ${category}`, String(count)]),
    ]),
    "",
    "## Provider Summary",
    "",
    markdownTable(providerRows),
    "",
    "## Biggest Gaps",
    "",
    gapRows.length > 1 ? markdownTable(gapRows) : "No gaps below the configured threshold.",
    "",
    "## Next Content Actions",
    "",
    contentPlan.length ? markdownTable(planRows) : "No content plan items generated.",
    "",
  ].join("\n");
}

function combineSummaries(summaries: BenchmarkRunSummary[]): BenchmarkRunSummary {
  if (!summaries.length) throw new Error("No benchmark summaries generated.");
  return {
    ...summaries[0],
    providerSummaries: summaries.flatMap((summary) => summary.providerSummaries),
    querySummaries: summaries.flatMap((summary) => summary.querySummaries),
  };
}

async function main() {
  process.env.AI_BENCHMARK_FORCE_OPENROUTER ||= "1";

  const promptFile = process.env.AI_BENCHMARK_EXPANDED_MANIFEST
    || process.env.AI_BENCHMARK_PROVIDER_MANIFEST
    || process.env.AI_BENCHMARK_EXPANDED_PROMPTS
    || await findLatestExpandedPromptFile();
  const companyId = process.env.BENCHMARK_COMPANY_ID || DEFAULT_COMPANY_ID;
  const { prompts, providers, manifestRows } = await loadPromptSource(promptFile);
  const selectedPrompts = selectPrompts(prompts);
  if (!selectedPrompts.length) {
    throw new Error("No expanded prompts selected after applying filters.");
  }
  const exactProviderRequests = selectedProviderRequests(manifestRows, selectedPrompts);
  const providerRequests = exactProviderRequests.length
    ? exactProviderRequests
    : expandedProviderRequests(selectedPrompts, providers);
  const runProviders = [...new Set(providerRequests.map((request) => request.provider))] as BenchmarkProvider[];

  const outputDir = path.join(process.cwd(), "content-output", `openrouter-expanded-ai-benchmark-${formatTimeStamp()}`);
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, "selected-prompts.csv"),
    [
      ["prompt", "category", "source", "priority", "reason", "closest_post"],
      ...selectedPrompts.map((prompt) => [
        prompt.prompt,
        prompt.category,
        prompt.source,
        prompt.priority,
        prompt.reason,
        prompt.closestPost || "",
      ]),
    ].map((row) => row.map(csvCell).join(",")).join("\n"),
  );
  await writeFile(
    path.join(outputDir, "selected-prompts-extended.csv"),
    [
      ["prompt", "category", "source", "priority", "reason", "closest_post", "page_url", "prompt_type", "refresh_state", "expected_metric"],
      ...selectedPrompts.map((prompt) => [
        prompt.prompt,
        prompt.category,
        prompt.source,
        prompt.priority,
        prompt.reason,
        prompt.closestPost || "",
        prompt.pageUrl || "",
        prompt.promptType || "",
        prompt.refreshState || "",
        prompt.expectedMetric || "",
      ]),
    ].map((row) => row.map(csvCell).join(",")).join("\n"),
  );
  await writeFile(
    path.join(outputDir, "provider-request-manifest.csv"),
    [
      ["provider", "prompt", "category", "source", "priority", "closest_post", "page_url", "prompt_type", "refresh_state", "expected_metric"],
      ...providerRequests.map((request) => [
        request.provider,
        request.prompt,
        request.category,
        request.source,
        request.priority,
        request.closestPost || "",
        request.pageUrl || "",
        request.promptType || "",
        request.refreshState || "",
        request.expectedMetric || "",
      ]),
    ].map((row) => row.map(csvCell).join(",")).join("\n"),
  );

  if (process.env.AI_BENCHMARK_DRY_RUN === "1") {
    await writeFile(path.join(outputDir, "DRY_RUN.md"), [
      "# Expanded Benchmark Dry Run",
      "",
      `Selected prompts: ${selectedPrompts.length}`,
      `Provider requests: ${providerRequests.length}`,
      `Providers: ${runProviders.join(", ")}`,
      exactProviderRequests.length ? "Provider manifest mode: exact provider rows" : "Provider manifest mode: expanded prompt x provider matrix",
      `Prompt file: ${promptFile}`,
      manifestRows.length ? `Input manifest rows: ${manifestRows.length}` : "",
      "",
      "Set `OPENROUTER_API_KEY` and run without `AI_BENCHMARK_DRY_RUN=1` to execute.",
      "",
    ].filter(Boolean).join("\n"));
    console.log(`Dry run wrote selected prompts to ${outputDir}`);
    return;
  }

  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is required. Export it in the shell or add it to an ignored local env file before running.");
  }

  const aiBenchmark = await import("../server/aiBenchmark");
  let inserted = 0;
  let summary: BenchmarkRunSummary;
  let contentPlan: ContentPlanItem[] = [];
  if (exactProviderRequests.length) {
    const summaries: BenchmarkRunSummary[] = [];
    console.log(`Selected ${selectedPrompts.length} expanded prompts and ${exactProviderRequests.length} exact provider requests.`);
    for (const provider of runProviders) {
      const providerPrompts = dedupePrompts(exactProviderRequests.filter((request) => request.provider === provider));
      const ensured = await ensureQueries(aiBenchmark, providerPrompts, companyId);
      inserted += ensured.inserted;
      console.log(`Running ${provider}: ${providerPrompts.length} prompts. Concurrency: 1.`);
      const providerSummary = await aiBenchmark.runAiBenchmark({
        name: `OpenRouter Priority AI Visibility Retest ${formatDateStamp()} ${provider}`,
        providers: [provider],
        queryIds: ensured.queryIds,
        concurrency: 1,
        companyId,
      }, (event) => {
        if (event.type === "progress") {
          const score = event.result?.coverageScore ?? 0;
          const mention = event.result?.brandMentioned ? "mentioned" : "not mentioned";
          console.log(`${event.current}/${event.total} ${event.provider}: ${score} (${mention}) - ${event.query}`);
          return;
        }
        console.log(event.message);
      });
      summaries.push(providerSummary);
      contentPlan = contentPlan.concat(await aiBenchmark.generateContentPlan(providerSummary.run.id, 6, companyId));
    }
    summary = combineSummaries(summaries);
    console.log(`Inserted ${inserted} new benchmark queries across exact provider-request groups.`);
  } else {
    const { queryIds, inserted: insertedQueries } = await ensureQueries(aiBenchmark, selectedPrompts, companyId);
    inserted = insertedQueries;
    console.log(`Selected ${selectedPrompts.length} expanded prompts. Inserted ${inserted} new benchmark queries.`);
    console.log(`Providers: ${providers.join(", ")}. Concurrency: 1.`);

    summary = await aiBenchmark.runAiBenchmark({
      name: `OpenRouter Expanded AI Visibility Benchmark ${formatDateStamp()}`,
      providers,
      queryIds,
      concurrency: 1,
      companyId,
    }, (event) => {
      if (event.type === "progress") {
        const score = event.result?.coverageScore ?? 0;
        const mention = event.result?.brandMentioned ? "mentioned" : "not mentioned";
        console.log(`${event.current}/${event.total} ${event.provider}: ${score} (${mention}) - ${event.query}`);
        return;
      }
      console.log(event.message);
    });
    contentPlan = await aiBenchmark.generateContentPlan(summary.run.id, 18, companyId);
  }
  const rawAnswerDir = path.join(outputDir, "raw-answers");
  await mkdir(rawAnswerDir, { recursive: true });

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
      "source_urls",
      "positioning",
      "positioning_tags",
      "raw_response_excerpt",
      "raw_response_file",
      "analysis_notes",
    ],
    ...await Promise.all(summary.querySummaries.flatMap((query) =>
      query.results.map(async (result) => {
        const rawResponse = result.rawResponse || "";
        const answerFile = rawResponse
          ? path.join("raw-answers", `${slugify(query.query)}--${result.provider}.md`)
          : "";
        if (rawResponse && answerFile) {
          await writeFile(path.join(outputDir, answerFile), [
            `# ${query.query}`,
            "",
            `Provider: ${result.provider}`,
            `Model: ${result.model || ""}`,
            `Score: ${result.coverageScore}`,
            `Brand mentioned: ${result.brandMentioned}`,
            `Domain cited: ${result.iboltCited}`,
            `Top pick rank: ${result.topPickRank || ""}`,
            "",
            "## Raw Answer",
            "",
            rawResponse,
            "",
          ].join("\n"));
        }
        return [
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
        result.sourceUrls || [],
        result.positioning || "",
        result.positioningTags || [],
        truncateText(rawResponse),
        answerFile,
        result.analysisNotes,
        ];
      })
    )),
  ];

  await writeFile(path.join(outputDir, "summary.json"), JSON.stringify({
    summary,
    selectedPrompts,
    providers: runProviders,
    providerRequests,
    providerManifestMode: exactProviderRequests.length ? "exact_provider_rows" : "expanded_prompt_provider_matrix",
    contentPlan,
  }, null, 2));
  await writeFile(path.join(outputDir, "content-plan.json"), JSON.stringify(contentPlan, null, 2));
  await writeFile(path.join(outputDir, "raw-results.json"), JSON.stringify(summary.querySummaries.flatMap((query) =>
    query.results.map((result) => ({
      query: query.query,
      category: query.category,
      priority: query.priority,
      provider: result.provider,
      model: result.model,
      status: result.status,
      coverageScore: result.coverageScore,
      brandMentioned: result.brandMentioned,
      targetBrandMentioned: result.targetBrandMentioned,
      domainCited: result.iboltCited,
      targetDomainCited: result.targetDomainCited,
      topPickRank: result.topPickRank,
      sentiment: result.sentiment,
      positioning: result.positioning,
      positioningTags: result.positioningTags || [],
      competitors: result.competitors || [],
      mentionedProducts: result.mentionedProducts || [],
      sourceUrls: result.sourceUrls || [],
      rawResponse: result.rawResponse || "",
      analysisNotes: result.analysisNotes || "",
    }))
  ), null, 2));
  await writeFile(path.join(outputDir, "results.csv"), resultRows.map((row) => row.map(csvCell).join(",")).join("\n"));
  await writeFile(path.join(outputDir, "REPORT.md"), buildReport(summary, contentPlan, selectedPrompts, runProviders));

  console.log(`Wrote expanded benchmark report to ${outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
