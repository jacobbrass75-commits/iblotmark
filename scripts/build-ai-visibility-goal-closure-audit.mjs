import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const EXPANDED_PREFIX = "openrouter-expanded-ai-benchmark-";
const REPORT_DIR = "goal-closure-audit";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function latestDir(prefix) {
  const entries = await readdir(path.join(process.cwd(), OUTPUT_ROOT), { withFileTypes: true });
  const name = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!name) throw new Error(`No ${prefix} directory found in ${OUTPUT_ROOT}.`);
  return path.join(process.cwd(), OUTPUT_ROOT, name);
}

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function readTextIfExists(filePath, fallback = "") {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
}

function countCsvRecords(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .length - 1;
}

function countTextMatches(text, pattern) {
  return (String(text || "").match(pattern) || []).length;
}

function summaryMetric(text, metric) {
  const pattern = new RegExp(`"${metric.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}","([^"]*)"`);
  return pattern.exec(text)?.[1] || "";
}

function completionRows({
  master,
  goalRows,
  citationVsMention,
  citationVisibility,
  pageExecution,
  priorityRetest,
  nextBenchmark,
  postRunComparison,
  allBlogAddendum,
  queryLoss,
  testArea,
  manifestQa,
  citationBridge,
  mentionLanguage,
  mentionEnvironment,
  competitorComparison,
  productNameTruth,
  citationPriorityModel,
  allBlogPlanner,
  competitiveShare,
  competitorCounterplan,
  categoryProvider,
  promptIntent,
  kpiLadder,
  productConversion,
  portfolioSpread,
  pageHeatmap,
  blogBodyInspection,
  pageEditCommands,
  actionControl,
  latestDryRun,
  keyAvailable,
}) {
  const evidence = master.evidenceSummary || {};
  const mention = master.mentionSummary || {};
  const rows = [
    {
      requirement: "How iBOLT is getting mentioned",
      status: "proven",
      evidence: `${evidence.mentionCount || 0}/${evidence.total || 0} answers mention iBOLT, ${mention.catalogProductAliasAnswers || 0} catalog-product alias answers, and snippet/evidence reports classify clean mentions, co-mentions, replacements, and no-signal rows. Mention environment dossier separates ${mentionEnvironment.clean_mentions || 0} clean iBOLT mentions from ${mentionEnvironment.crowded_mentions || 0} crowded/co-mentioned answers and ${mentionEnvironment.replacements || 0} competitor replacement answers across ${mentionEnvironment.answers || 0} saved answer rows. Mention language command deck analyzes ${mentionLanguage.mentionRows || 0} mention rows, ${mentionLanguage.lostRows || 0} competitor-replacement language rows, and ${mentionLanguage.namingRows || 0} product naming candidates. Product name truth table classifies ${productNameTruth.candidates || 0} AI-visible product names into ${productNameTruth.exactCatalogNames || 0} exact catalog names, ${productNameTruth.validAliases || 0} valid aliases, ${productNameTruth.manualReview || 0} manual reviews, and ${productNameTruth.hallucinationRisk || 0} hallucination or wrong-alias risks across ${productNameTruth.pagesMapped || 0} mapped correction pages.`,
      remaining_gate: "Keep tracking quality after edits; no blocker for baseline analysis.",
    },
    {
      requirement: "Who iBOLT is mentioned next to",
      status: "proven",
      evidence: `Co-mention, answer-snippet, competitive share, competitor comparison, competitor-page counterplan, and mention environment reports identify the co-mention/replacement set. Mention environment dossier tracks ${mentionEnvironment.competitors_tracked || 0} surrounding/replacement brands, confirms ${mentionEnvironment.top_competitor || competitorCounterplan.topBrand || "RAM Mounts"} as the top pressure target with ${mentionEnvironment.top_competitor_replacements || competitorCounterplan.topBrandLostAnswers || 0} replacement rows, and maps ${mentionEnvironment.provider_category_pockets || 0} provider/category pressure pockets. Competitor comparison dossier tracks ${competitorComparison.competitors || 0} battlecard brands, ${competitorComparison.unique_replacement_answer_rows || 0} unique competitor-replacement answer rows, ${competitorComparison.brand_replacement_occurrences || 0} brand-level replacement occurrences, ${competitorComparison.co_mentions || 0} co-mentions, and ${competitorComparison.page_targets || 0} page targets. Competitive share of answer detects ${competitiveShare.brands || 0} competitor/entity brands; the page counterplan maps ${competitorCounterplan.competitors || 0} competitor brands and confirms ${competitorCounterplan.topBrand || "RAM Mounts"} as the top pressure target with ${competitorCounterplan.topBrandLostAnswers || 0} replacement rows.`,
      remaining_gate: "Retest after page edits to prove those competitors move from replacement to co-mention/top-3 iBOLT contexts.",
    },
    {
      requirement: "How iBOLT compares to competitors",
      status: "proven",
      evidence: `Competitor battlecards, displacement maps, provider strategy, page execution board, competitive share of answer, query-loss matrix, competitor comparison dossier, and competitor-page counterplan convert competitor pressure into page actions. Query-loss matrix maps ${queryLoss.queries || 0} losing queries across ${queryLoss.pages || 0} pages and ${queryLoss.competitors || 0} competitor brands. Competitive share adds ${competitiveShare.competitorOnly || 0}/${competitiveShare.answers || 0} competitor-only rows, ${competitiveShare.brands || 0} detected brands, and the competitor-page counterplan adds ${competitorCounterplan.pagePairs || 0} page pairs plus ${competitorCounterplan.promptPairs || 0} prompt pairs tied to comparison/citation actions. Competitor comparison adds top competitor ${competitorComparison.top_competitor || "RAM Mounts"}, ${competitorComparison.top_competitor_lost_answers || 0} top-competitor brand replacement occurrences, ${competitorComparison.page_targets || 0} page battlecards, and ${competitorComparison.prompt_targets || 0} prompt targets.`,
      remaining_gate: "Live retest is needed to prove comparison edits improved model answers.",
    },
    {
      requirement: "Test more areas",
      status: keyAvailable ? "ready_for_live_run" : "not_live_run",
      evidence: `Full all-blog manifest is ${allBlogAddendum.completeProviderRequests || priorityRetest.fullProviderRequests || 1377} provider requests across ${allBlogAddendum.completePrompts || "unknown"} prompts. Manifest QA verdict: ${manifestQa.verdict || "missing"} with ${manifestQa.providerRows || 0} provider rows, ${manifestQa.selectedPrompts || 0} prompts, ${manifestQa.providerBalance || "unknown provider balance"}, ${manifestQa.blockerFlags || 0} blockers, and ${manifestQa.reviewFlags || 0} review flags. Test-area expansion map covers ${testArea.categories || 0} categories, ${testArea.businessQuestions || 0} business-question groups, ${testArea.promptTypes || 0} prompt types, and ${testArea.categoryRows || 0} category rows. Category/provider priority report ranks ${categoryProvider.categories || 0} category lanes, ${categoryProvider.queries || 0} query rows, ${categoryProvider.pages || 0} page work orders, and ${categoryProvider.providerMisses || 0} provider miss cells. Prompt-intent loss report classifies ${promptIntent.intentTypes || 0} buyer question types across ${promptIntent.baselineQueries || 0} baseline queries, ${promptIntent.selectedPrompts || 0} selected prompts, ${promptIntent.providerRequests || 0} provider requests, and ${promptIntent.priorityRequests || 0} priority retest rows; top intent is ${promptIntent.topIntent || "best/recommendation"} with ${promptIntent.topIntentCompetitorOnlyAnswers || 0} competitor-only answers. KPI retest ladder defines count-based gates: +${kpiLadder.mentionLiftNeeded || 0} mentions, +${kpiLadder.nonBrandedLiftNeeded || 0} non-branded mentions, +${kpiLadder.topThreeLiftNeeded || 0} top-3 recommendations, +${kpiLadder.citationLiftNeeded || 0} citations, and ${kpiLadder.priorityRequests || 0} priority requests before the ${kpiLadder.fullProviderRequests || allBlogAddendum.completeProviderRequests || 0}-request full run. The prompt-gap addendum adds ${allBlogAddendum.gapPrompts || 0} prompts and ${allBlogAddendum.gapProviderRequests || 0} provider requests to close 6 uncovered live pages. Priority packet is ${priorityRetest.priorityProviderRequests || 0} exact provider requests across ${priorityRetest.uniquePrompts || 0} prompts, ${priorityRetest.pagesCovered || 0} pages, and ${priorityRetest.categoriesCovered || 0} categories. Next benchmark runbook adds ${nextBenchmark.waves || 0} runnable W1-W5 wave manifests covering ${nextBenchmark.priority_requests || 0} priority requests, ${nextBenchmark.priority_prompts || 0} prompts, ${nextBenchmark.priority_pages || 0} pages, and ${nextBenchmark.full_requests || 0} full all-blog requests, with ${nextBenchmark.dry_run_validated_waves || 0} dry-run validated waves and ${nextBenchmark.dry_run_validated_requests || 0} dry-run validated requests. Post-run comparison status is ${postRunComparison.status || "missing"}; it will compute baseline-vs-current KPI deltas once a completed expanded run writes results.csv. Latest dry run reports: ${latestDryRun || "no dry-run text found"}`,
      remaining_gate: keyAvailable
        ? "Run the priority packet or full all-blog manifest against live providers, then rebuild reports."
        : "Set OPENROUTER_API_KEY securely in the shell, run the priority packet or full all-blog manifest, then rebuild reports.",
    },
    {
      requirement: "Look at all blog posts and dig in",
      status: "proven",
      evidence: `All-blog and page execution artifacts cover ${pageExecution.pages || 0} page work orders. Citation-vs-mention ranks ${citationVsMention.livePages || 0} pages with ${citationVsMention.mentionOrCanonicalFirstPages || 0} mention/canonical-first pages and ${citationVsMention.sourceCleanupPages || 0} source-cleanup pages. Visibility-citation bridge separates ${citationBridge.mentionFirstPages || 0} mention-first pages from ${citationBridge.citationReadyPages || 0} citation-ready pages across ${citationBridge.totalPages || 0} page rows. The all-blog edit/retest planner orders ${allBlogPlanner.totalPages || 0} pages into ${allBlogPlanner.batchRows || 0} execution batches, including ${allBlogPlanner.b01Pages || 0} Sprint 1 pages, ${allBlogPlanner.mentionFirstPages || 0} mention-first execution pages, and ${allBlogPlanner.citationReadyPages || 0} citation-ready execution pages. The all-blog action control sheet joins ${actionControl.pages || 0} page rows into one operating queue, including ${actionControl.mentionRecoveryPages || 0} mention-recovery pages, ${actionControl.sourceCleanupPages || 0} source-cleanup pages, ${actionControl.productNameRiskPages || 0} product-name-risk pages, ${actionControl.quickAnswerPages || 0} quick-answer edits, and ${actionControl.schemaPages || 0} schema edits. Portfolio product spread analysis adds ${portfolioSpread.pages || 0} all-blog page rows, ${portfolioSpread.consolidate_pages || 0} consolidate-first pages, ${portfolioSpread.mention_recovery_pages || 0} mention-recovery pages, ${portfolioSpread.source_cleanup_pages || 0} source-cleanup pages, ${portfolioSpread.product_families || 0} product families, ${portfolioSpread.weak_product_families || 0} weak product-family lanes, top family ${portfolioSpread.top_family || "unknown"}, and top category ${portfolioSpread.top_category || "unknown"}. The page opportunity heatmap scores ${pageHeatmap.pages || 0} pages with ${pageHeatmap.aPages || 0} A-band edit-first pages, ${pageHeatmap.bPages || 0} B-band high-value refresh pages, top category ${pageHeatmap.topCategory || "unknown"}, and top batch ${pageHeatmap.topBatch || "unknown"}. Product conversion bridge covers ${productConversion.pagesBridged || 0} page rows, ${productConversion.ctaRiskPages || 0} CTA-risk pages, ${productConversion.productModulePages || 0} product-module opportunities, ${productConversion.categoryRows || 0} category bridges, and ${productConversion.familyRows || 0} product-family bridges. Body inspection covers ${blogBodyInspection.pages || 0} queued pages, including ${blogBodyInspection.fetched || 0} fetched or local-fallback bodies, avg body score ${blogBodyInspection.avgBodyScore || 0}, ${blogBodyInspection.missingQuickAnswer || 0} missing quick-answer openings, ${blogBodyInspection.weakInternalLinks || 0} weak internal-link rows, ${blogBodyInspection.repeatedCartCtas || 0} repeated cart-CTA rows, and ${blogBodyInspection.oldAiSections || 0} old AI-explainer leftovers. The page edit command matrix converts that into ${pageEditCommands.pages || 0} mechanical page commands, including ${pageEditCommands.quickAnswerPages || 0} quick-answer edits, ${pageEditCommands.schemaPages || 0} schema edits, ${pageEditCommands.comparisonPages || 0} comparison edits, and ${pageEditCommands.ctaPages || 0} CTA-density edits. Test-area expansion map confirms the full retest spans ${testArea.pages || 0} target pages.`,
      remaining_gate: "Edits still need to be applied to priority pages, then body inspection and live provider retests need to be rerun.",
    },
    {
      requirement: "Current visibility baseline",
      status: "proven_as_weak",
      evidence: `Mention ${evidence.mentionCount || 0}/${evidence.total || 0}; non-branded mention ${evidence.nonBrandedMentionCount || 0}/${evidence.nonBranded || 0}; top-3 ${mention.topThree || 0}/${mention.totalAnswers || evidence.total || 0}; citation ${evidence.citationCount || 0}/${evidence.total || 0}; competitor-only ${mention.competitorOnlyAnswers || competitiveShare.competitorOnly || 0}. KPI ladder translates that into exact next lift: +${kpiLadder.mentionLiftNeeded || 0} mentions, +${kpiLadder.nonBrandedLiftNeeded || 0} non-branded mentions, +${kpiLadder.topThreeLiftNeeded || 0} top-3 answers, +${kpiLadder.citationLiftNeeded || 0} citations, and ${kpiLadder.competitorOnlyReductionNeeded || 0} fewer competitor-only rows. Competitive share outcome taxonomy reports ${competitiveShare.competitorOnly || 0}/${competitiveShare.answers || 0} competitor-only rows. Citation priority model ranks ${citationPriorityModel.pagesScored || 0} pages into ${citationPriorityModel.mentionRecoveryPages || 0} mention-recovery pages, ${citationPriorityModel.productNameCleanupPages || 0} product-name cleanup pages, ${citationPriorityModel.sourceCleanupPages || 0} source-cleanup pages, and ${citationPriorityModel.citationOutreachCandidates || 0} citation-outreach candidates. Citation and visibility executive brief packages the leadership answer: citation rate should be tracked, but inclusion and recommendation come first; ${citationVisibility.priorityRequests || 0} priority requests and ${citationVisibility.fullProviderRequests || 0} full-run requests are staged for proof after edits.`,
      remaining_gate: "The baseline is proven. Improvement is not proven until post-edit live retest data exists.",
    },
    {
      requirement: "Execution path after analysis",
      status: "proven",
      evidence: `Page execution board provides ${pageExecution.pages || 0} work orders, ${pageExecution.sprint1Pages || 0} Sprint 1 pages, ${pageExecution.providerRequestsReady || 0} staged retest requests, and ${pageExecution.productFamilies || 0} product-family spread rows. Query-loss matrix adds query-level next actions for ${queryLoss.queries || 0} prompts and maps them to ${queryLoss.pages || 0} target pages. Visibility-citation bridge adds citation sequencing for ${citationBridge.categories || 0} categories and ${citationBridge.competitors || 0} competitor rows. Citation priority model sets top topic ${citationPriorityModel.topTopic || "unknown"}, top competitor ${citationPriorityModel.topCompetitor || "unknown"}, and confirms ${citationPriorityModel.citationOutreachCandidates || 0} pages should go straight to outreach before cleanup. Competitor-page counterplan adds ${competitorCounterplan.pagePairs || 0} competitor/page pairs and ${competitorCounterplan.promptPairs || 0} competitor/prompt pairs. Category/provider priority report separates fixes across ${categoryProvider.categories || 0} category lanes and ${categoryProvider.providerMisses || 0} provider miss cells. Prompt-intent loss report separates ${promptIntent.intentTypes || 0} prompt-intent groups so best/recommendation, comparison, product recall, shopping-advice, setup, and citation prompts can be retested one at a time. Portfolio product spread analysis adds refresh-vs-net-new decisions: ${portfolioSpread.refresh_first_decisions || 0} refresh/consolidate-first decisions, ${portfolioSpread.canonical_hub_decisions || 0} canonical hub decisions, and ${portfolioSpread.net_new_decisions || 0} net-new decisions. Product conversion bridge adds ${productConversion.checkoutQueueRows || 0} checkout-risk rows and confirms top product categories/families for turning AI visibility into product clicks. Product name truth table adds ${productNameTruth.catalogProductsQueued || 0} catalog-title reinforcement rows and ${productNameTruth.hallucinationRisk || 0} risky names to suppress before product-entity retests. The all-blog edit/retest planner adds a first-20 command sheet and a five-wave retest sequence, while the page opportunity heatmap ranks ${pageHeatmap.pages || 0} pages by combined AI risk, competitor pressure, checkout value, product coverage, and retest timing. Body inspection supplies the in-post fix queue, and the page edit command matrix now turns it into exact quick-answer, schema, comparison, product-path, CTA, image-alt, and retest commands for ${pageEditCommands.pages || 0} pages.`,
      remaining_gate: "Apply the edits and run the priority retest packet.",
    },
  ];

  const goalNotComplete = rows.some((row) => row.status === "not_live_run" || row.status === "ready_for_live_run");
  return {
    rows,
    verdict: goalNotComplete ? "not_complete" : "complete",
    blocker: keyAvailable ? "Live retest prepared but not run." : "OPENROUTER_API_KEY is not set in the local shell.",
    goalRows,
  };
}

function table(rows, columns) {
  const header = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
  const body = rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column.key])}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

function buildMarkdown({ result, priorityRetest, allBlogAddendum, keyAvailable }) {
  return `# AI Visibility Goal Closure Audit

## Verdict

${result.verdict === "complete" ? "Complete." : "Not complete yet."}

Reason: ${result.blocker}

## Requirement Status

| Requirement | Status | Evidence | Remaining gate |
| --- | --- | --- | --- |
${result.rows.map((row) => `| ${row.requirement} | ${row.status} | ${row.evidence} | ${row.remaining_gate} |`).join("\n")}

## Minimum Remaining Live Proof

Run the priority packet first, not the full backlog:

\`\`\`bash
export OPENROUTER_API_KEY="..."
AI_BENCHMARK_EXPANDED_LIMIT=0 \\
AI_BENCHMARK_EXPANDED_MANIFEST=content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/priority-retest-packet/priority-provider-request-manifest.csv \\
npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts
\`\`\`

Expected priority packet shape:

- Provider requests: ${priorityRetest.priorityProviderRequests || 0}
- Unique prompts: ${priorityRetest.uniquePrompts || 0}
- Pages: ${priorityRetest.pagesCovered || 0}
- Categories: ${priorityRetest.categoriesCovered || 0}
- Key available in this shell: ${keyAvailable ? "yes" : "no"}

Optional full all-blog coverage run:

\`\`\`bash
export OPENROUTER_API_KEY="..."
AI_BENCHMARK_EXPANDED_LIMIT=0 \\
AI_BENCHMARK_EXPANDED_MANIFEST=content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/all-blog-prompt-gap-addendum/all-blog-complete-provider-manifest.csv \\
npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts
\`\`\`

Expected full all-blog shape:

- Provider requests: ${allBlogAddendum.completeProviderRequests || 0}
- Unique prompts: ${allBlogAddendum.completePrompts || 0}
- Gap addendum prompts: ${allBlogAddendum.gapPrompts || 0}
- Gap addendum requests: ${allBlogAddendum.gapProviderRequests || 0}

After the run, rebuild the evidence reports and this closure audit.
`;
}

function buildHtml({ result, priorityRetest, allBlogAddendum, keyAvailable }) {
  const cards = [
    ["Verdict", result.verdict === "complete" ? "Complete" : "Not complete", result.blocker],
    ["Priority retest", priorityRetest.priorityProviderRequests || 0, `${priorityRetest.uniquePrompts || 0} prompts`],
    ["Full all-blog", allBlogAddendum.completeProviderRequests || 0, `${allBlogAddendum.completePrompts || 0} prompts`],
    ["Key in shell", keyAvailable ? "Yes" : "No", "OPENROUTER_API_KEY"],
  ].map(([label, value, note]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>iBOLT AI Visibility Goal Closure Audit</title>
<style>
body{margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,Helvetica,sans-serif}main{max-width:1160px;margin:0 auto;padding:34px 26px 64px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 14px}p{color:#334155;line-height:1.55}.note{background:#fff;border-left:6px solid ${result.verdict === "complete" ? "#16a34a" : "#f97316"};border-top:1px solid #d7dee8;border-right:1px solid #d7dee8;border-bottom:1px solid #d7dee8;border-radius:10px;padding:16px 18px}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:20px 0}.card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:800}.value{font-size:28px;font-weight:900;margin-top:8px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden;margin:12px 0 24px}th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}code{background:#eef2f7;padding:2px 5px;border-radius:5px}
</style></head><body><main>
<h1>iBOLT AI Visibility Goal Closure Audit</h1>
<p class="note"><strong>${result.verdict === "complete" ? "Complete" : "Not complete yet"}:</strong> ${escapeHtml(result.blocker)}</p>
<section class="cards">${cards}</section>
<h2>Requirement Status</h2>
${table(result.rows, [
  { key: "requirement", label: "Requirement" },
  { key: "status", label: "Status" },
  { key: "evidence", label: "Evidence" },
  { key: "remaining_gate", label: "Remaining gate" },
])}
<h2>Minimum Remaining Live Proof</h2>
<p><code>AI_BENCHMARK_EXPANDED_LIMIT=0 AI_BENCHMARK_EXPANDED_MANIFEST=content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/priority-retest-packet/priority-provider-request-manifest.csv npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts</code></p>
<p><code>AI_BENCHMARK_EXPANDED_LIMIT=0 AI_BENCHMARK_EXPANDED_MANIFEST=content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/all-blog-prompt-gap-addendum/all-blog-complete-provider-manifest.csv npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts</code></p>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const expandedDir = await latestDir(EXPANDED_PREFIX);
  const outDir = path.join(benchmarkDir, REPORT_DIR);
  await mkdir(outDir, { recursive: true });

  const master = await readJsonIfExists(path.join(benchmarkDir, "master-dossier", "master-dossier-data.json"), {});
  const priorityRetest = (await readJsonIfExists(path.join(benchmarkDir, "priority-retest-packet", "priority-retest-data.json"), { summary: {} })).summary || {};
  const nextBenchmark = (await readJsonIfExists(path.join(benchmarkDir, "next-benchmark-runbook", "next-benchmark-runbook-data.json"), { summary: {} })).summary || {};
  const postRunComparison = (await readJsonIfExists(path.join(benchmarkDir, "post-run-comparison", "post-run-comparison-data.json"), { summary: {} })).summary || {};
  const completeProviderManifest = await readTextIfExists(path.join(benchmarkDir, "all-blog-prompt-gap-addendum", "all-blog-complete-provider-manifest.csv"), "");
  const completeSelectedPrompts = await readTextIfExists(path.join(benchmarkDir, "all-blog-prompt-gap-addendum", "all-blog-complete-selected-prompts.csv"), "");
  const gapProviderManifest = await readTextIfExists(path.join(benchmarkDir, "all-blog-prompt-gap-addendum", "prompt-gap-provider-manifest.csv"), "");
  const gapSelectedPrompts = await readTextIfExists(path.join(benchmarkDir, "all-blog-prompt-gap-addendum", "prompt-gap-selected-prompts.csv"), "");
  const allBlogAddendum = {
    completeProviderRequests: Math.max(0, countCsvRecords(completeProviderManifest)),
    completePrompts: Math.max(0, countCsvRecords(completeSelectedPrompts)),
    gapProviderRequests: Math.max(0, countCsvRecords(gapProviderManifest)),
    gapPrompts: Math.max(0, countCsvRecords(gapSelectedPrompts)),
  };
  const queryLoss = {
    queries: Math.max(0, countCsvRecords(await readTextIfExists(path.join(benchmarkDir, "query-loss-recovery-matrix", "query-loss-recovery-matrix.csv"), ""))),
    pages: Math.max(0, countCsvRecords(await readTextIfExists(path.join(benchmarkDir, "query-loss-recovery-matrix", "page-loss-summary.csv"), ""))),
    competitors: Math.max(0, countCsvRecords(await readTextIfExists(path.join(benchmarkDir, "query-loss-recovery-matrix", "competitor-query-map.csv"), ""))),
  };
  const pageExecution = (await readJsonIfExists(path.join(benchmarkDir, "page-execution-control-board", "page-execution-control-data.json"), { summary: {} })).summary || {};
  const testAreaCategoryRows = await readTextIfExists(path.join(benchmarkDir, "test-area-expansion-map", "category-test-area-matrix.csv"), "");
  const testAreaBusinessRows = await readTextIfExists(path.join(benchmarkDir, "test-area-expansion-map", "business-question-coverage.csv"), "");
  const testAreaPromptRows = await readTextIfExists(path.join(benchmarkDir, "test-area-expansion-map", "prompt-type-test-area-matrix.csv"), "");
  const testAreaProviderRows = await readTextIfExists(path.join(benchmarkDir, "test-area-expansion-map", "provider-test-balance.csv"), "");
  const testArea = {
    categoryRows: Math.max(0, countCsvRecords(testAreaCategoryRows)),
    businessQuestions: Math.max(0, countCsvRecords(testAreaBusinessRows)),
    promptTypes: Math.max(0, countCsvRecords(testAreaPromptRows)),
    providers: Math.max(0, countCsvRecords(testAreaProviderRows)),
    categories: Math.max(0, countCsvRecords(testAreaCategoryRows)),
    pages: pageExecution.pages || 0,
  };
  const manifestQaText = await readTextIfExists(path.join(benchmarkDir, "benchmark-manifest-qa", "manifest-qa-summary.csv"), "");
  const manifestQa = {
    verdict: summaryMetric(manifestQaText, "verdict"),
    selectedPrompts: summaryMetric(manifestQaText, "selected_prompts"),
    providerRows: summaryMetric(manifestQaText, "provider_rows"),
    providerBalance: summaryMetric(manifestQaText, "provider_balance"),
    blockerFlags: summaryMetric(manifestQaText, "blocker_flags"),
    reviewFlags: summaryMetric(manifestQaText, "review_flags"),
  };
  const citationBridgeQueue = await readTextIfExists(path.join(benchmarkDir, "visibility-citation-bridge", "visibility-to-citation-page-queue.csv"), "");
  const citationBridge = {
    totalPages: Math.max(0, countCsvRecords(citationBridgeQueue)),
    mentionFirstPages: countTextMatches(citationBridgeQueue, /"Mention recovery first"/g),
    citationReadyPages: countTextMatches(citationBridgeQueue, /"Citation\/source push now"/g),
    categories: Math.max(0, countCsvRecords(await readTextIfExists(path.join(benchmarkDir, "visibility-citation-bridge", "category-visibility-citation-bridge.csv"), ""))),
    competitors: Math.max(0, countCsvRecords(await readTextIfExists(path.join(benchmarkDir, "visibility-citation-bridge", "competitor-citation-bridge.csv"), ""))),
  };
  const allBlogPlannerQueue = await readTextIfExists(path.join(benchmarkDir, "all-blog-edit-retest-planner", "all-blog-edit-retest-plan.csv"), "");
  const allBlogPlanner = {
    totalPages: Math.max(0, countCsvRecords(allBlogPlannerQueue)),
    b01Pages: countTextMatches(allBlogPlannerQueue, /"B01 Sprint 1 mention and checkout recovery"/g),
    mentionFirstPages:
      countTextMatches(allBlogPlannerQueue, /"B01 Sprint 1 mention and checkout recovery"/g)
      + countTextMatches(allBlogPlannerQueue, /"B02 Competitor mention recovery"/g),
    citationReadyPages: countTextMatches(allBlogPlannerQueue, /"B04 Citation and source cleanup"/g),
    batchRows: Math.max(0, countCsvRecords(await readTextIfExists(path.join(benchmarkDir, "all-blog-edit-retest-planner", "batch-summary.csv"), ""))),
    first20Rows: Math.max(0, countCsvRecords(await readTextIfExists(path.join(benchmarkDir, "all-blog-edit-retest-planner", "first-20-command-sheet.csv"), ""))),
  };
  const competitiveShare = (await readJsonIfExists(path.join(benchmarkDir, "competitive-share-of-answer", "competitive-share-data.json"), { summary: {} })).summary || {};
  const competitorCounterplan = (await readJsonIfExists(path.join(benchmarkDir, "competitor-page-counterplan", "competitor-page-counterplan-data.json"), { summary: {} })).summary || {};
  const categoryProvider = (await readJsonIfExists(path.join(benchmarkDir, "category-provider-priority-report", "category-provider-priority-data.json"), { summary: {} })).summary || {};
  const promptIntent = (await readJsonIfExists(path.join(benchmarkDir, "prompt-intent-loss-report", "prompt-intent-loss-data.json"), { summary: {} })).summary || {};
  const kpiLadder = (await readJsonIfExists(path.join(benchmarkDir, "visibility-kpi-retest-ladder", "visibility-kpi-ladder-data.json"), { summary: {} })).summary || {};
  const productConversion = (await readJsonIfExists(path.join(benchmarkDir, "product-conversion-visibility-bridge", "product-conversion-visibility-data.json"), { summary: {} })).summary || {};
  const portfolioSpread = (await readJsonIfExists(path.join(benchmarkDir, "portfolio-product-spread-analysis", "portfolio-product-spread-data.json"), { summary: {} })).summary || {};
  const pageHeatmap = (await readJsonIfExists(path.join(benchmarkDir, "blog-page-opportunity-heatmap", "blog-page-opportunity-data.json"), { summary: {} })).summary || {};
  const blogBodyInspection = (await readJsonIfExists(path.join(benchmarkDir, "blog-body-inspection", "blog-body-inspection-data.json"), { summary: {} })).summary || {};
  const pageEditCommands = (await readJsonIfExists(path.join(benchmarkDir, "page-edit-command-matrix", "page-edit-command-data.json"), { summary: {} })).summary || {};
  const actionControl = (await readJsonIfExists(path.join(benchmarkDir, "all-blog-action-control-sheet", "all-blog-action-control-data.json"), { summary: {} })).summary || {};
  const mentionLanguage = {
    mentionRows: Math.max(0, countCsvRecords(await readTextIfExists(path.join(benchmarkDir, "mention-quality-audit", "mention-quality-rows.csv"), ""))),
    lostRows: Math.max(0, countCsvRecords(await readTextIfExists(path.join(benchmarkDir, "answer-context-dossier", "lost-answer-language.csv"), ""))),
    namingRows: Math.max(0, countCsvRecords(await readTextIfExists(path.join(benchmarkDir, "mention-language-command-deck", "product-entity-naming-audit.csv"), ""))),
  };
  const mentionEnvironment = (await readJsonIfExists(path.join(benchmarkDir, "mention-environment-dossier", "mention-environment-data.json"), { summary: {} })).summary || {};
  const competitorComparison = (await readJsonIfExists(path.join(benchmarkDir, "competitor-comparison-dossier", "competitor-comparison-data.json"), { summary: {} })).summary || {};
  const productNameTruth = (await readJsonIfExists(path.join(benchmarkDir, "product-name-truth-table", "product-name-truth-data.json"), { summary: {} })).summary || {};
  const citationPriorityModel = (await readJsonIfExists(path.join(benchmarkDir, "citation-priority-model", "citation-priority-model-data.json"), { summary: {} })).summary || {};
  const citationVisibility = (await readJsonIfExists(path.join(benchmarkDir, "citation-visibility-executive-brief", "citation-visibility-executive-data.json"), { summary: {} })).summary || {};
  const citationVsMention = (await readJsonIfExists(path.join(benchmarkDir, "citation-vs-mention-control-report", "citation-vs-mention-data.json"), { summary: {} })).summary || {};
  const goalRows = await readTextIfExists(path.join(benchmarkDir, "goal-audit", "goal-requirement-audit.csv"), "");
  const latestDryRun = (await readTextIfExists(path.join(expandedDir, "DRY_RUN.md"), "")).replace(/\s+/g, " ").trim();
  const keyAvailable = Boolean(process.env.OPENROUTER_API_KEY);
  const result = completionRows({
    master,
    goalRows,
    citationVsMention,
    citationVisibility,
    pageExecution,
    priorityRetest,
    nextBenchmark,
    postRunComparison,
    allBlogAddendum,
    queryLoss,
    testArea,
    manifestQa,
    citationBridge,
    mentionLanguage,
    mentionEnvironment,
    competitorComparison,
    productNameTruth,
    citationPriorityModel,
    allBlogPlanner,
    competitiveShare,
    competitorCounterplan,
    categoryProvider,
    promptIntent,
    kpiLadder,
    productConversion,
    portfolioSpread,
    pageHeatmap,
    blogBodyInspection,
    pageEditCommands,
    actionControl,
    latestDryRun,
    keyAvailable,
  });

  await writeFile(path.join(outDir, "goal-closure-status.csv"), toCsv([
    ["requirement", "status", "evidence", "remaining_gate"],
    ...result.rows.map((row) => [row.requirement, row.status, row.evidence, row.remaining_gate]),
  ]));
  await writeFile(path.join(outDir, "goal-closure-data.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    benchmarkDir,
    expandedDir,
    keyAvailable,
    verdict: result.verdict,
    blocker: result.blocker,
    nextBenchmark,
    postRunComparison,
    allBlogAddendum,
    queryLoss,
    testArea,
    manifestQa,
    citationBridge,
    mentionLanguage,
    mentionEnvironment,
    competitorComparison,
    productNameTruth,
    allBlogPlanner,
    competitiveShare,
    competitorCounterplan,
    categoryProvider,
    promptIntent,
    kpiLadder,
    productConversion,
    portfolioSpread,
    pageHeatmap,
    rows: result.rows,
  }, null, 2));
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({ result, priorityRetest, allBlogAddendum, keyAvailable }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ result, priorityRetest, allBlogAddendum, keyAvailable }));

  console.log(`Wrote ${outDir}`);
  console.log(`Verdict: ${result.verdict}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
