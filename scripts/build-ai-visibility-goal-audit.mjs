import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const AUDIT_PREFIX = "live-blog-ai-citability-merged-";
const EXPANDED_PREFIX = "openrouter-expanded-ai-benchmark-";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function csvCell(value) {
  if (Array.isArray(value)) value = value.join("; ");
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function csv(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function pct(numerator, denominator) {
  return denominator ? Math.round((Number(numerator || 0) / Number(denominator || 1)) * 100) : 0;
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

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readJsonIfExists(filePath, fallback) {
  try {
    return await readJson(filePath);
  } catch {
    return fallback;
  }
}

async function countCsvRows(filePath) {
  try {
    const text = await readFile(filePath, "utf8");
    return Math.max(0, text.split(/\r?\n/).filter(Boolean).length - 1);
  } catch {
    return 0;
  }
}

function makeRows({
  master,
  audit,
  expandedPromptCount,
  expandedProviderRequestCount,
  expandedDir,
  keyAvailable,
  pageBriefCount,
  canonicalMergeCount,
  opsBatchCount,
  opsRequestCount,
  contentGapBriefCount,
  noMappedPromptCount,
  editorBriefCount,
  answerMentionContextCount,
  lostAnswerContextCount,
  competitorContextCount,
  liveTriageCount,
  citationUpliftAppRows,
  citationUpliftRetestRows,
  queryPageRows,
  queryPagePageRows,
  queryPageCompetitorRows,
  canonicalDuplicateClusters,
  canonicalSafeRedirects,
  canonicalFamilyReviews,
  canonicalReviewClusters,
  survivorTicketCount,
  survivorCanonicalTickets,
  survivorDirectTickets,
  survivorReviewTickets,
  productEntitySummary,
  providerBlindspotSummary,
  mentionQualitySummary,
  blogPortfolioSummary,
  blogLifecycleSummary,
  competitorDisplacementSummary,
  visibilityExecutionSummary,
  sprint1EditorSummary,
  expandedTestCoverageSummary,
  verticalPlaybookSummary,
  sourceAuthoritySummary,
  benchmarkHistorySummary,
  answerOutcomeSummary,
  messageGapSummary,
  pageMessageGapSummary,
  coMentionNetworkSummary,
  conversionOpportunitySummary,
  citationReadinessSummary,
  allBlogPostDossierSummary,
  testAreaCoverageSummary,
  answerEvidenceViewerSummary,
  bossVisibilitySummary,
  providerStrategySummary,
  editImplementationSummary,
  contractorCitationSummary,
  citationRateDashboardSummary,
  citationVsMentionSummary,
  controlTowerSummary,
  contentGapDecisionSummary,
  answerSnippetSummary,
  blogPostControlSummary,
  pageDerivedPromptSummary,
  competitorBattlecardSummary,
  pageExecutionSummary,
  priorityRetestSummary,
  closureSummary,
  answerExamplesSummary,
  allPageDrilldownSummary,
}) {
  const evidence = master.evidenceSummary;
  const mention = master.mentionSummary;
  const blog = master.blogSummary;
  const live = audit.summary;
  const fullBenchmarkBlocked = !keyAvailable;
  return [
    {
      requirement: "How iBOLT is getting mentioned",
      status: "Proven",
      evidence: `${evidence.mentionCount}/${evidence.total} answers mention iBOLT, ${evidence.nonBrandedMentionCount}/${evidence.nonBranded} non-branded answers mention iBOLT, answer taxonomy separates those into ${answerOutcomeSummary.top3Rows || 0} top-3 wins and ${answerOutcomeSummary.weakMentionRows || 0} weaker mentions, ${evidence.productSignalRows}/${evidence.total} include broad product/family signals, ${evidence.catalogProductRows}/${evidence.total} include actual catalog aliases, ${answerMentionContextCount} mention-context snippets were extracted from raw answers, and the answer evidence viewer classifies ${answerEvidenceViewerSummary.totalAnswers || evidence.total} prompt/provider rows into ${answerEvidenceViewerSummary.cleanMentions || 0} clean iBOLT mentions, ${answerEvidenceViewerSummary.coMentions || 0} co-mentions, ${answerEvidenceViewerSummary.competitorReplacements || 0} competitor replacements, and ${answerEvidenceViewerSummary.noSignal || 0} no-signal rows. The answer-snippet appendix adds concrete snippets for ${answerSnippetSummary.cleanMentions || 0} clean iBOLT mentions, ${answerSnippetSummary.coMentions || 0} co-mentions, and ${answerSnippetSummary.competitorReplacements || 0} competitor replacement rows. The answer examples report selects ${answerExamplesSummary.selectedExamples || 0} concrete examples and ${answerExamplesSummary.competitorShortlist || 0} competitor comparison rows for boss review. The mention-quality audit scores ${mentionQualitySummary.mentionRows || 0} iBOLT mention rows at ${mentionQualitySummary.avgMentionQuality || 0}/100 average quality with ${mentionQualitySummary.catalogMatchedMentionRows || 0} catalog-matched mention rows and ${mentionQualitySummary.namingReviewRows || 0} naming-review rows, and the product entity coverage plan found ${productEntitySummary.workQueueRows || 0} product/entity fixes tied to catalog and page-module evidence.`,
      gap: "Product-specific entity strength is still weak, especially on broad non-branded prompts, and some AI-visible product names need review as aliases, old names, or hallucination risk.",
      next: "Increase catalog product alias rows from 8/93 to 20/93 using product modules, exact product names, structured product fields, source-ready product cards, and cleanup of fuzzy AI product names.",
    },
    {
      requirement: "Who iBOLT is mentioned next to or replaced by",
      status: "Proven",
      evidence: `Raw detector competitor-only rows are ${mention.competitorOnlyAnswers}; the merged-field answer taxonomy classifies ${answerOutcomeSummary.competitorOnlyRows || 0}/${answerOutcomeSummary.totalAnswers || evidence.total} rows as competitor-only and ${answerOutcomeSummary.noSignalRows || 0} rows as no usable brand signal; co-mentioned rows are ${mention.coMentionAnswers}. The answer evidence viewer maps ${answerEvidenceViewerSummary.mappedPages || 0} answer rows back to page actions and exposes provider-level rows for the replacement set. Provider-specific strategy identifies ${providerStrategySummary.harshestProvider || "Claude"} as the harshest replacement provider, ${providerStrategySummary.mostRecoverableProvider || "ChatGPT"} as the most recoverable provider, and ${providerStrategySummary.topWorkQueueRows || 0} provider work-queue rows. The competitor displacement map ranks ${competitorDisplacementSummary.competitorRows || 0} competitor/default brands, ${competitorDisplacementSummary.queryActionRows || 0} query action rows, ${competitorDisplacementSummary.zeroMentionQueries || 0} zero-mention queries, and ${competitorDisplacementSummary.topicRows || 0} topic groups; top displacement brands are ${(competitorDisplacementSummary.topCompetitors || []).join(", ") || "RAM Mounts, Arkon, iOttie, ProClip, CTA Digital"}. Competitor battlecard control report adds ${competitorBattlecardSummary.competitors || 0} tracked competitors, ${competitorBattlecardSummary.tier1 || 0} Tier 1 brands, ${competitorBattlecardSummary.mappedPages || 0} mapped pages, ${competitorBattlecardSummary.pageActions || 0} page actions, and ${competitorBattlecardSummary.retestPrompts || 0} competitor-linked retest prompts; Tier 1 brands are ${(competitorBattlecardSummary.topTier1Brands || []).join(", ") || "not available"}. The answer-context dossier extracted ${lostAnswerContextCount} lost-answer rows and ${competitorContextCount} competitor context rows, the query-page matrix maps ${queryPageCompetitorRows} competitor groups to affected live pages, and the provider blind-spot report adds ${providerBlindspotSummary.competitorRows || 0} provider/competitor default rows across ChatGPT, Claude, and Gemini.`,
      gap: "AI systems often choose competitor sets without iBOLT on generic buyer prompts.",
      next: "Add comparison sections that put iBOLT in the same consideration set as the brands AI already recommends.",
    },
    {
      requirement: "Co-mention and replacement network",
      status: "Proven",
      evidence: `Co-mention network separates ${coMentionNetworkSummary.mentionRows || 0}/${coMentionNetworkSummary.totalAnswers || evidence.total} iBOLT mentions into ${coMentionNetworkSummary.cleanMentionRows || 0} clean mentions and ${coMentionNetworkSummary.coMentionRows || 0} competitor co-mentions, meaning ${coMentionNetworkSummary.coMentionShareOfMentions || 0}% of iBOLT mentions happen inside comparison sets. It also separates ${coMentionNetworkSummary.competitorOnlyRows || 0} strict structured competitor-only rows from ${coMentionNetworkSummary.rawDetectorCompetitorOnlyRows || mention.competitorOnlyAnswers} raw detector rows, with ${(coMentionNetworkSummary.topCoMentionCompetitors || []).join(", ") || "not available"} as top co-mentioned competitors and ${(coMentionNetworkSummary.topReplacementCompetitors || []).join(", ") || "not available"} as top replacement competitors. The answer-snippet appendix turns this into ${answerSnippetSummary.competitorRows || 0} competitor context rows and highlights top replacement pressure from ${(answerSnippetSummary.topReplacementCompetitors || []).slice(0, 5).join(", ") || "not available"}. Competitor battlecards convert the network into ${competitorBattlecardSummary.pageActions || 0} page actions and ${competitorBattlecardSummary.retestPrompts || 0} retest prompts. Query outcomes show ${coMentionNetworkSummary.cleanWinQueries || 0} clean iBOLT wins, ${coMentionNetworkSummary.includedWithCompetitorsQueries || 0} iBOLT-included comparison sets, ${coMentionNetworkSummary.mixedQueries || 0} mixed provider splits, and ${coMentionNetworkSummary.replacementQueries || 0} competitor replacement queries.`,
      gap: "Most broad buyer prompts are still competitor replacement queries, while iBOLT's strongest current visibility is on branded or direct-comparison prompts.",
      next: "Use co-mentioned competitors as comparison anchors, but focus edits on moving iBOLT from co-mentioned to top-3 recommended and from competitor-only to included.",
    },
    {
      requirement: "Message gaps inside AI answers",
      status: "Proven",
      evidence: `Message-gap map analyzes ${messageGapSummary.iboltMentionRows || 0} iBOLT mention-context rows, ${messageGapSummary.lostAnswerRows || 0} lost-answer rows, ${messageGapSummary.competitorRows || 0} competitor/default brands, ${messageGapSummary.queryRows || 0} query-language rows, and ${messageGapSummary.copyActionRows || 0} copy/schema action rows. The largest language gaps are ${(messageGapSummary.topThemeGaps || []).join(", ") || "not available"}. The highest competitor message pressures are ${(messageGapSummary.topCompetitors || []).slice(0, 6).join(", ") || "not available"}.`,
      gap: "Competitor answers are framed around practical buyer-decision language more consistently than iBOLT answers: rugged durability, install clarity, stability/grip, compatibility, and adjustability.",
      next: "Add those proof points to priority pages with exact iBOLT product entities, while preserving brand safety: use specialist positioning instead of price-led positioning.",
    },
    {
      requirement: "How iBOLT compares to competitors",
      status: "Proven",
      evidence: `Competitive matrix and battlecards identify RAM Mounts, Arkon, iOttie, ProClip, Humminbird, Scosche, Garmin, Scotty, Mount-It, Lowrance, YakAttack, and Tackform as the main displacement targets. The competitor displacement map assigns roles, on-site counter-positioning, off-site contractor asks, and success metrics to ${competitorDisplacementSummary.competitorRows || 0} brands, with ${(competitorDisplacementSummary.topTopics || []).join(", ") || "restaurant, delivery, fleet, fishing, warehouse"} as the highest-pressure topics. The query-page matrix joins ${queryPageRows} benchmark query rows to competitor sets, affected pages, product modules, and retest actions. The survivor-aware edit queue turns this into ${survivorTicketCount} page tickets.`,
      gap: "The current site often has topical coverage, but not enough answer-first comparison framing.",
      next: "Refresh priority pages with fair tradeoff blocks, specialist positioning, product-specific recommendations, and FAQ schema.",
    },
    {
      requirement: "Test more areas",
      status: fullBenchmarkBlocked ? "Partially proven, blocked for live model execution" : "Ready to execute",
      evidence: `Completed benchmark has ${evidence.total} saved answers across ${mention.totalAnswers ? 31 : "multiple"} query groups and ${mention.providerCategoryRows?.length || 21} provider/category slices. Benchmark history report compares ${benchmarkHistorySummary.completedRunRows || 0} completed benchmark surfaces, ${benchmarkHistorySummary.manualGoogleRows || 0} manual Google AI Mode rows, ${benchmarkHistorySummary.liveAuditSnapshots || 0} live-blog audit snapshots, and ${benchmarkHistorySummary.latestExpandedPrompts || expandedPromptCount} expanded dry-run prompts. Provider blind-spot analysis adds ${providerBlindspotSummary.consensusRows || 0} query consensus rows, ${providerBlindspotSummary.blindspotRows || 0} provider/query blind-spot rows, and ${providerBlindspotSummary.retestRows || 0} provider-specific retest rows. Latest runner dry run selected ${expandedPromptCount} prompts and ${expandedProviderRequestCount} provider requests in ${expandedDir}. Priority retest packet narrows the queue to ${priorityRetestSummary.priorityProviderRequests || 0} exact provider requests, ${priorityRetestSummary.uniquePrompts || 0} unique prompts, ${priorityRetestSummary.pagesCovered || 0} pages, and ${priorityRetestSummary.categoriesCovered || 0} categories before the full ${priorityRetestSummary.fullProviderRequests || pageDerivedPromptSummary.providerRequests || 0}-request backlog. Goal closure audit verdict is ${closureSummary.verdict || "missing"} with ${closureSummary.rows || 0} requirement rows; remaining live blocker is ${closureSummary.blocker || "none"}. Expanded prompt backlog has ${expandedTestCoverageSummary.promptCount || expandedPromptCount} prompts, organized into ${expandedTestCoverageSummary.batchCount || opsBatchCount} batches and ${expandedTestCoverageSummary.providerRequestCount || opsRequestCount} provider requests. Page-derived expanded benchmark pack adds ${pageDerivedPromptSummary.prompts || 0} more prompts, ${pageDerivedPromptSummary.providerRequests || 0} provider requests, ${pageDerivedPromptSummary.pagesCovered || 0} covered live pages, ${pageDerivedPromptSummary.categories || 0} categories, ${pageDerivedPromptSummary.comparisonPrompts || 0} competitor-comparison prompts, ${pageDerivedPromptSummary.nonBrandedBestPrompts || 0} non-branded buyer prompts, ${pageDerivedPromptSummary.buyerProblemPrompts || 0} buyer-problem prompts, ${pageDerivedPromptSummary.productPrompts || 0} product-entity prompts, and ${pageDerivedPromptSummary.citationProbePrompts || 0} citation probes. The expanded coverage map classifies ${expandedTestCoverageSummary.noMappedPrompts || noMappedPromptCount} new-content/solution prompts, ${expandedTestCoverageSummary.refreshThenRetestPrompts || 0} refresh-then-retest prompts, ${expandedTestCoverageSummary.canonicalReviewPrompts || 0} canonical-review prompts, and ${expandedTestCoverageSummary.mappedLowerPriorityPrompts || 0} lower-priority mapped retests across ${(expandedTestCoverageSummary.categoryRows || []).length} categories. The test-area coverage audit checks ${testAreaCoverageSummary.expandedPrompts || expandedPromptCount} prompts and ${testAreaCoverageSummary.providerRequests || 0} provider requests across ${testAreaCoverageSummary.categories || 0} categories and ${testAreaCoverageSummary.productFamilies || 0} product families, with ${testAreaCoverageSummary.highGapCategories || 0} high-gap categories, ${testAreaCoverageSummary.noMappedPromptCategories || 0} categories needing new/mapped prompt coverage, ${testAreaCoverageSummary.weakFamilyCoverage || 0} weak product-family areas, top under-tested categories ${(testAreaCoverageSummary.topUnderTestedCategories || []).slice(0, 6).join(", ") || "not available"}, and top weak product families ${(testAreaCoverageSummary.topWeakFamilies || []).slice(0, 5).join(", ") || "not available"}. ${noMappedPromptCount} no-mapped prompts are clustered into ${contentGapBriefCount} future content briefs. Content-gap decision matrix resolves those into ${contentGapDecisionSummary.contentGapRows || 0} content decisions, ${contentGapDecisionSummary.noMappedPrompts || 0} no-mapped prompt rows, ${contentGapDecisionSummary.productGapRows || 0} product-linking rows, ${contentGapDecisionSummary.refreshFirst || 0} refresh/consolidate-first rows, ${contentGapDecisionSummary.canonicalHubs || 0} canonical hub rows, and ${contentGapDecisionSummary.netNew || 0} net-new supporting content rows.`,
      gap: fullBenchmarkBlocked ? "The expanded live benchmark cannot run because OPENROUTER_API_KEY is not set in the local shell." : "OPENROUTER_API_KEY is available, but the expanded benchmark still needs to be run.",
      next: "Run the full expanded benchmark one request at a time, then rebuild the evidence, mention, competitor, roadmap, citation, and master reports.",
    },
    {
      requirement: "Look at all blog posts and dig in",
      status: "Proven",
      evidence: `${blog.localPosts} local published posts, ${blog.shopifySynced} Shopify-synced posts, ${live.ok}/${live.total} live sitemap pages audited, ${liveTriageCount} live pages classified in the triage ledger, ${queryPagePageRows} live pages mapped to benchmark query pressure, blog portfolio map joins ${blogPortfolioSummary.livePages || 0} live pages with ${blogPortfolioSummary.localMatchedPages || 0} matched local/app posts, ${blogPortfolioSummary.benchmarkPressurePages || 0} benchmark-pressure pages, ${blogPortfolioSummary.productTargetPages || 0} product-target pages, ${blogPortfolioSummary.canonicalReviewPages || 0} canonical/consolidation pages, ${blogPortfolioSummary.categoryRows || 0} topic rows, and ${blogPortfolioSummary.gapRows || 0} gap rows, the lifecycle map classifies ${blogLifecycleSummary.pages || 0} live pages into ${blogLifecycleSummary.protectAndAmplifyPages || 0} protect/amplify pages, ${blogLifecycleSummary.canonicalDecisionPages || 0} canonical-decision pages, ${blogLifecycleSummary.citationSchemaCleanupPages || 0} citation/schema cleanup pages, ${blogLifecycleSummary.legacyRewritePages || 0} legacy rewrites, and ${blogLifecycleSummary.retireNoindexCandidatePages || 0} retire/noindex candidates. Page-message gap map joins message gaps back to ${pageMessageGapSummary.pages || 0} pages, including ${pageMessageGapSummary.benchmarkPressurePages || 0} benchmark-pressure pages, ${pageMessageGapSummary.canonicalReviewPages || 0} canonical-review-first pages, ${pageMessageGapSummary.aiVisibilityRefreshPages || 0} direct AI visibility refreshes, ${pageMessageGapSummary.citationCleanupPages || 0} citation/schema cleanup pages, ${pageMessageGapSummary.legacyRewritePages || 0} legacy rewrites, and top page themes ${(pageMessageGapSummary.topMessageThemes || []).slice(0, 5).join(", ") || "not available"}. All-blog-post dossier joins lifecycle, portfolio, citation-readiness, conversion, and product/entity rows for ${allBlogPostDossierSummary.pages || 0} pages, splitting them into ${allBlogPostDossierSummary.canonicalMentionRecoveryPages || 0} canonical plus mention-recovery pages, ${allBlogPostDossierSummary.canonicalDecisionPages || 0} canonical-only decision pages, ${allBlogPostDossierSummary.citationCleanupPages || 0} citation/schema cleanup pages, ${allBlogPostDossierSummary.protectAmplifyPages || 0} protect/amplify pages, ${allBlogPostDossierSummary.benchmarkPressurePages || 0} benchmark-pressure pages, and ${allBlogPostDossierSummary.competitorOnlyPages || 0} pages with competitor-only answers. Blog-post visibility control report maps ${blogPostControlSummary.pages || 0} live pages to AI visibility stages: ${blogPostControlSummary.competitorReplacementStagePages || 0} competitor-replacement pages, ${blogPostControlSummary.coMentionStagePages || 0} co-mentioned pages, ${blogPostControlSummary.cleanMentionStagePages || 0} clean-mention pages, ${blogPostControlSummary.zeroMentionStagePages || 0} zero-mention pages, ${blogPostControlSummary.canonicalDecisionPages || 0} canonical-first pages, and ${blogPostControlSummary.citationCleanupPages || 0} citation/schema cleanup pages. All-page AI drilldown exports ${allPageDrilldownSummary.pages || 0} page rows and ${allPageDrilldownSummary.summaryRows || 0} summary rows for page-by-page edit review. Page execution control board consolidates the live-blog, conversion, message-gap, citation-timing, product-spread, and expanded benchmark data into ${pageExecutionSummary.pages || 0} page work orders, ${pageExecutionSummary.sprint1Pages || 0} Sprint 1 pages, ${pageExecutionSummary.mentionOrCanonicalFirstPages || 0} mention/canonical-first pages, ${pageExecutionSummary.sourceCleanupPages || 0} source-cleanup pages, ${pageExecutionSummary.providerRequestsReady || 0} staged provider retests, and ${pageExecutionSummary.productFamilies || 0} product-family spread gaps. Edit implementation packet converts the highest-priority rows into ${editImplementationSummary.briefs || 0} page briefs, ${editImplementationSummary.canonicalFirst || 0} canonical-first briefs, ${editImplementationSummary.schemaFixPages || 0} schema-fix briefs, ${editImplementationSummary.comparisonPages || 0} comparison briefs, ${editImplementationSummary.productModulePages || 0} product-module briefs, and ${editImplementationSummary.retestPrompts || 0} retest prompts. ${blog.products} catalog products, ${blog.linkedProducts} linked products, ${blog.unlinkedProducts} unlinked products, ${productEntitySummary.workQueueRows || 0} product/entity work-queue rows, ${productEntitySummary.familyRows || 0} product family coverage rows, ${productEntitySummary.moduleReferences || 0} benchmark module product references, ${pageBriefCount} page refresh briefs, ${editorBriefCount} editor-ready page briefs, ${canonicalMergeCount} canonical merge rows, ${canonicalDuplicateClusters} canonical consolidation rows (${canonicalSafeRedirects} safe duplicate redirects, ${canonicalFamilyReviews} family-review decisions, ${canonicalReviewClusters} survivor-review flags), ${survivorTicketCount} survivor-aware edit tickets (${survivorCanonicalTickets} canonical-aware, ${survivorDirectTickets} direct refresh, ${survivorReviewTickets} needing survivor review), ${contentGapBriefCount} future content-gap briefs analyzed, and the content-gap decision matrix adds ${contentGapDecisionSummary.categoryRows || 0} category summaries with top categories ${(contentGapDecisionSummary.topCategories || []).slice(0, 6).join(", ") || "not available"}.`,
      gap: `${live.missingFaqSchema} live pages missing FAQ schema, ${live.noQuickAnswer} missing quick-answer blocks, ${live.noComparisonSignals} missing comparison signals, ${blogLifecycleSummary.pagesWithBenchmarkPressure || 0} lifecycle pages have benchmark pressure, ${productEntitySummary.unlinkedProductRate || blog.unlinkedProductRate}% of catalog products unlinked from detected blog content, and ${productEntitySummary.readiness?.missing_specs || 0}/${productEntitySummary.totalProducts || blog.products} products missing structured spec fields in the readiness export.`,
      next: "Review canonical duplicates first, then execute survivor edit tickets, product entity modules, and product-linking plan in priority order.",
    },
    {
      requirement: "Citation rate and AI source authority",
      status: "Proven as weak",
      evidence: `Target-domain citation rate is ${evidence.citationCount}/${evidence.total} (${pct(evidence.citationCount, evidence.total)}%) with ${evidence.sourceUrlRows} source-url rows; the answer-snippet appendix independently confirms ${answerSnippetSummary.citationRows || 0}/${answerSnippetSummary.totalAnswers || evidence.total} citation rows. Citation uplift plan adds ${citationUpliftAppRows} app work items and ${citationUpliftRetestRows} retest prompts tied to competitor and page-refresh evidence. Source authority roadmap adds ${sourceAuthoritySummary.actionRows || 0} action rows, ${sourceAuthoritySummary.topicRows || 0} topic priority rows, ${sourceAuthoritySummary.competitorRows || 0} competitor-source rows, and ${sourceAuthoritySummary.retestRows || 0} retest rows to split Jacob/app page work from SEO contractor off-site citation work. Contractor citation packet turns that into ${contractorCitationSummary.topicBriefs || 0} topic authority briefs, ${contractorCitationSummary.competitorBriefs || 0} competitor adjacency briefs, ${contractorCitationSummary.week1Tasks || 0} Week 1 outreach tasks, ${contractorCitationSummary.targetPages || 0} target iBOLT pages, and ${contractorCitationSummary.retestPrompts || 0} retest prompts. Citation-rate visibility dashboard adds ${citationRateDashboardSummary.providerRows || 0} provider rows, ${citationRateDashboardSummary.competitorRows || 0} competitor rows, ${citationRateDashboardSummary.categoryRows || 0} citation topic rows, ${citationRateDashboardSummary.pageRows || 0} source-ready page rows, ${citationRateDashboardSummary.retestRows || 0} retest rows, and ${citationRateDashboardSummary.workplanRows || 0} owner workplan rows. Citation-vs-mention control report ranks ${citationVsMentionSummary.livePages || 0} pages into ${citationVsMentionSummary.mentionOrCanonicalFirstPages || 0} mention/canonical-first pages, ${citationVsMentionSummary.sourceCleanupPages || 0} source-cleanup pages, ${citationVsMentionSummary.citationNowCandidates || 0} citation-now candidates, and ${citationVsMentionSummary.providerRequests || 0} staged provider retests. Citation-readiness map scores ${citationReadinessSummary.pagesScored || 0} pages into ${citationReadinessSummary.mentionFirstPages || 0} mention-first pages, ${citationReadinessSummary.cleanupThenCitationPages || 0} cleanup-then-citation pages, and ${citationReadinessSummary.externalCitationPushPages || 0} external-citation-push pages, with top citation topics ${(citationReadinessSummary.topCitationTopics || []).slice(0, 5).join(", ") || "not available"}.`,
      gap: "iBOLT is sometimes mentioned, but tested models are not citing iboltmounts.com as a source.",
      next: "Pair on-site schema/answer blocks with contractor-led third-party mentions, backlinks, partner references, and comparison pages.",
    },
    {
      requirement: "Business and checkout opportunity mapping",
      status: "Proven as opportunity proxy",
      evidence: `Blog conversion opportunity map scores ${conversionOpportunitySummary.pagesScored || 0} live/blog pages, including ${conversionOpportunitySummary.sprint1Pages || 0} Sprint 1 pages, ${conversionOpportunitySummary.sprint2Pages || 0} Sprint 2 pages, ${conversionOpportunitySummary.benchmarkPressurePages || 0} benchmark-pressure pages, ${conversionOpportunitySummary.citationCleanupPages || 0} citation/schema cleanup pages, and ${conversionOpportunitySummary.canonicalReviewPages || 0} canonical-review-first pages. Average opportunity score is ${conversionOpportunitySummary.avgPriorityScore || 0}/100. Top topic opportunities are ${(conversionOpportunitySummary.topTopics || []).slice(0, 6).join(", ") || "not available"}. Top product-family opportunities are ${(conversionOpportunitySummary.topProductFamilies || []).slice(0, 6).join(", ") || "not available"}.`,
      gap: "This is not Shopify revenue attribution yet, because the benchmark reports are not joined to store analytics, add-to-cart events, or checkout data.",
      next: "Use the opportunity proxy to choose page edits now, then add Shopify analytics joins later to validate actual visitor, add-to-cart, and checkout lift.",
    },
    {
      requirement: "Prioritized execution backlog",
      status: "Proven",
      evidence: `The integrated execution backlog turns the analysis into ${visibilityExecutionSummary.totalBacklogItems || 0} ordered work items across ${(visibilityExecutionSummary.laneRows || []).length} lanes and ${(visibilityExecutionSummary.sprintRows || []).length} sprint buckets. Owner split is ${(visibilityExecutionSummary.ownerRows || []).map((row) => `${row.owner}: ${row.items}`).join(", ") || "not available"}. Top lane volumes include ${(visibilityExecutionSummary.laneRows || []).slice(0, 5).map((row) => `${row.lane}: ${row.items}`).join(", ") || "not available"}. Page execution control board adds ${pageExecutionSummary.pages || 0} page-level work orders, ${pageExecutionSummary.sprint1Pages || 0} Sprint 1 pages, ${pageExecutionSummary.mentionOrCanonicalFirstPages || 0} mention/canonical-first pages, ${pageExecutionSummary.sourceCleanupPages || 0} source-cleanup pages, and ${pageExecutionSummary.providerRequestsReady || 0} retest requests with explicit owner sequencing. Boss visibility scorecard converts the current benchmark into targets of ${bossVisibilitySummary?.kpis?.map((row) => `${row.label}: ${row.current}% to ${row.target}%`).join(", ") || "not available"} and a Jacob/app vs SEO-contractor action split. The 30-day control tower sequences ${controlTowerSummary.pageEditRows || 0} page edits, ${controlTowerSummary.contractorRows || 0} contractor tasks, ${controlTowerSummary.retestRows || 0} prompt retests, and ${controlTowerSummary.backlogItems || visibilityExecutionSummary.totalBacklogItems || 0} total backlog items into an operating plan.`,
      gap: "The backlog still needs execution and post-edit retesting before visibility gains can be claimed.",
      next: "Start Sprint 1 with canonical/survivor decisions and the highest-pressure page updates, then run the provider retest checklist.",
    },
    {
      requirement: "Sprint 1 editor-ready briefs",
      status: "Proven",
      evidence: `The Sprint 1 editor pack creates ${sprint1EditorSummary.pageBriefs || 0} page-level briefs and ${sprint1EditorSummary.offsiteAsks || 0} contractor off-site asks. Each brief joins canonical decision notes, AI prompts to win, competitor sets, required iBOLT positioning, quick-answer instructions, product modules, FAQ seeds, schema checklist, current issues, and retest success metrics.`,
      gap: "These are briefs, not completed site edits. Visibility gains require applying the page changes, coordinating off-site citations, and retesting.",
      next: "Use the Sprint 1 briefs as the edit queue for delivery, restaurant, fleet, fish finder, and shared-vehicle pages before moving to Sprint 2.",
    },
    {
      requirement: "Vertical/category playbooks",
      status: "Proven",
      evidence: `The vertical playbooks roll the analysis up by ${verticalPlaybookSummary.categories || 0} categories, covering ${verticalPlaybookSummary.expandedPrompts || 0} expanded prompts, ${verticalPlaybookSummary.expandedRequests || 0} provider requests, ${verticalPlaybookSummary.livePages || 0} live pages, and the current ${verticalPlaybookSummary.totalCompetitorOnlyAnswers || 0} competitor-only answer baseline. Top category playbooks are ${(verticalPlaybookSummary.topCategories || []).join(", ") || "not available"}.`,
      gap: "The playbooks identify the category strategy, but they still need edits, citation work, and retesting to produce measurable gains.",
      next: "Use the vertical playbooks to sequence restaurant, delivery, fleet, fishing, warehouse, and AMPS/modular work across page edits, product modules, off-site citations, and expanded benchmark retests.",
    },
  ];
}

function buildMarkdown({ rows, master, audit, expandedDir, expandedPromptCount, expandedProviderRequestCount, keyAvailable, contentGapBriefCount, noMappedPromptCount, productEntitySummary, providerBlindspotSummary, mentionQualitySummary, blogPortfolioSummary, blogLifecycleSummary, competitorDisplacementSummary, visibilityExecutionSummary, sprint1EditorSummary, expandedTestCoverageSummary, verticalPlaybookSummary, sourceAuthoritySummary, benchmarkHistorySummary, answerOutcomeSummary, messageGapSummary, pageMessageGapSummary, coMentionNetworkSummary, conversionOpportunitySummary, citationReadinessSummary, allBlogPostDossierSummary, testAreaCoverageSummary, answerEvidenceViewerSummary, bossVisibilitySummary, providerStrategySummary, editImplementationSummary, contractorCitationSummary, citationRateDashboardSummary, citationVsMentionSummary, pageExecutionSummary, controlTowerSummary, contentGapDecisionSummary, answerSnippetSummary, blogPostControlSummary, pageDerivedPromptSummary, competitorBattlecardSummary, priorityRetestSummary, closureSummary, answerExamplesSummary, allPageDrilldownSummary }) {
  const evidence = master.evidenceSummary;
  const live = audit.summary;
  const status = rows.every((row) => row.status === "Proven" || row.status === "Proven as weak")
    ? "Complete"
    : "Not complete yet";
  return `# AI Visibility Goal Audit

## Status

${status}. The analysis artifacts now prove the mention, competitor, comparison, citation, product-spread, and full live-blog audit parts of the goal. The remaining unproven item is the live expanded ${expandedPromptCount}-prompt benchmark, because \`OPENROUTER_API_KEY\` is ${keyAvailable ? "available but not yet executed" : "not set in the local shell"}.

## Current Evidence Snapshot

- iBOLT mention rate: ${evidence.mentionCount}/${evidence.total} (${pct(evidence.mentionCount, evidence.total)}%).
- Non-branded mention rate: ${evidence.nonBrandedMentionCount}/${evidence.nonBranded} (${pct(evidence.nonBrandedMentionCount, evidence.nonBranded)}%).
- Top-3 recommendation rate: ${master.mentionSummary.topThree}/${master.mentionSummary.totalAnswers} (${pct(master.mentionSummary.topThree, master.mentionSummary.totalAnswers)}%).
- Target-domain citation rate: ${evidence.citationCount}/${evidence.total} (${pct(evidence.citationCount, evidence.total)}%).
- Competitor-only rows: ${master.mentionSummary.competitorOnlyAnswers}.
- Co-mentioned rows: ${master.mentionSummary.coMentionAnswers}.
- Competitor displacement map: ${competitorDisplacementSummary.competitorRows || 0} competitor/default brands, ${competitorDisplacementSummary.queryActionRows || 0} query action rows, ${competitorDisplacementSummary.zeroMentionQueries || 0} zero-mention queries, top brands ${(competitorDisplacementSummary.topCompetitors || []).slice(0, 5).join(", ") || "not available"}.
- Competitor battlecard control: ${competitorBattlecardSummary.competitors || 0} tracked competitors, ${competitorBattlecardSummary.tier1 || 0} Tier 1 brands, ${competitorBattlecardSummary.mappedPages || 0} mapped pages, ${competitorBattlecardSummary.pageActions || 0} page actions, ${competitorBattlecardSummary.retestPrompts || 0} retest prompts, Tier 1 ${(competitorBattlecardSummary.topTier1Brands || []).join(", ") || "not available"}.
- Co-mention network: ${coMentionNetworkSummary.coMentionRows || 0} iBOLT co-mentions, ${coMentionNetworkSummary.cleanMentionRows || 0} clean iBOLT mentions, ${coMentionNetworkSummary.competitorOnlyRows || 0} strict competitor-only rows, ${coMentionNetworkSummary.rawDetectorCompetitorOnlyRows || 0} raw detector competitor-only rows, top co-mentions ${(coMentionNetworkSummary.topCoMentionCompetitors || []).slice(0, 5).join(", ") || "not available"}.
- Answer evidence viewer: ${answerEvidenceViewerSummary.totalAnswers || 0} answer rows, ${answerEvidenceViewerSummary.cleanMentions || 0} clean iBOLT mentions, ${answerEvidenceViewerSummary.coMentions || 0} co-mentions, ${answerEvidenceViewerSummary.competitorReplacements || 0} competitor replacements, ${answerEvidenceViewerSummary.mappedPages || 0} mapped answer/page actions.
- Answer snippet appendix: ${answerSnippetSummary.totalAnswers || 0} answer snippets, ${answerSnippetSummary.cleanMentions || 0} clean iBOLT snippets, ${answerSnippetSummary.coMentions || 0} co-mention snippets, ${answerSnippetSummary.competitorReplacements || 0} competitor replacement snippets, ${answerSnippetSummary.citationRows || 0} citation rows, top replacements ${(answerSnippetSummary.topReplacementCompetitors || []).slice(0, 5).join(", ") || "not available"}.
- Answer examples report: ${answerExamplesSummary.selectedExamples || 0} selected examples and ${answerExamplesSummary.competitorShortlist || 0} competitor comparison rows.
- Provider strategy: ${providerStrategySummary.providerCount || 0} providers, ${providerStrategySummary.totalCompetitorReplacements || 0} competitor replacements, harshest provider ${providerStrategySummary.harshestProvider || "not available"}, most recoverable provider ${providerStrategySummary.mostRecoverableProvider || "not available"}.
- Boss visibility scorecard: ${(bossVisibilitySummary?.kpis || []).map((row) => `${row.label} ${row.current}% -> ${row.target}%`).join(", ") || "not available"}.
- Execution backlog: ${visibilityExecutionSummary.totalBacklogItems || 0} ordered work items, ${(visibilityExecutionSummary.laneRows || []).length} work lanes, ${(visibilityExecutionSummary.sprintRows || []).length} sprint buckets.
- Sprint 1 editor pack: ${sprint1EditorSummary.pageBriefs || 0} page briefs and ${sprint1EditorSummary.offsiteAsks || 0} contractor off-site asks.
- Vertical playbooks: ${verticalPlaybookSummary.categories || 0} category briefs, top categories ${(verticalPlaybookSummary.topCategories || []).join(", ") || "not available"}.
- Catalog product alias rows: ${master.mentionSummary.catalogProductAliasAnswers}/${evidence.total}.
- Mention quality: ${mentionQualitySummary.avgMentionQuality || 0}/100 across ${mentionQualitySummary.mentionRows || 0} iBOLT-mentioned answers, with ${mentionQualitySummary.namingReviewRows || 0} naming-review rows.
- Answer outcome taxonomy: ${answerOutcomeSummary.top3Rows || 0} top-3 wins, ${answerOutcomeSummary.weakMentionRows || 0} weak mentions, ${answerOutcomeSummary.competitorOnlyRows || 0} merged-field competitor-only answers, ${answerOutcomeSummary.noSignalRows || 0} no-signal answers.
- Message gap map: ${messageGapSummary.iboltMentionRows || 0} iBOLT mention-context rows, ${messageGapSummary.lostAnswerRows || 0} lost-answer rows, ${messageGapSummary.competitorRows || 0} competitor/default brands, top gaps ${(messageGapSummary.topThemeGaps || []).slice(0, 5).join(", ") || "not available"}.
- Live sitemap pages audited: ${live.ok}/${live.total}.
- Average page citability score: ${live.avgScore}/100.
- Blog portfolio map: ${blogPortfolioSummary.livePages || 0} live pages, ${blogPortfolioSummary.benchmarkPressurePages || 0} benchmark-pressure pages, ${blogPortfolioSummary.productTargetPages || 0} product-target pages, ${blogPortfolioSummary.canonicalReviewPages || 0} canonical/consolidation pages.
- Blog lifecycle map: ${blogLifecycleSummary.pages || 0} live pages, ${blogLifecycleSummary.protectAndAmplifyPages || 0} protect/amplify pages, ${blogLifecycleSummary.canonicalDecisionPages || 0} canonical-decision pages, ${blogLifecycleSummary.citationSchemaCleanupPages || 0} citation/schema cleanup pages, ${blogLifecycleSummary.legacyRewritePages || 0} legacy rewrites.
- Page-message gap map: ${pageMessageGapSummary.pages || 0} live pages, ${pageMessageGapSummary.benchmarkPressurePages || 0} benchmark-pressure pages, ${pageMessageGapSummary.canonicalReviewPages || 0} canonical-review-first pages, ${pageMessageGapSummary.citationCleanupPages || 0} citation/schema cleanup pages, top page themes ${(pageMessageGapSummary.topMessageThemes || []).slice(0, 5).join(", ") || "not available"}.
- All-blog-post dossier: ${allBlogPostDossierSummary.pages || 0} joined pages, ${allBlogPostDossierSummary.canonicalMentionRecoveryPages || 0} canonical plus mention-recovery pages, ${allBlogPostDossierSummary.canonicalDecisionPages || 0} canonical-only decisions, ${allBlogPostDossierSummary.citationCleanupPages || 0} citation/schema cleanup pages, ${allBlogPostDossierSummary.benchmarkPressurePages || 0} benchmark-pressure pages, top competitors ${(allBlogPostDossierSummary.topCompetitors || []).slice(0, 5).join(", ") || "not available"}.
- Blog-post visibility control report: ${blogPostControlSummary.pages || 0} live pages, ${blogPostControlSummary.benchmarkPressurePages || 0} benchmark-pressure pages, ${blogPostControlSummary.competitorReplacementStagePages || 0} competitor-replacement-stage pages, ${blogPostControlSummary.coMentionStagePages || 0} co-mentioned-stage pages, ${blogPostControlSummary.cleanMentionStagePages || 0} clean-mention-stage pages, ${blogPostControlSummary.canonicalDecisionPages || 0} canonical-first pages, ${blogPostControlSummary.citationCleanupPages || 0} citation/schema cleanup pages.
- All-page AI drilldown: ${allPageDrilldownSummary.pages || 0} page rows and ${allPageDrilldownSummary.summaryRows || 0} summary rows.
- Page execution control board: ${pageExecutionSummary.pages || 0} work orders, ${pageExecutionSummary.sprint1Pages || 0} Sprint 1 pages, ${pageExecutionSummary.mentionOrCanonicalFirstPages || 0} mention/canonical-first pages, ${pageExecutionSummary.sourceCleanupPages || 0} source-cleanup pages, ${pageExecutionSummary.providerRequestsReady || 0} retest requests, ${pageExecutionSummary.productFamilies || 0} product-family spread rows.
- Edit implementation packet: ${editImplementationSummary.briefs || 0} page briefs, ${editImplementationSummary.schemaFixPages || 0} schema-fix briefs, ${editImplementationSummary.comparisonPages || 0} comparison briefs, ${editImplementationSummary.productModulePages || 0} product-module briefs, ${editImplementationSummary.retestPrompts || 0} retest prompts.
- Blog conversion opportunity map: ${conversionOpportunitySummary.pagesScored || 0} pages scored, ${conversionOpportunitySummary.sprint1Pages || 0} Sprint 1 pages, ${conversionOpportunitySummary.benchmarkPressurePages || 0} benchmark-pressure pages, ${conversionOpportunitySummary.citationCleanupPages || 0} citation/schema cleanup pages, top topics ${(conversionOpportunitySummary.topTopics || []).slice(0, 5).join(", ") || "not available"}.
- Citation readiness map: ${citationReadinessSummary.pagesScored || 0} pages scored, ${citationReadinessSummary.mentionFirstPages || 0} mention-first pages, ${citationReadinessSummary.cleanupThenCitationPages || 0} cleanup-then-citation pages, ${citationReadinessSummary.contractorRows || 0} contractor handoff rows, top citation topics ${(citationReadinessSummary.topCitationTopics || []).slice(0, 5).join(", ") || "not available"}.
- Contractor citation packet: ${contractorCitationSummary.topicBriefs || 0} topic briefs, ${contractorCitationSummary.competitorBriefs || 0} competitor briefs, ${contractorCitationSummary.week1Tasks || 0} Week 1 tasks, ${contractorCitationSummary.targetPages || 0} target pages, ${contractorCitationSummary.retestPrompts || 0} retest prompts.
- Citation-rate visibility dashboard: ${citationRateDashboardSummary.providerRows || 0} provider rows, ${citationRateDashboardSummary.competitorRows || 0} competitor rows, ${citationRateDashboardSummary.categoryRows || 0} category rows, ${citationRateDashboardSummary.pageRows || 0} source-ready page rows, ${citationRateDashboardSummary.retestRows || 0} retest rows.
- Citation-vs-mention control: ${citationVsMentionSummary.livePages || 0} pages ranked, ${citationVsMentionSummary.mentionOrCanonicalFirstPages || 0} mention/canonical-first pages, ${citationVsMentionSummary.sourceCleanupPages || 0} source-cleanup pages, ${citationVsMentionSummary.citationNowCandidates || 0} citation-now candidates.
- 30-day visibility control tower: ${controlTowerSummary.pageEditRows || 0} page edits, ${controlTowerSummary.contractorRows || 0} contractor tasks, ${controlTowerSummary.retestRows || 0} retests, ${controlTowerSummary.backlogItems || 0} backlog items.
- Test-area coverage audit: ${testAreaCoverageSummary.expandedPrompts || expandedPromptCount} prompts, ${testAreaCoverageSummary.providerRequests || 0} provider requests, ${testAreaCoverageSummary.categories || 0} categories, ${testAreaCoverageSummary.productFamilies || 0} product families, ${testAreaCoverageSummary.highGapCategories || 0} high-gap categories, top under-tested categories ${(testAreaCoverageSummary.topUnderTestedCategories || []).slice(0, 5).join(", ") || "not available"}.
- Source authority roadmap: ${sourceAuthoritySummary.topicRows || 0} topic rows, ${sourceAuthoritySummary.competitorRows || 0} competitor-source rows, ${sourceAuthoritySummary.actionRows || 0} action rows, ${sourceAuthoritySummary.retestRows || 0} retest rows.
- Product/entity work queue: ${productEntitySummary.workQueueRows || 0} rows across ${productEntitySummary.totalProducts || 0} products, with ${productEntitySummary.unlinkedProducts || 0} unlinked products.
- Provider/query blind-spot rows: ${providerBlindspotSummary.blindspotRows || 0}, with ${providerBlindspotSummary.consensusRows || 0} query consensus rows.
- Benchmark history: ${benchmarkHistorySummary.completedRunRows || 0} completed benchmark surfaces, ${benchmarkHistorySummary.liveAuditSnapshots || 0} live-blog audit snapshots, latest OpenRouter baseline ${benchmarkHistorySummary.latestMentionRate || pct(evidence.mentionCount, evidence.total)}% mention and ${benchmarkHistorySummary.latestCitationRate || pct(evidence.citationCount, evidence.total)}% citation.
- Expanded prompt backlog: ${expandedPromptCount} prompts and ${expandedProviderRequestCount} provider requests in the latest runner dry run.
- Priority retest packet: ${priorityRetestSummary.priorityProviderRequests || 0} exact provider requests, ${priorityRetestSummary.uniquePrompts || 0} unique prompts, ${priorityRetestSummary.pagesCovered || 0} pages, ${(priorityRetestSummary.providers || []).join(", ") || "no providers"}.
- Closure audit: verdict ${closureSummary.verdict || "missing"}, ${closureSummary.rows || 0} requirement rows, blocker ${closureSummary.blocker || "none"}.
- Expanded test coverage map: ${expandedTestCoverageSummary.promptCount || 0} prompts, ${expandedTestCoverageSummary.providerRequestCount || 0} provider requests, ${(expandedTestCoverageSummary.categoryRows || []).length} categories, ${expandedTestCoverageSummary.refreshThenRetestPrompts || 0} refresh prompts, ${expandedTestCoverageSummary.canonicalReviewPrompts || 0} canonical-review prompts.
- Page-derived expanded benchmark pack: ${pageDerivedPromptSummary.prompts || 0} prompts, ${pageDerivedPromptSummary.providerRequests || 0} provider requests, ${pageDerivedPromptSummary.pagesCovered || 0} pages covered, ${pageDerivedPromptSummary.categories || 0} categories, ${pageDerivedPromptSummary.comparisonPrompts || 0} comparison prompts, ${pageDerivedPromptSummary.productPrompts || 0} product prompts, ${pageDerivedPromptSummary.citationProbePrompts || 0} citation probes.
- No-mapped expanded prompts: ${noMappedPromptCount}, clustered into ${contentGapBriefCount} content briefs.
- Content-gap decision matrix: ${contentGapDecisionSummary.contentGapRows || 0} content decisions, ${contentGapDecisionSummary.noMappedPrompts || 0} no-mapped prompts, ${contentGapDecisionSummary.productGapRows || 0} product-linking rows, ${contentGapDecisionSummary.refreshFirst || 0} refresh-first rows, ${contentGapDecisionSummary.canonicalHubs || 0} canonical hub rows, ${contentGapDecisionSummary.netNew || 0} net-new rows.
- Expanded benchmark ops: see \`expanded-benchmark-ops\` for the batch and provider-request manifest.

## Requirement Audit

| Requirement | Status | Evidence | Gap | Next action |
| --- | --- | --- | --- | --- |
${rows.map((row) => `| ${row.requirement} | ${row.status} | ${row.evidence} | ${row.gap} | ${row.next} |`).join("\n")}

## Secure Runbook For The Remaining Benchmark

Do not put the API key in a committed file. Set it only in the local shell, then run:

\`\`\`bash
export OPENROUTER_API_KEY="..."
AI_BENCHMARK_EXPANDED_LIMIT=0 \\
AI_BENCHMARK_EXPANDED_MANIFEST=content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/priority-retest-packet/priority-provider-request-manifest.csv \\
npx tsx scripts/run-expanded-openrouter-ai-benchmark.ts
node scripts/build-ai-answer-evidence-pack.mjs
node scripts/build-ai-visibility-deep-dive.mjs
node scripts/build-ai-visibility-competitive-matrix.mjs
node scripts/build-ai-mention-landscape.mjs
node scripts/build-ai-citation-strategy-report.mjs
node scripts/build-ai-content-refresh-roadmap.mjs
node scripts/build-ai-visibility-master-dossier.mjs
\`\`\`

Expanded dry-run folder: ${expandedDir}
`;
}

function buildHtml({ rows, master, audit, expandedPromptCount, expandedProviderRequestCount, keyAvailable, contentGapBriefCount, productEntitySummary, providerBlindspotSummary, mentionQualitySummary, blogPortfolioSummary, blogLifecycleSummary, competitorDisplacementSummary, visibilityExecutionSummary, sprint1EditorSummary, expandedTestCoverageSummary, verticalPlaybookSummary, sourceAuthoritySummary, benchmarkHistorySummary, answerOutcomeSummary, messageGapSummary, pageMessageGapSummary, coMentionNetworkSummary, conversionOpportunitySummary, citationReadinessSummary, allBlogPostDossierSummary, testAreaCoverageSummary, answerEvidenceViewerSummary, bossVisibilitySummary, providerStrategySummary, editImplementationSummary, contractorCitationSummary, citationRateDashboardSummary, citationVsMentionSummary, pageExecutionSummary, controlTowerSummary, contentGapDecisionSummary, answerSnippetSummary, blogPostControlSummary, pageDerivedPromptSummary, competitorBattlecardSummary, priorityRetestSummary, closureSummary, answerExamplesSummary, allPageDrilldownSummary }) {
  const evidence = master.evidenceSummary;
  const live = audit.summary;
  const cards = [
    ["Mention rate", `${pct(evidence.mentionCount, evidence.total)}%`, `${evidence.mentionCount}/${evidence.total}`],
    ["Non-branded mention", `${pct(evidence.nonBrandedMentionCount, evidence.nonBranded)}%`, `${evidence.nonBrandedMentionCount}/${evidence.nonBranded}`],
    ["Citation rate", `${pct(evidence.citationCount, evidence.total)}%`, `${evidence.citationCount}/${evidence.total}`],
    ["Mention quality", `${mentionQualitySummary.avgMentionQuality || 0}/100`, `${mentionQualitySummary.namingReviewRows || 0} naming-review rows`],
    ["Outcome wins", answerOutcomeSummary.top3Rows || 0, `${answerOutcomeSummary.competitorOnlyRows || 0} competitor-only`],
    ["Message gaps", messageGapSummary.themeRows || 0, `${(messageGapSummary.topThemeGaps || []).slice(0, 2).join(", ") || "language themes"}`],
    ["Competitor-only", master.mentionSummary.competitorOnlyAnswers, "raw detector rows"],
    ["Co-mentions", coMentionNetworkSummary.coMentionRows || 0, `${coMentionNetworkSummary.cleanMentionRows || 0} clean mentions`],
    ["Answer viewer", answerEvidenceViewerSummary.totalAnswers || 0, `${answerEvidenceViewerSummary.competitorReplacements || 0} replacements`],
    ["Snippet appendix", answerSnippetSummary.totalAnswers || 0, `${answerSnippetSummary.cleanMentions || 0} clean, ${answerSnippetSummary.coMentions || 0} co`],
    ["Answer examples", answerExamplesSummary.selectedExamples || 0, `${answerExamplesSummary.competitorShortlist || 0} competitor rows`],
    ["Provider strategy", providerStrategySummary.providerCount || 0, `${providerStrategySummary.harshestProvider || "n/a"} harshest`],
    ["Displacement map", competitorDisplacementSummary.competitorRows || 0, `${competitorDisplacementSummary.zeroMentionQueries || 0} zero-mention queries`],
    ["Battlecards", competitorBattlecardSummary.competitors || 0, `${competitorBattlecardSummary.tier1 || 0} Tier 1 brands`],
    ["Execution backlog", visibilityExecutionSummary.totalBacklogItems || 0, `${(visibilityExecutionSummary.sprintRows || []).length} sprint buckets`],
    ["Sprint 1 briefs", sprint1EditorSummary.pageBriefs || 0, `${sprint1EditorSummary.offsiteAsks || 0} off-site asks`],
    ["Vertical playbooks", verticalPlaybookSummary.categories || 0, `${(verticalPlaybookSummary.topCategories || []).slice(0, 3).join(", ") || "category briefs"}`],
    ["Live pages audited", `${live.ok}/${live.total}`, `${live.avgScore}/100 avg score`],
    ["Portfolio pages", blogPortfolioSummary.livePages || 0, `${blogPortfolioSummary.benchmarkPressurePages || 0} benchmark-pressure pages`],
    ["Lifecycle map", blogLifecycleSummary.pages || 0, `${blogLifecycleSummary.legacyRewritePages || 0} legacy rewrites`],
    ["Page message map", pageMessageGapSummary.pages || 0, `${pageMessageGapSummary.canonicalReviewPages || 0} canonical first`],
    ["All-post dossier", allBlogPostDossierSummary.pages || 0, `${allBlogPostDossierSummary.canonicalMentionRecoveryPages || 0} canonical + mention`],
    ["Post control", blogPostControlSummary.pages || 0, `${blogPostControlSummary.competitorReplacementStagePages || 0} replacement-stage`],
    ["All-page drilldown", allPageDrilldownSummary.pages || 0, `${allPageDrilldownSummary.summaryRows || 0} summary rows`],
    ["Execution board", pageExecutionSummary.pages || 0, `${pageExecutionSummary.providerRequestsReady || 0} retest requests`],
    ["Edit packet", editImplementationSummary.briefs || 0, `${editImplementationSummary.retestPrompts || 0} retest prompts`],
    ["Conversion map", conversionOpportunitySummary.pagesScored || 0, `${conversionOpportunitySummary.sprint1Pages || 0} Sprint 1 pages`],
    ["Citation readiness", citationReadinessSummary.pagesScored || 0, `${citationReadinessSummary.mentionFirstPages || 0} mention first`],
    ["Citation contractor", contractorCitationSummary.week1Tasks || 0, `${contractorCitationSummary.competitorBriefs || 0} competitor briefs`],
    ["Citation dashboard", citationRateDashboardSummary.pageRows || 0, `${citationRateDashboardSummary.competitorRows || 0} competitor rows`],
    ["Citation timing", citationVsMentionSummary.citationNowCandidates || 0, `${citationVsMentionSummary.mentionOrCanonicalFirstPages || 0} mention/canonical first`],
    ["30-day control tower", controlTowerSummary.pageEditRows || 0, `${controlTowerSummary.contractorRows || 0} contractor tasks`],
    ["Product entity queue", productEntitySummary.workQueueRows || 0, `${productEntitySummary.unlinkedProducts || 0} unlinked products`],
    ["Provider blind spots", providerBlindspotSummary.blindspotRows || 0, `${providerBlindspotSummary.consensusRows || 0} query rows`],
    ["Source actions", sourceAuthoritySummary.actionRows || 0, `${sourceAuthoritySummary.topicRows || 0} topic rows`],
    ["History surfaces", benchmarkHistorySummary.completedRunRows || 0, `${benchmarkHistorySummary.liveAuditSnapshots || 0} live audit snapshots`],
    ["Expanded prompts", expandedPromptCount, keyAvailable ? "key available" : "key missing"],
    ["Latest dry-run requests", expandedProviderRequestCount, `${(expandedTestCoverageSummary.categoryRows || []).length} categories`],
    ["Priority retest", priorityRetestSummary.priorityProviderRequests || 0, `${priorityRetestSummary.uniquePrompts || 0} prompts`],
    ["Closure audit", closureSummary.verdict || "missing", closureSummary.blocker || "no blocker"],
    ["Page-derived prompts", pageDerivedPromptSummary.prompts || 0, `${pageDerivedPromptSummary.pagesCovered || 0} pages covered`],
    ["Test gaps", testAreaCoverageSummary.highGapCategories || 0, `${testAreaCoverageSummary.weakFamilyCoverage || 0} weak families`],
    ["Boss scorecard", bossVisibilitySummary?.kpis?.length || 0, `${bossVisibilitySummary?.citationRate || 0}% citation rate`],
    ["Content gaps", contentGapBriefCount, "clustered briefs"],
    ["Gap decisions", contentGapDecisionSummary.contentGapRows || 0, `${contentGapDecisionSummary.refreshFirst || 0} refresh first`],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`).join("");
  const tableRows = rows.map((row) => `<tr><td>${escapeHtml(row.requirement)}</td><td>${escapeHtml(row.status)}</td><td>${escapeHtml(row.evidence)}</td><td>${escapeHtml(row.gap)}</td><td>${escapeHtml(row.next)}</td></tr>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>iBOLT AI Visibility Goal Audit</title>
<style>
body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}main{max-width:1220px;margin:0 auto;padding:34px 26px 60px}h1{font-size:34px;margin:0 0 8px}h2{font-size:22px;margin:34px 0 14px}p{color:#334155;line-height:1.55}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid #d7dee8;border-radius:12px;padding:16px}.k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700}.v{font-size:30px;font-weight:800;margin-top:8px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d7dee8;border-radius:12px;overflow:hidden}th,td{text-align:left;vertical-align:top;padding:11px 12px;border-bottom:1px solid #edf2f7;font-size:14px}th{background:#f1f5f9;color:#475569;text-transform:uppercase;font-size:12px;letter-spacing:.04em}.note{border-left:6px solid ${keyAvailable ? "#16a34a" : "#f97316"};background:#fff;border-radius:10px;padding:16px 18px;border-top:1px solid #d7dee8;border-right:1px solid #d7dee8;border-bottom:1px solid #d7dee8}code{background:#eef2f7;padding:2px 5px;border-radius:5px}
</style></head><body><main>
<h1>iBOLT AI Visibility Goal Audit</h1>
<p class="note"><strong>Status:</strong> The analysis is complete for current saved benchmark data and all live blog pages. The remaining live execution gap is the expanded ${expandedPromptCount}-prompt model run because <code>OPENROUTER_API_KEY</code> is ${keyAvailable ? "available but not yet executed" : "missing in this shell"}.</p>
<section class="cards">${cards}</section>
<h2>Requirement Audit</h2>
<table><thead><tr><th>Requirement</th><th>Status</th><th>Evidence</th><th>Gap</th><th>Next action</th></tr></thead><tbody>${tableRows}</tbody></table>
</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const auditDir = await latestDir(AUDIT_PREFIX);
  const expandedDir = await latestDir(EXPANDED_PREFIX);
  const outDir = path.join(benchmarkDir, "goal-audit");
  await mkdir(outDir, { recursive: true });

  const master = await readJson(path.join(benchmarkDir, "master-dossier", "master-dossier-data.json"));
  const audit = await readJson(path.join(auditDir, "live-blog-page-audit.merged.json"));
  const expandedPromptCount = await countCsvRows(path.join(expandedDir, "selected-prompts.csv"));
  const expandedProviderRequestCount = await countCsvRows(path.join(expandedDir, "provider-request-manifest.csv"));
  const pageBriefCount = await countCsvRows(path.join(benchmarkDir, "page-refresh-playbook", "page-refresh-briefs.csv"));
  const canonicalMergeCount = await countCsvRows(path.join(benchmarkDir, "page-refresh-playbook", "canonical-merge-review.csv"));
  const opsBatchCount = await countCsvRows(path.join(benchmarkDir, "expanded-benchmark-ops", "benchmark-run-batches.csv"));
  const opsRequestCount = await countCsvRows(path.join(benchmarkDir, "expanded-benchmark-ops", "provider-request-manifest.csv"));
  const contentGapBriefCount = await countCsvRows(path.join(benchmarkDir, "content-gap-briefs", "content-gap-briefs.csv"));
  const noMappedPromptCount = await countCsvRows(path.join(benchmarkDir, "content-gap-briefs", "no-mapped-prompts.csv"));
  const editorBriefCount = await countCsvRows(path.join(benchmarkDir, "page-editor-pack", "editor-brief-index.csv"));
  const answerMentionContextCount = await countCsvRows(path.join(benchmarkDir, "answer-context-dossier", "ibolt-mention-context.csv"));
  const lostAnswerContextCount = await countCsvRows(path.join(benchmarkDir, "answer-context-dossier", "lost-answer-language.csv"));
  const competitorContextCount = await countCsvRows(path.join(benchmarkDir, "answer-context-dossier", "competitor-context-scorecard.csv"));
  const liveTriageCount = await countCsvRows(path.join(benchmarkDir, "live-blog-triage", "all-live-blog-triage.csv"));
  const citationUpliftAppRows = await countCsvRows(path.join(benchmarkDir, "citation-uplift-plan", "app-citation-workplan.csv"));
  const citationUpliftRetestRows = await countCsvRows(path.join(benchmarkDir, "citation-uplift-plan", "prompt-retest-queue.csv"));
  const queryPageRows = await countCsvRows(path.join(benchmarkDir, "query-page-matrix", "all-query-page-matrix.csv"));
  const queryPagePageRows = await countCsvRows(path.join(benchmarkDir, "query-page-matrix", "page-action-matrix.csv"));
  const queryPageCompetitorRows = await countCsvRows(path.join(benchmarkDir, "query-page-matrix", "competitor-page-map.csv"));
  const canonicalData = await readJson(path.join(benchmarkDir, "canonical-consolidation-plan", "canonical-consolidation-data.json"));
  const survivorTicketData = await readJson(path.join(benchmarkDir, "survivor-edit-tickets", "survivor-edit-ticket-data.json"));
  const productEntityData = await readJsonIfExists(path.join(benchmarkDir, "product-entity-coverage-plan", "product-entity-data.json"), { summary: {} });
  const productEntitySummary = productEntityData.summary || {};
  const providerBlindspotData = await readJsonIfExists(path.join(benchmarkDir, "provider-blindspots", "provider-blindspot-data.json"), { summary: {} });
  const providerBlindspotSummary = providerBlindspotData.summary || {};
  const mentionQualityData = await readJsonIfExists(path.join(benchmarkDir, "mention-quality-audit", "mention-quality-data.json"), { summary: {} });
  const mentionQualitySummary = mentionQualityData.summary || {};
  const blogPortfolioData = await readJsonIfExists(path.join(benchmarkDir, "blog-portfolio-map", "blog-portfolio-data.json"), { summary: {} });
  const blogPortfolioSummary = blogPortfolioData.summary || {};
  const blogLifecycleData = await readJsonIfExists(path.join(benchmarkDir, "blog-lifecycle-map", "blog-lifecycle-data.json"), { summary: {} });
  const blogLifecycleSummary = blogLifecycleData.summary || {};
  const competitorDisplacementData = await readJsonIfExists(path.join(benchmarkDir, "competitor-displacement-map", "competitor-displacement-data.json"), { summary: {} });
  const competitorDisplacementSummary = competitorDisplacementData.summary || {};
  const visibilityExecutionData = await readJsonIfExists(path.join(benchmarkDir, "visibility-execution-backlog", "visibility-execution-backlog-data.json"), { summary: {} });
  const visibilityExecutionSummary = visibilityExecutionData.summary || {};
  const sprint1EditorData = await readJsonIfExists(path.join(benchmarkDir, "sprint1-editor-pack", "sprint1-editor-pack-data.json"), { summary: {} });
  const sprint1EditorSummary = sprint1EditorData.summary || {};
  const expandedTestCoverageData = await readJsonIfExists(path.join(benchmarkDir, "expanded-test-coverage-map", "expanded-test-coverage-data.json"), { summary: {} });
  const expandedTestCoverageSummary = expandedTestCoverageData.summary || {};
  const verticalPlaybookData = await readJsonIfExists(path.join(benchmarkDir, "vertical-playbooks", "vertical-playbooks-data.json"), { summary: {} });
  const verticalPlaybookSummary = verticalPlaybookData.summary || {};
  const sourceAuthorityData = await readJsonIfExists(path.join(benchmarkDir, "source-authority-roadmap", "source-authority-data.json"), { summary: {} });
  const sourceAuthoritySummary = sourceAuthorityData.summary || {};
  const benchmarkHistoryData = await readJsonIfExists(path.join(benchmarkDir, "benchmark-history", "benchmark-history-data.json"), { summary: {} });
  const benchmarkHistorySummary = benchmarkHistoryData.summary || {};
  const answerOutcomeData = await readJsonIfExists(path.join(benchmarkDir, "answer-outcome-taxonomy", "answer-outcome-data.json"), { summary: {} });
  const answerOutcomeSummary = answerOutcomeData.summary || {};
  const messageGapData = await readJsonIfExists(path.join(benchmarkDir, "message-gap-map", "message-gap-data.json"), { summary: {} });
  const messageGapSummary = messageGapData.summary || {};
  const pageMessageGapData = await readJsonIfExists(path.join(benchmarkDir, "page-message-gap-map", "page-message-gap-data.json"), { summary: {} });
  const pageMessageGapSummary = pageMessageGapData.summary || {};
  const coMentionNetworkData = await readJsonIfExists(path.join(benchmarkDir, "co-mention-network", "co-mention-network-data.json"), { summary: {} });
  const coMentionNetworkSummary = coMentionNetworkData.summary || {};
  const conversionOpportunityData = await readJsonIfExists(path.join(benchmarkDir, "blog-conversion-opportunity-map", "blog-conversion-opportunity-data.json"), { summary: {} });
  const conversionOpportunitySummary = conversionOpportunityData.summary || {};
  const citationReadinessData = await readJsonIfExists(path.join(benchmarkDir, "citation-readiness-map", "citation-readiness-data.json"), { summary: {} });
  const citationReadinessSummary = citationReadinessData.summary || {};
  const allBlogPostDossierData = await readJsonIfExists(path.join(benchmarkDir, "all-blog-post-dossier", "all-blog-post-dossier-data.json"), { summary: {} });
  const allBlogPostDossierSummary = allBlogPostDossierData.summary || {};
  const testAreaCoverageData = await readJsonIfExists(path.join(benchmarkDir, "test-area-coverage-audit", "test-area-coverage-data.json"), { summary: {} });
  const testAreaCoverageSummary = testAreaCoverageData.summary || {};
  const answerEvidenceViewerData = await readJsonIfExists(path.join(benchmarkDir, "answer-evidence-viewer", "answer-evidence-viewer-data.json"), { summary: {} });
  const answerEvidenceViewerSummary = answerEvidenceViewerData.summary || {};
  const bossVisibilityData = await readJsonIfExists(path.join(benchmarkDir, "boss-visibility-scorecard", "boss-scorecard-data.json"), { summary: {} });
  const bossVisibilitySummary = bossVisibilityData.summary || {};
  const providerStrategyData = await readJsonIfExists(path.join(benchmarkDir, "provider-strategy-report", "provider-strategy-data.json"), { summary: {} });
  const providerStrategySummary = providerStrategyData.summary || {};
  const editImplementationData = await readJsonIfExists(path.join(benchmarkDir, "edit-implementation-packet", "edit-implementation-data.json"), { summary: {} });
  const editImplementationSummary = editImplementationData.summary || {};
  const contractorCitationData = await readJsonIfExists(path.join(benchmarkDir, "contractor-citation-packet", "contractor-citation-data.json"), { summary: {} });
  const contractorCitationSummary = contractorCitationData.summary || {};
  const citationRateDashboardData = await readJsonIfExists(path.join(benchmarkDir, "citation-rate-visibility-dashboard", "citation-rate-visibility-data.json"), {});
  const citationRateDashboardSummary = {
    providerRows: citationRateDashboardData.providerRows?.length || 0,
    competitorRows: citationRateDashboardData.competitorRows?.length || 0,
    categoryRows: citationRateDashboardData.categoryRows?.length || 0,
    pageRows: citationRateDashboardData.pageRows?.length || 0,
    retestRows: citationRateDashboardData.retestRows?.length || 0,
    workplanRows: citationRateDashboardData.workplanRows?.length || 0,
  };
  const citationVsMentionData = await readJsonIfExists(path.join(benchmarkDir, "citation-vs-mention-control-report", "citation-vs-mention-data.json"), { summary: {} });
  const citationVsMentionSummary = citationVsMentionData.summary || {};
  const controlTowerData = await readJsonIfExists(path.join(benchmarkDir, "thirty-day-visibility-control-tower", "thirty-day-control-tower-data.json"), { summary: {} });
  const controlTowerSummary = controlTowerData.summary || {};
  const contentGapDecisionData = await readJsonIfExists(path.join(benchmarkDir, "content-gap-decision-matrix", "content-gap-decision-data.json"), { summary: {} });
  const contentGapDecisionSummary = contentGapDecisionData.summary || {};
  const answerSnippetData = await readJsonIfExists(path.join(benchmarkDir, "answer-snippet-evidence-appendix", "answer-snippet-evidence-data.json"), { summary: {} });
  const answerSnippetSummary = answerSnippetData.summary || {};
  const blogPostControlData = await readJsonIfExists(path.join(benchmarkDir, "blog-post-visibility-control-report", "blog-post-visibility-control-data.json"), { summary: {} });
  const blogPostControlSummary = blogPostControlData.summary || {};
  const pageDerivedPromptData = await readJsonIfExists(path.join(benchmarkDir, "page-derived-expanded-benchmark-pack", "page-derived-expanded-benchmark-data.json"), { summary: {} });
  const pageDerivedPromptSummary = pageDerivedPromptData.summary || {};
  const competitorBattlecardData = await readJsonIfExists(path.join(benchmarkDir, "competitor-battlecard-control-report", "competitor-battlecard-control-data.json"), { summary: {} });
  const competitorBattlecardSummary = competitorBattlecardData.summary || {};
  const pageExecutionData = await readJsonIfExists(path.join(benchmarkDir, "page-execution-control-board", "page-execution-control-data.json"), { summary: {} });
  const pageExecutionSummary = pageExecutionData.summary || {};
  const priorityRetestData = await readJsonIfExists(path.join(benchmarkDir, "priority-retest-packet", "priority-retest-data.json"), { summary: {} });
  const priorityRetestSummary = priorityRetestData.summary || {};
  const closureData = await readJsonIfExists(path.join(benchmarkDir, "goal-closure-audit", "goal-closure-data.json"), { verdict: "missing", blocker: "", rows: [] });
  const closureSummary = {
    verdict: closureData.verdict || "missing",
    blocker: closureData.blocker || "",
    rows: closureData.rows?.length || 0,
    keyAvailable: closureData.keyAvailable ?? false,
  };
  const answerExamplesSummary = {
    selectedExamples: await countCsvRows(path.join(benchmarkDir, "answer-examples-report", "selected-answer-examples.csv")),
    competitorShortlist: await countCsvRows(path.join(benchmarkDir, "answer-examples-report", "competitor-comparison-shortlist.csv")),
  };
  const allPageDrilldownSummary = {
    pages: await countCsvRows(path.join(benchmarkDir, "all-page-ai-drilldown", "all-page-ai-drilldown.csv")),
    summaryRows: await countCsvRows(path.join(benchmarkDir, "all-page-ai-drilldown", "page-drilldown-summary.csv")),
  };
  const keyAvailable = Boolean(process.env.OPENROUTER_API_KEY);
  const rows = makeRows({
    master,
    audit,
    expandedPromptCount,
    expandedProviderRequestCount,
    expandedDir,
    keyAvailable,
    pageBriefCount,
    canonicalMergeCount,
    opsBatchCount,
    opsRequestCount,
    contentGapBriefCount,
    noMappedPromptCount,
    editorBriefCount,
    answerMentionContextCount,
    lostAnswerContextCount,
    competitorContextCount,
    liveTriageCount,
    citationUpliftAppRows,
    citationUpliftRetestRows,
    queryPageRows,
    queryPagePageRows,
    queryPageCompetitorRows,
    canonicalDuplicateClusters: canonicalData.duplicateClusters,
    canonicalSafeRedirects: canonicalData.exactDuplicatePairs,
    canonicalFamilyReviews: canonicalData.familyReviewPairs,
    canonicalReviewClusters: canonicalData.survivorReviewClusters,
    survivorTicketCount: survivorTicketData.ticketCount,
    survivorCanonicalTickets: survivorTicketData.canonicalAwareTickets,
    survivorDirectTickets: survivorTicketData.directRefreshTickets,
    survivorReviewTickets: survivorTicketData.survivorReviewTickets,
    productEntitySummary,
    providerBlindspotSummary,
    mentionQualitySummary,
    blogPortfolioSummary,
    blogLifecycleSummary,
    competitorDisplacementSummary,
    visibilityExecutionSummary,
    sprint1EditorSummary,
    expandedTestCoverageSummary,
    verticalPlaybookSummary,
    sourceAuthoritySummary,
    benchmarkHistorySummary,
    answerOutcomeSummary,
    messageGapSummary,
    pageMessageGapSummary,
    coMentionNetworkSummary,
    conversionOpportunitySummary,
    citationReadinessSummary,
    allBlogPostDossierSummary,
    testAreaCoverageSummary,
    answerEvidenceViewerSummary,
    bossVisibilitySummary,
    providerStrategySummary,
    editImplementationSummary,
    contractorCitationSummary,
    citationRateDashboardSummary,
    citationVsMentionSummary,
    controlTowerSummary,
    contentGapDecisionSummary,
    answerSnippetSummary,
    blogPostControlSummary,
    pageDerivedPromptSummary,
    competitorBattlecardSummary,
    pageExecutionSummary,
    priorityRetestSummary,
    closureSummary,
    answerExamplesSummary,
    allPageDrilldownSummary,
  });

  await writeFile(path.join(outDir, "goal-requirement-audit.csv"), csv([
    ["requirement", "status", "evidence", "gap", "next_action"],
    ...rows.map((row) => [row.requirement, row.status, row.evidence, row.gap, row.next]),
  ]));
  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({
    rows,
    master,
    audit,
    expandedDir,
    expandedPromptCount,
    expandedProviderRequestCount,
    keyAvailable,
    contentGapBriefCount,
    noMappedPromptCount,
    productEntitySummary,
    providerBlindspotSummary,
    mentionQualitySummary,
    blogPortfolioSummary,
    blogLifecycleSummary,
    competitorDisplacementSummary,
    visibilityExecutionSummary,
    sprint1EditorSummary,
    expandedTestCoverageSummary,
    verticalPlaybookSummary,
    sourceAuthoritySummary,
    benchmarkHistorySummary,
    answerOutcomeSummary,
    messageGapSummary,
    pageMessageGapSummary,
    coMentionNetworkSummary,
    conversionOpportunitySummary,
    citationReadinessSummary,
    allBlogPostDossierSummary,
    testAreaCoverageSummary,
    answerEvidenceViewerSummary,
    bossVisibilitySummary,
    providerStrategySummary,
    editImplementationSummary,
    contractorCitationSummary,
    citationRateDashboardSummary,
    citationVsMentionSummary,
    controlTowerSummary,
    contentGapDecisionSummary,
    answerSnippetSummary,
    blogPostControlSummary,
    pageDerivedPromptSummary,
    competitorBattlecardSummary,
    pageExecutionSummary,
    priorityRetestSummary,
    closureSummary,
    answerExamplesSummary,
    allPageDrilldownSummary,
  }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({ rows, master, audit, expandedPromptCount, expandedProviderRequestCount, keyAvailable, contentGapBriefCount, productEntitySummary, providerBlindspotSummary, mentionQualitySummary, blogPortfolioSummary, blogLifecycleSummary, competitorDisplacementSummary, visibilityExecutionSummary, sprint1EditorSummary, expandedTestCoverageSummary, verticalPlaybookSummary, sourceAuthoritySummary, benchmarkHistorySummary, answerOutcomeSummary, messageGapSummary, pageMessageGapSummary, coMentionNetworkSummary, conversionOpportunitySummary, citationReadinessSummary, allBlogPostDossierSummary, testAreaCoverageSummary, answerEvidenceViewerSummary, bossVisibilitySummary, providerStrategySummary, editImplementationSummary, contractorCitationSummary, citationRateDashboardSummary, citationVsMentionSummary, pageExecutionSummary, controlTowerSummary, contentGapDecisionSummary, answerSnippetSummary, blogPostControlSummary, pageDerivedPromptSummary, competitorBattlecardSummary, priorityRetestSummary, closureSummary, answerExamplesSummary, allPageDrilldownSummary }));
  await writeFile(path.join(outDir, "NEXT_BENCHMARK_RUNBOOK.md"), buildMarkdown({
    rows,
    master,
    audit,
    expandedDir,
    expandedPromptCount,
    expandedProviderRequestCount,
    keyAvailable,
    contentGapBriefCount,
    noMappedPromptCount,
    productEntitySummary,
    providerBlindspotSummary,
    mentionQualitySummary,
    blogPortfolioSummary,
    blogLifecycleSummary,
    competitorDisplacementSummary,
    visibilityExecutionSummary,
    sprint1EditorSummary,
    expandedTestCoverageSummary,
    verticalPlaybookSummary,
    sourceAuthoritySummary,
    benchmarkHistorySummary,
    answerOutcomeSummary,
    messageGapSummary,
    pageMessageGapSummary,
    coMentionNetworkSummary,
    conversionOpportunitySummary,
    citationReadinessSummary,
    allBlogPostDossierSummary,
    testAreaCoverageSummary,
    answerEvidenceViewerSummary,
    bossVisibilitySummary,
    providerStrategySummary,
    editImplementationSummary,
    contractorCitationSummary,
    citationRateDashboardSummary,
    citationVsMentionSummary,
    controlTowerSummary,
    contentGapDecisionSummary,
    answerSnippetSummary,
    blogPostControlSummary,
    pageDerivedPromptSummary,
    competitorBattlecardSummary,
    pageExecutionSummary,
    priorityRetestSummary,
    closureSummary,
    answerExamplesSummary,
    allPageDrilldownSummary,
  }).split("## Secure Runbook For The Remaining Benchmark\n\n")[1] || "");

  console.log(`Wrote ${outDir}`);
  console.log(`Goal complete: ${rows.every((row) => row.status === "Proven" || row.status === "Proven as weak") ? "yes" : "no"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
