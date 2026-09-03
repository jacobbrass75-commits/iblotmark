#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.IBOLT_MARK_URL || "http://localhost:5001";
const companyId = process.env.DEFAULT_COMPANY_ID || "ibolt-default-company";
const currentRunId = process.argv.find((arg) => arg.startsWith("--current="))?.slice("--current=".length);
const previousRunId = process.argv.find((arg) => arg.startsWith("--previous="))?.slice("--previous=".length);
const outputDir = path.resolve(
  process.argv.find((arg) => arg.startsWith("--output="))?.slice("--output=".length)
    || "content-output/top-10-category-program-2026-08-05/benchmark-post-ai-pickup",
);

if (!currentRunId || !previousRunId) {
  throw new Error("Pass --current=<run id> and --previous=<run id>.");
}

async function getRun(runId) {
  const url = new URL(`/api/blog/benchmark/runs/${runId}`, baseUrl);
  url.searchParams.set("companyId", companyId);
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${url.pathname}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

function providerMap(run) {
  return new Map((run.providerSummaries || []).map((row) => [row.provider, row]));
}

function signed(value) {
  const number = Number(value || 0);
  return `${number > 0 ? "+" : ""}${number}`;
}

function queryLabel(query) {
  return String(query || "")
    .replace(/^What are the 10 best\s+/i, "")
    .replace(/\?$/, "");
}

const [current, previous] = await Promise.all([getRun(currentRunId), getRun(previousRunId)]);
const previousProviders = providerMap(previous);
const providerRows = (current.providerSummaries || []).map((row) => {
  const baseline = previousProviders.get(row.provider) || {};
  return {
    provider: row.provider,
    mentionRate: row.mentionRate,
    mentionDelta: row.mentionRate - Number(baseline.mentionRate || 0),
    citationRate: row.citationRate,
    citationDelta: row.citationRate - Number(baseline.citationRate || 0),
    topThreeRate: row.topThreeRate,
    topThreeDelta: row.topThreeRate - Number(baseline.topThreeRate || 0),
    avgScore: row.avgScore,
    scoreDelta: row.avgScore - Number(baseline.avgScore || 0),
  };
});

const previousQueries = new Map((previous.querySummaries || []).map((row) => [row.queryId, row]));
const queryRows = (current.querySummaries || []).map((row) => {
  const baseline = previousQueries.get(row.queryId) || {};
  const mentions = Object.fromEntries((row.results || []).map((result) => [result.provider, {
    mentioned: Boolean(result.targetBrandMentioned),
    cited: Boolean(result.targetDomainCited),
    rank: result.topPickRank ?? null,
    score: result.coverageScore,
  }]));
  return {
    category: row.category,
    query: row.query,
    averageScore: row.averageScore,
    scoreDelta: row.averageScore - Number(baseline.averageScore || 0),
    averageMentionRate: row.averageMentionRate,
    mentionDelta: row.averageMentionRate - Number(baseline.averageMentionRate || 0),
    mentions,
  };
});

const providerTable = providerRows.map((row) => (
  `| ${row.provider} | ${row.mentionRate}% | ${signed(row.mentionDelta)} pp | ${row.citationRate}% | ${row.topThreeRate}% | ${signed(row.topThreeDelta)} pp | ${row.avgScore} | ${signed(row.scoreDelta)} |`
)).join("\n");

const queryTable = queryRows.map((row) => {
  const surfaced = Object.entries(row.mentions)
    .filter(([, value]) => value.mentioned)
    .map(([provider, value]) => `${provider}${value.rank ? ` #${value.rank}` : ""}`)
    .join(", ") || "none";
  return `| ${queryLabel(row.query)} | ${row.averageMentionRate}% | ${signed(row.mentionDelta)} pp | ${row.averageScore} | ${signed(row.scoreDelta)} | ${surfaced} |`;
}).join("\n");

const markdown = `# Top 10 AI visibility post-deployment baseline

Current run: \`${currentRunId}\`\x20\x20
Previous run: \`${previousRunId}\`

This run was executed immediately after the ten Shopify pages were updated. It establishes a post-deployment baseline, but it does not measure indexing impact yet. Search-connected systems need time to recrawl and reprocess the pages, while non-search model answers may not change until later model or retrieval updates.

## Provider results

| Provider | Mention rate | Change | Citation rate | Top-three rate | Change | Avg score | Change |
|---|---:|---:|---:|---:|---:|---:|---:|
${providerTable}

## Query results

| Buyer query | Mention rate | Change | Avg score | Change | Providers surfacing iBOLT |
|---|---:|---:|---:|---:|---|
${queryTable}

## Interpretation and next retest

- The current technical target is citation acquisition. Mention coverage exists on ChatGPT and search-connected Gemini, but the target domain was cited in 0% of these API-style responses.
- Claude and plain Gemini are the largest unaided-brand gaps in this ten-query set.
- Bike/handlebar mounts remain the weakest category, with no iBOLT mention across the four providers.
- Preserve these exact queries and rerun after search systems have had time to recrawl. Compare 7-day and 28-day results against this run rather than treating minute-to-minute model variation as an SEO effect.
- Before redirecting overlapping older pages, review Search Console query and traffic data as specified in the canonical consolidation plan.
`;

await mkdir(outputDir, { recursive: true });
await Promise.all([
  writeFile(path.join(outputDir, "comparison.json"), `${JSON.stringify({ currentRunId, previousRunId, providerRows, queryRows }, null, 2)}\n`, "utf8"),
  writeFile(path.join(outputDir, "REPORT.md"), markdown, "utf8"),
]);

console.log(JSON.stringify({
  outputDir: path.relative(process.cwd(), outputDir),
  report: path.relative(process.cwd(), path.join(outputDir, "REPORT.md")),
  providerRows,
}, null, 2));
