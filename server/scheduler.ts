// Autonomous Scheduler — Cron-style background tasks for the blog engine
// Runs research, product sync, keyword refresh, and auto-generation on intervals.

import { db } from "./db";
import { eq, and, isNull } from "drizzle-orm";
import {
  companySettings,
  industryVerticals,
  keywordClusters,
  keywords,
  products,
  blogPosts,
  contextEntries,
  aiBenchmarkQueries,
  aiBenchmarkRuns,
} from "@shared/schema";
import { ResearchOrchestrator } from "./iboltResearchAgent";
import { scrapeProducts, mapProductsToVerticals } from "./productScraper";
import { runBlogPipeline } from "./blogPipeline";
import { renderShopifyHtml } from "./htmlRenderer";
import { batchAnalyzePhotos } from "./photoBank";
import { rebuildContextChunks } from "./contextChunker";
import { BENCHMARK_PROVIDERS, runAiBenchmark, type BenchmarkProvider } from "./aiBenchmark";
import { DEFAULT_COMPANY_ID } from "./companyDefaults";
import { getCompanyContext } from "./companyContext";
import {
  beginSchedulerJob,
  clearExpiredSchedulerLocks,
  completeSchedulerJob,
  releaseSchedulerJobLock,
  renewSchedulerJobLease,
  SCHEDULER_LOCK_TTL_MS,
  type SchedulerJobType,
  type SchedulerTriggerType,
} from "./schedulerJobStore";

// --- Types ---

export interface SchedulerConfig {
  researchIntervalMs: number;       // How often to run research agents (default: 24h)
  productSyncIntervalMs: number;    // How often to sync products (default: 12h)
  autoGenerateIntervalMs: number;   // How often to check for pending clusters (default: 1h)
  photoAnalysisIntervalMs: number;  // How often to analyze unanalyzed photos (default: 6h)
  chunkRebuildIntervalMs: number;   // How often to rebuild context chunks (default: 12h)
  benchmarkIntervalMs: number;      // How often to run AI benchmark tracking (default: 7d)
  enabled: boolean;
  autoGenerate: boolean;            // Auto-generate posts for pending clusters
  autoBenchmark: boolean;           // Auto-run AI benchmark on schedule
  maxAutoPostsPerRun: number;       // Max posts to auto-generate per interval
  maxVerticalsPerResearchRun: number; // Max thin/stale verticals to research per run
  researchSources: Array<"reddit" | "youtube" | "web">;
  researchConcurrency: number;
  benchmarkProviders: BenchmarkProvider[];
}

export interface SchedulerStatus {
  running: boolean;
  companyId: string;
  config: SchedulerConfig;
  lastResearch: Date | null;
  lastProductSync: Date | null;
  lastAutoGenerate: Date | null;
  lastBenchmark: Date | null;
  nextResearch: Date | null;
  nextProductSync: Date | null;
  nextAutoGenerate: Date | null;
  nextBenchmark: Date | null;
  stats: {
    totalPosts: number;
    pendingClusters: number;
    contextEntries: number;
    products: number;
    benchmarkQueries: number;
    benchmarkRuns: number;
  };
}

// --- Default Config ---

const DEFAULT_CONFIG: SchedulerConfig = {
  researchIntervalMs: 6 * 60 * 60 * 1000,      // 6 hours
  productSyncIntervalMs: 12 * 60 * 60 * 1000,  // 12 hours
  autoGenerateIntervalMs: 60 * 60 * 1000,       // 1 hour
  photoAnalysisIntervalMs: 6 * 60 * 60 * 1000,  // 6 hours
  chunkRebuildIntervalMs: 12 * 60 * 60 * 1000,  // 12 hours
  benchmarkIntervalMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  enabled: false, // Must be explicitly enabled
  autoGenerate: false,
  autoBenchmark: false,
  maxAutoPostsPerRun: 3,
  maxVerticalsPerResearchRun: 4,
  researchSources: ["reddit", "youtube", "web"],
  researchConcurrency: 3,
  benchmarkProviders: [...BENCHMARK_PROVIDERS],
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function numberFrom(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function booleanFrom(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function researchSourcesFrom(value: unknown, fallback: SchedulerConfig["researchSources"]): SchedulerConfig["researchSources"] {
  const allowed = new Set(["reddit", "youtube", "web"]);
  const values = Array.isArray(value) ? value.filter((item): item is "reddit" | "youtube" | "web" => allowed.has(String(item))) : [];
  return values.length > 0 ? values : fallback;
}

function benchmarkProvidersFrom(value: unknown, fallback: BenchmarkProvider[]): BenchmarkProvider[] {
  const allowed = new Set<string>(BENCHMARK_PROVIDERS);
  const values = Array.isArray(value) ? value.filter((item): item is BenchmarkProvider => allowed.has(String(item))) : [];
  return values.length > 0 ? values : fallback;
}

export function normalizeSchedulerConfig(input: unknown, base: SchedulerConfig = DEFAULT_CONFIG): SchedulerConfig {
  const value = asRecord(input);
  return {
    researchIntervalMs: numberFrom(value.researchIntervalMs, base.researchIntervalMs, 15 * 60 * 1000, 30 * 24 * 60 * 60 * 1000),
    productSyncIntervalMs: numberFrom(value.productSyncIntervalMs, base.productSyncIntervalMs, 15 * 60 * 1000, 30 * 24 * 60 * 60 * 1000),
    autoGenerateIntervalMs: numberFrom(value.autoGenerateIntervalMs, base.autoGenerateIntervalMs, 15 * 60 * 1000, 7 * 24 * 60 * 60 * 1000),
    photoAnalysisIntervalMs: numberFrom(value.photoAnalysisIntervalMs, base.photoAnalysisIntervalMs, 15 * 60 * 1000, 30 * 24 * 60 * 60 * 1000),
    chunkRebuildIntervalMs: numberFrom(value.chunkRebuildIntervalMs, base.chunkRebuildIntervalMs, 15 * 60 * 1000, 30 * 24 * 60 * 60 * 1000),
    benchmarkIntervalMs: numberFrom(value.benchmarkIntervalMs, base.benchmarkIntervalMs, 60 * 60 * 1000, 90 * 24 * 60 * 60 * 1000),
    enabled: booleanFrom(value.enabled, base.enabled),
    autoGenerate: booleanFrom(value.autoGenerate, base.autoGenerate),
    autoBenchmark: booleanFrom(value.autoBenchmark, base.autoBenchmark),
    maxAutoPostsPerRun: numberFrom(value.maxAutoPostsPerRun, base.maxAutoPostsPerRun, 1, 20),
    maxVerticalsPerResearchRun: numberFrom(value.maxVerticalsPerResearchRun, base.maxVerticalsPerResearchRun, 1, 25),
    researchSources: researchSourcesFrom(value.researchSources, base.researchSources),
    researchConcurrency: numberFrom(value.researchConcurrency, base.researchConcurrency, 1, 10),
    benchmarkProviders: benchmarkProvidersFrom(value.benchmarkProviders, base.benchmarkProviders),
  };
}

async function getCompanySettings(companyId: string): Promise<Record<string, unknown>> {
  const [row] = await db
    .select()
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);
  return asRecord(row?.settings);
}

export async function loadSchedulerConfig(companyId: string): Promise<SchedulerConfig> {
  const settings = await getCompanySettings(companyId);
  return normalizeSchedulerConfig(settings.scheduler, DEFAULT_CONFIG);
}

export async function persistSchedulerConfig(companyId: string, config: SchedulerConfig): Promise<void> {
  const existingSettings = await getCompanySettings(companyId);
  const nextSettings = {
    ...existingSettings,
    scheduler: normalizeSchedulerConfig(config),
  };

  const [existing] = await db
    .select({ id: companySettings.id })
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);

  if (existing) {
    await db
      .update(companySettings)
      .set({ settings: nextSettings, updatedAt: new Date() })
      .where(eq(companySettings.companyId, companyId));
  } else {
    await db.insert(companySettings).values({
      companyId,
      settings: nextSettings,
      updatedAt: new Date(),
    });
  }
}

async function selectResearchVerticalIds(companyId: string, limit: number): Promise<string[]> {
  const verticals = await db
    .select()
    .from(industryVerticals)
    .where(eq(industryVerticals.companyId, companyId));
  if (verticals.length === 0) return [];

  const entries = await db
    .select({
      verticalId: contextEntries.verticalId,
      sourceType: contextEntries.sourceType,
    })
    .from(contextEntries)
    .where(eq(contextEntries.companyId, companyId));

  const stats = new Map<string, { total: number; nonSeed: number }>();
  for (const entry of entries) {
    const current = stats.get(entry.verticalId) || { total: 0, nonSeed: 0 };
    current.total += 1;
    if (entry.sourceType !== "seed") current.nonSeed += 1;
    stats.set(entry.verticalId, current);
  }

  return verticals
    .map((vertical) => {
      const counts = stats.get(vertical.id) || { total: 0, nonSeed: 0 };
      return {
        id: vertical.id,
        totalEntries: counts.total,
        nonSeedEntries: counts.nonSeed,
        lastResearchedAt: vertical.lastResearchedAt ? new Date(vertical.lastResearchedAt).getTime() : 0,
      };
    })
    .sort((a, b) => {
      const aThin = a.nonSeedEntries === 0 ? 0 : 1;
      const bThin = b.nonSeedEntries === 0 ? 0 : 1;
      if (aThin !== bThin) return aThin - bThin;
      if (a.lastResearchedAt !== b.lastResearchedAt) return a.lastResearchedAt - b.lastResearchedAt;
      return a.totalEntries - b.totalEntries;
    })
    .slice(0, Math.max(1, limit))
    .map((vertical) => vertical.id);
}

// --- Scheduler Class ---

export class BlogScheduler {
  private config: SchedulerConfig;
  private researchTimer: ReturnType<typeof setInterval> | null = null;
  private productTimer: ReturnType<typeof setInterval> | null = null;
  private generateTimer: ReturnType<typeof setInterval> | null = null;
  private photoTimer: ReturnType<typeof setInterval> | null = null;
  private chunkTimer: ReturnType<typeof setInterval> | null = null;
  private benchmarkTimer: ReturnType<typeof setInterval> | null = null;
  private lastResearch: Date | null = null;
  private lastProductSync: Date | null = null;
  private lastAutoGenerate: Date | null = null;
  private lastPhotoAnalysis: Date | null = null;
  private lastChunkRebuild: Date | null = null;
  private lastBenchmark: Date | null = null;
  private isResearching = false;
  private isSyncing = false;
  private isGenerating = false;
  private isAnalyzingPhotos = false;
  private isRebuildingChunks = false;
  private isBenchmarking = false;
  private scheduledCompanyId = DEFAULT_COMPANY_ID;
  private log: (msg: string) => void;

  constructor(config?: Partial<SchedulerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.log = (msg: string) => console.log(`[Scheduler] ${msg}`);
  }

  // --- Control ---

  start(companyId = this.scheduledCompanyId): void {
    if (this.researchTimer) return; // Already running
    this.scheduledCompanyId = companyId;
    this.config.enabled = true;
    this.log(`Starting autonomous scheduler for company ${this.scheduledCompanyId}`);

    this.researchTimer = setInterval(() => this.runResearch(this.scheduledCompanyId), this.config.researchIntervalMs);
    this.productTimer = setInterval(() => this.runProductSync(this.scheduledCompanyId), this.config.productSyncIntervalMs);

    if (this.config.autoGenerate) {
      this.generateTimer = setInterval(() => this.runAutoGenerate(this.scheduledCompanyId), this.config.autoGenerateIntervalMs);
    }

    this.photoTimer = setInterval(() => this.runPhotoAnalysis(this.scheduledCompanyId), this.config.photoAnalysisIntervalMs);
    this.chunkTimer = setInterval(() => this.runChunkRebuild(this.scheduledCompanyId), this.config.chunkRebuildIntervalMs);
    if (this.config.autoBenchmark) {
      this.benchmarkTimer = setInterval(() => this.runBenchmark(this.scheduledCompanyId), this.config.benchmarkIntervalMs);
    }

    this.log(`Research every ${Math.round(this.config.researchIntervalMs / 3600000)}h, Product sync every ${Math.round(this.config.productSyncIntervalMs / 3600000)}h`);
    this.log(`Photo analysis every ${Math.round(this.config.photoAnalysisIntervalMs / 3600000)}h, Chunk rebuild every ${Math.round(this.config.chunkRebuildIntervalMs / 3600000)}h`);
    if (this.config.autoGenerate) {
      this.log(`Auto-generate every ${Math.round(this.config.autoGenerateIntervalMs / 60000)}min (max ${this.config.maxAutoPostsPerRun} posts/run)`);
    }
    if (this.config.autoBenchmark) {
      this.log(`AI benchmark every ${Math.round(this.config.benchmarkIntervalMs / 3600000)}h across ${this.config.benchmarkProviders.join(", ")}`);
    }
  }

  stop(): void {
    this.config.enabled = false;
    if (this.researchTimer) { clearInterval(this.researchTimer); this.researchTimer = null; }
    if (this.productTimer) { clearInterval(this.productTimer); this.productTimer = null; }
    if (this.generateTimer) { clearInterval(this.generateTimer); this.generateTimer = null; }
    if (this.photoTimer) { clearInterval(this.photoTimer); this.photoTimer = null; }
    if (this.chunkTimer) { clearInterval(this.chunkTimer); this.chunkTimer = null; }
    if (this.benchmarkTimer) { clearInterval(this.benchmarkTimer); this.benchmarkTimer = null; }
    this.log("Scheduler stopped");
  }

  getConfig(): SchedulerConfig {
    return { ...this.config };
  }

  replaceConfig(config: SchedulerConfig, companyId = this.scheduledCompanyId): void {
    const shouldRun = config.enabled;
    if (this.config.enabled || this.researchTimer) this.stop();
    this.scheduledCompanyId = companyId;
    this.config = normalizeSchedulerConfig(config);
    if (shouldRun) this.start(companyId);
  }

  updateConfig(updates: Partial<SchedulerConfig>, companyId = this.scheduledCompanyId): SchedulerConfig {
    const wasRunning = this.config.enabled;
    if (wasRunning) this.stop();
    this.scheduledCompanyId = companyId;
    this.config = normalizeSchedulerConfig({ ...this.config, ...updates }, this.config);
    if (wasRunning || updates.enabled) this.start(companyId);
    return this.getConfig();
  }

  async getStatus(companyId = DEFAULT_COMPANY_ID): Promise<SchedulerStatus> {
    const allPosts = await db.select().from(blogPosts).where(eq(blogPosts.companyId, companyId));
    const pending = await db.select().from(keywordClusters).where(and(eq(keywordClusters.companyId, companyId), eq(keywordClusters.status, "pending")));
    const entries = await db.select().from(contextEntries).where(eq(contextEntries.companyId, companyId));
    const prods = await db.select().from(products).where(eq(products.companyId, companyId));
    const benchmarkQueryRows = await db.select().from(aiBenchmarkQueries).where(eq(aiBenchmarkQueries.companyId, companyId));
    const benchmarkRunRows = await db.select().from(aiBenchmarkRuns).where(eq(aiBenchmarkRuns.companyId, companyId));

    const now = Date.now();

    return {
      running: this.config.enabled,
      companyId: this.scheduledCompanyId,
      config: this.config,
      lastResearch: this.lastResearch,
      lastProductSync: this.lastProductSync,
      lastAutoGenerate: this.lastAutoGenerate,
      lastBenchmark: this.lastBenchmark,
      nextResearch: this.config.enabled && this.lastResearch
        ? new Date(this.lastResearch.getTime() + this.config.researchIntervalMs)
        : null,
      nextProductSync: this.config.enabled && this.lastProductSync
        ? new Date(this.lastProductSync.getTime() + this.config.productSyncIntervalMs)
        : null,
      nextAutoGenerate: this.config.enabled && this.config.autoGenerate && this.lastAutoGenerate
        ? new Date(this.lastAutoGenerate.getTime() + this.config.autoGenerateIntervalMs)
        : null,
      nextBenchmark: this.config.enabled && this.config.autoBenchmark && this.lastBenchmark
        ? new Date(this.lastBenchmark.getTime() + this.config.benchmarkIntervalMs)
        : null,
      stats: {
        totalPosts: allPosts.length,
        pendingClusters: pending.length,
        contextEntries: entries.length,
        products: prods.length,
        benchmarkQueries: benchmarkQueryRows.length,
        benchmarkRuns: benchmarkRunRows.length,
      },
    };
  }

  // --- Tasks ---

  private async runLocked<T extends Record<string, unknown>>(
    jobType: SchedulerJobType,
    companyId: string,
    triggerType: SchedulerTriggerType,
    skippedResult: T,
    task: () => Promise<T>,
  ): Promise<T> {
    const lease = beginSchedulerJob(companyId, jobType, triggerType);
    if (!lease) {
      this.log(`${jobType} already locked for company ${companyId}, skipping`);
      return {
        ...skippedResult,
        scheduler: { status: "skipped", reason: "locked" },
      } as T;
    }

    const heartbeatMs = Math.min(5 * 60 * 1000, Math.max(30 * 1000, Math.floor(SCHEDULER_LOCK_TTL_MS / 3)));
    const heartbeat = setInterval(() => {
      try {
        const renewed = renewSchedulerJobLease(companyId, jobType, lease);
        if (!renewed) this.log(`${jobType} lease was not renewed for company ${companyId}`);
      } catch (err: any) {
        this.log(`${jobType} lease renewal failed: ${err?.message || "Unknown error"}`);
      }
    }, heartbeatMs);
    heartbeat.unref?.();

    try {
      const result = await task();
      const completed = completeSchedulerJob(companyId, jobType, lease, "completed", result);
      if (!completed) {
        this.log(`${jobType} did not complete because its lease was lost for company ${companyId}`);
        return {
          ...skippedResult,
          scheduler: { status: "failed", runId: lease.runId, error: "Scheduler job lease was lost before completion." },
        } as T;
      }
      return {
        ...result,
        scheduler: { status: "completed", runId: lease.runId },
      } as T;
    } catch (err: any) {
      const message = err?.message || "Unknown scheduler error";
      completeSchedulerJob(companyId, jobType, lease, "failed", skippedResult, message);
      this.log(`${jobType} failed for company ${companyId}: ${message}`);
      return {
        ...skippedResult,
        scheduler: { status: "failed", runId: lease.runId, error: message },
      } as T;
    } finally {
      clearInterval(heartbeat);
      releaseSchedulerJobLock(companyId, jobType, lease);
    }
  }

  async runResearch(companyId = DEFAULT_COMPANY_ID, triggerType: SchedulerTriggerType = "scheduled"): Promise<{ entriesFound: number }> {
    return this.runLocked("research", companyId, triggerType, { entriesFound: 0 }, async () => {
      if (this.isResearching) {
        this.log("Research already in progress, skipping");
        return { entriesFound: 0 };
      }

      this.isResearching = true;
      this.log("Starting scheduled research...");

      try {
        const verticalIds = await selectResearchVerticalIds(companyId, this.config.maxVerticalsPerResearchRun);
        if (verticalIds.length === 0) {
          this.log("No verticals available for research");
          return { entriesFound: 0 };
        }

        const orchestrator = new ResearchOrchestrator({
          concurrency: this.config.researchConcurrency,
        });

        const result = await orchestrator.runResearch({
          companyId,
          verticalIds,
          sourceTypes: this.config.researchSources,
        });
        const researchedAt = new Date();
        for (const verticalId of verticalIds) {
          await db
            .update(industryVerticals)
            .set({ lastResearchedAt: researchedAt, updatedAt: researchedAt })
            .where(and(eq(industryVerticals.companyId, companyId), eq(industryVerticals.id, verticalId)));
        }

        const entriesFound = result.results.reduce((s, r) => s + r.entriesFound, 0);
        this.lastResearch = new Date();
        this.log(`Research complete: ${entriesFound} entries found across ${result.completed} agents`);
        return { entriesFound };
      } finally {
        this.isResearching = false;
      }
    }).catch((err: any) => {
      this.log(`Research failed: ${err.message}`);
      return { entriesFound: 0 };
    });
  }

  async runProductSync(companyId = DEFAULT_COMPANY_ID, triggerType: SchedulerTriggerType = "scheduled"): Promise<{ total: number; new_: number }> {
    return this.runLocked("product_sync", companyId, triggerType, { total: 0, new_: 0 }, async () => {
      if (this.isSyncing) {
        this.log("Product sync already in progress, skipping");
        return { total: 0, new_: 0 };
      }

      this.isSyncing = true;
      this.log("Starting product sync...");

      try {
        const scrapeResult = await scrapeProducts(companyId);
        this.log(`Scraped ${scrapeResult.total} products (${scrapeResult.new_} new)`);

        if (scrapeResult.new_ > 0) {
          const mapResult = await mapProductsToVerticals(companyId);
          this.log(`Mapped ${mapResult.mapped} new product-vertical connections`);
        }

        this.lastProductSync = new Date();
        return { total: scrapeResult.total, new_: scrapeResult.new_ };
      } finally {
        this.isSyncing = false;
      }
    }).catch((err: any) => {
      this.log(`Product sync failed: ${err.message}`);
      return { total: 0, new_: 0 };
    });
  }

  async runAutoGenerate(companyId = DEFAULT_COMPANY_ID, triggerType: SchedulerTriggerType = "scheduled"): Promise<{ generated: number }> {
    return this.runLocked("auto_generate", companyId, triggerType, { generated: 0 }, async () => {
      if (this.isGenerating) {
        this.log("Auto-generate already in progress, skipping");
        return { generated: 0 };
      }

      if (!this.config.autoGenerate) return { generated: 0 };

      this.isGenerating = true;
      this.log("Checking for pending clusters to auto-generate...");

      try {
        // Get pending clusters sorted by priority
        const pending = await db
          .select()
          .from(keywordClusters)
          .where(and(eq(keywordClusters.companyId, companyId), eq(keywordClusters.status, "pending")))
          .limit(this.config.maxAutoPostsPerRun);

        if (pending.length === 0) {
          this.log("No pending clusters found");
          this.lastAutoGenerate = new Date();
          return { generated: 0 };
        }

        // Sort by priority descending
        pending.sort((a, b) => (b.priority || 0) - (a.priority || 0));

        let generated = 0;
        for (const cluster of pending.slice(0, this.config.maxAutoPostsPerRun)) {
          try {
            this.log(`Auto-generating: "${cluster.primaryKeyword}" (priority: ${Math.round(cluster.priority || 0)})`);
            const post = await runBlogPipeline(
              { clusterId: cluster.id, companyId },
              (event) => {
                if (event.type === "status") this.log(`  [${event.phase}] ${event.message}`);
              },
            );

            // Render HTML
            const html = await renderShopifyHtml(post, await getCompanyContext(companyId));
            await db.update(blogPosts).set({ html }).where(and(eq(blogPosts.companyId, companyId), eq(blogPosts.id, post.id)));

            generated++;
            this.log(`Generated: "${post.title}" (score: ${post.overallScore}/100)`);
          } catch (err: any) {
            this.log(`Failed to generate for cluster ${cluster.id}: ${err.message}`);
          }
        }

        this.lastAutoGenerate = new Date();
        this.log(`Auto-generate complete: ${generated}/${pending.length} posts created`);
        return { generated };
      } finally {
        this.isGenerating = false;
      }
    }).catch((err: any) => {
      this.log(`Auto-generate failed: ${err.message}`);
      return { generated: 0 };
    });
  }

  async runPhotoAnalysis(companyId = DEFAULT_COMPANY_ID, triggerType: SchedulerTriggerType = "scheduled"): Promise<{ analyzed: number }> {
    return this.runLocked("photo_analysis", companyId, triggerType, { analyzed: 0 }, async () => {
      if (this.isAnalyzingPhotos) {
        this.log("Photo analysis already in progress, skipping");
        return { analyzed: 0 };
      }

      this.isAnalyzingPhotos = true;
      this.log("Starting scheduled photo analysis...");

      try {
        const result = await batchAnalyzePhotos(30, (msg) => this.log(`  [photos] ${msg}`), companyId);
        this.lastPhotoAnalysis = new Date();
        this.log(`Photo analysis complete: ${result.analyzed} analyzed, ${result.failed} failed`);
        return { analyzed: result.analyzed };
      } finally {
        this.isAnalyzingPhotos = false;
      }
    }).catch((err: any) => {
      this.log(`Photo analysis failed: ${err.message}`);
      return { analyzed: 0 };
    });
  }

  async runChunkRebuild(companyId = DEFAULT_COMPANY_ID, triggerType: SchedulerTriggerType = "scheduled"): Promise<{ chunks: number }> {
    return this.runLocked("chunk_rebuild", companyId, triggerType, { chunks: 0 }, async () => {
      if (this.isRebuildingChunks) {
        this.log("Chunk rebuild already in progress, skipping");
        return { chunks: 0 };
      }

      this.isRebuildingChunks = true;
      this.log("Rebuilding context chunks...");

      try {
        const count = await rebuildContextChunks(companyId);
        this.lastChunkRebuild = new Date();
        this.log(`Chunk rebuild complete: ${count} chunks`);
        return { chunks: count };
      } finally {
        this.isRebuildingChunks = false;
      }
    }).catch((err: any) => {
      this.log(`Chunk rebuild failed: ${err.message}`);
      return { chunks: 0 };
    });
  }

  async runBenchmark(companyId = DEFAULT_COMPANY_ID, triggerType: SchedulerTriggerType = "scheduled"): Promise<{ results: number }> {
    return this.runLocked("benchmark", companyId, triggerType, { results: 0 }, async () => {
      if (this.isBenchmarking) {
        this.log("AI benchmark already in progress, skipping");
        return { results: 0 };
      }

      if (!this.config.autoBenchmark) {
        return { results: 0 };
      }

      this.isBenchmarking = true;
      this.log("Starting scheduled AI benchmark...");

      try {
        const summary = await runAiBenchmark(
          {
            name: `Scheduled AI Benchmark ${new Date().toISOString().slice(0, 10)}`,
            providers: this.config.benchmarkProviders,
            concurrency: 2,
            companyId,
          },
          (event) => {
            if (event.type === "progress" && event.current && event.total) {
              this.log(`  [benchmark] ${event.current}/${event.total} ${event.provider} -> ${event.query}`);
            }
          },
        );

        this.lastBenchmark = new Date();
        this.log(`AI benchmark complete: ${summary.run.resultCount} results saved`);
        return { results: summary.run.resultCount || 0 };
      } finally {
        this.isBenchmarking = false;
      }
    }).catch((err: any) => {
      this.log(`AI benchmark failed: ${err.message}`);
      return { results: 0 };
    });
  }

  // --- Manual triggers ---

  async triggerResearch(companyId = DEFAULT_COMPANY_ID): Promise<{ entriesFound: number }> {
    return this.runResearch(companyId, "manual");
  }

  async triggerProductSync(companyId = DEFAULT_COMPANY_ID): Promise<{ total: number; new_: number }> {
    return this.runProductSync(companyId, "manual");
  }

  async triggerAutoGenerate(companyId = DEFAULT_COMPANY_ID): Promise<{ generated: number }> {
    const original = this.config.autoGenerate;
    this.config.autoGenerate = true;
    const result = await this.runAutoGenerate(companyId, "manual");
    this.config.autoGenerate = original;
    return result;
  }

  async triggerPhotoAnalysis(companyId = DEFAULT_COMPANY_ID): Promise<{ analyzed: number }> {
    return this.runPhotoAnalysis(companyId, "manual");
  }

  async triggerChunkRebuild(companyId = DEFAULT_COMPANY_ID): Promise<{ chunks: number }> {
    return this.runChunkRebuild(companyId, "manual");
  }

  async triggerBenchmark(companyId = DEFAULT_COMPANY_ID): Promise<{ results: number }> {
    const original = this.config.autoBenchmark;
    this.config.autoBenchmark = true;
    const result = await this.runBenchmark(companyId, "manual");
    this.config.autoBenchmark = original;
    return result;
  }
}

// --- Singleton ---

export const scheduler = new BlogScheduler();

const schedulerRegistry = new Map<string, BlogScheduler>([[DEFAULT_COMPANY_ID, scheduler]]);
const hydratedSchedulerCompanies = new Set<string>();

export function getScheduler(companyId = DEFAULT_COMPANY_ID): BlogScheduler {
  const existing = schedulerRegistry.get(companyId);
  if (existing) return existing;
  const instance = new BlogScheduler();
  schedulerRegistry.set(companyId, instance);
  return instance;
}

export async function getConfiguredScheduler(companyId = DEFAULT_COMPANY_ID): Promise<BlogScheduler> {
  const instance = getScheduler(companyId);
  if (!hydratedSchedulerCompanies.has(companyId)) {
    instance.replaceConfig(await loadSchedulerConfig(companyId), companyId);
    hydratedSchedulerCompanies.add(companyId);
  }
  return instance;
}

export async function startPersistedSchedulers(): Promise<number> {
  const rows = await db.select().from(companySettings);
  let started = 0;

  for (const row of rows) {
    clearExpiredSchedulerLocks(row.companyId);
    const settings = asRecord(row.settings);
    const config = normalizeSchedulerConfig(settings.scheduler, DEFAULT_CONFIG);
    if (!config.enabled) continue;
    const instance = getScheduler(row.companyId);
    instance.replaceConfig(config, row.companyId);
    hydratedSchedulerCompanies.add(row.companyId);
    started++;
  }

  return started;
}

export function stopAllSchedulers(): void {
  for (const instance of Array.from(schedulerRegistry.values())) {
    instance.stop();
  }
}
