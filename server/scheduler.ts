// Autonomous Scheduler — Cron-style background tasks for the blog engine
// Runs research, product sync, keyword refresh, and auto-generation on intervals.

import { db } from "./db";
import { eq, or } from "drizzle-orm";
import {
  industryVerticals,
  keywordClusters,
  keywords,
  products,
  blogPosts,
  contextEntries,
} from "@shared/schema";
import { ResearchOrchestrator } from "./iboltResearchAgent";
import { scrapeProducts, mapProductsToVerticals } from "./productScraper";
import { runBlogPipeline } from "./blogPipeline";
import { renderShopifyHtml } from "./htmlRenderer";
import { rebuildContextChunks } from "./contextChunker";
import {
  getPhotoEnrichmentSource,
  injectProductImagesIntoHtml,
  injectProductImagesIntoMarkdown,
} from "./blogPhotoSupport";
import { syncBlogPostToShopify } from "./shopifyPublisher";
import { generateExcerptForPost } from "./blogExcerpt";

// --- Types ---

export interface SchedulerConfig {
  researchIntervalMs: number;       // How often to run research agents (default: 24h)
  productSyncIntervalMs: number;    // How often to sync products (default: 12h)
  autoGenerateIntervalMs: number;   // How often to check for pending clusters (default: 1h)
  photoAnalysisIntervalMs: number;  // How often to analyze unanalyzed photos (default: 6h)
  chunkRebuildIntervalMs: number;   // How often to rebuild context chunks (default: 12h)
  enabled: boolean;
  autoGenerate: boolean;            // Auto-generate posts for pending clusters
  maxAutoPostsPerRun: number;       // Max posts to auto-generate per interval
  researchSources: Array<"reddit" | "youtube" | "web">;
  researchConcurrency: number;
}

export interface SchedulerStatus {
  running: boolean;
  config: SchedulerConfig;
  lastResearch: Date | null;
  lastProductSync: Date | null;
  lastAutoGenerate: Date | null;
  nextResearch: Date | null;
  nextProductSync: Date | null;
  nextAutoGenerate: Date | null;
  stats: {
    totalPosts: number;
    pendingClusters: number;
    contextEntries: number;
    products: number;
  };
}

// --- Default Config ---

const DEFAULT_CONFIG: SchedulerConfig = {
  researchIntervalMs: 24 * 60 * 60 * 1000,     // 24 hours
  productSyncIntervalMs: 12 * 60 * 60 * 1000,  // 12 hours
  autoGenerateIntervalMs: 60 * 60 * 1000,       // 1 hour
  photoAnalysisIntervalMs: 6 * 60 * 60 * 1000,  // 6 hours
  chunkRebuildIntervalMs: 12 * 60 * 60 * 1000,  // 12 hours
  enabled: false, // Must be explicitly enabled
  autoGenerate: false,
  maxAutoPostsPerRun: 3,
  researchSources: ["reddit"],
  researchConcurrency: 3,
};

// --- Scheduler Class ---

export class BlogScheduler {
  private config: SchedulerConfig;
  private researchTimer: ReturnType<typeof setInterval> | null = null;
  private productTimer: ReturnType<typeof setInterval> | null = null;
  private generateTimer: ReturnType<typeof setInterval> | null = null;
  private photoTimer: ReturnType<typeof setInterval> | null = null;
  private chunkTimer: ReturnType<typeof setInterval> | null = null;
  private lastResearch: Date | null = null;
  private lastProductSync: Date | null = null;
  private lastAutoGenerate: Date | null = null;
  private lastPhotoAnalysis: Date | null = null;
  private lastChunkRebuild: Date | null = null;
  private isResearching = false;
  private isSyncing = false;
  private isGenerating = false;
  private isAnalyzingPhotos = false;
  private isGeneratingExcerpts = false;
  private isRebuildingChunks = false;
  private log: (msg: string) => void;

  constructor(config?: Partial<SchedulerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.log = (msg: string) => console.log(`[Scheduler] ${msg}`);
  }

  // --- Control ---

  start(): void {
    if (this.researchTimer) return; // Already running
    this.config.enabled = true;
    this.log("Starting autonomous scheduler");

    this.researchTimer = setInterval(() => this.runResearch(), this.config.researchIntervalMs);
    this.productTimer = setInterval(() => this.runProductSync(), this.config.productSyncIntervalMs);

    if (this.config.autoGenerate) {
      this.generateTimer = setInterval(() => this.runAutoGenerate(), this.config.autoGenerateIntervalMs);
    }

    this.photoTimer = setInterval(() => this.runPhotoAnalysis(), this.config.photoAnalysisIntervalMs);
    this.chunkTimer = setInterval(() => this.runChunkRebuild(), this.config.chunkRebuildIntervalMs);

    this.log(`Research every ${Math.round(this.config.researchIntervalMs / 3600000)}h, Product sync every ${Math.round(this.config.productSyncIntervalMs / 3600000)}h`);
    this.log(`Photo analysis every ${Math.round(this.config.photoAnalysisIntervalMs / 3600000)}h, Chunk rebuild every ${Math.round(this.config.chunkRebuildIntervalMs / 3600000)}h`);
    if (this.config.autoGenerate) {
      this.log(`Auto-generate every ${Math.round(this.config.autoGenerateIntervalMs / 60000)}min (max ${this.config.maxAutoPostsPerRun} posts/run)`);
    }
  }

  stop(): void {
    this.config.enabled = false;
    if (this.researchTimer) { clearInterval(this.researchTimer); this.researchTimer = null; }
    if (this.productTimer) { clearInterval(this.productTimer); this.productTimer = null; }
    if (this.generateTimer) { clearInterval(this.generateTimer); this.generateTimer = null; }
    if (this.photoTimer) { clearInterval(this.photoTimer); this.photoTimer = null; }
    if (this.chunkTimer) { clearInterval(this.chunkTimer); this.chunkTimer = null; }
    this.log("Scheduler stopped");
  }

  updateConfig(updates: Partial<SchedulerConfig>): void {
    const wasRunning = this.config.enabled;
    if (wasRunning) this.stop();
    this.config = { ...this.config, ...updates };
    if (wasRunning || updates.enabled) this.start();
  }

  async getStatus(): Promise<SchedulerStatus> {
    const allPosts = await db.select().from(blogPosts);
    const pending = await db.select().from(keywordClusters).where(eq(keywordClusters.status, "pending"));
    const entries = await db.select().from(contextEntries);
    const prods = await db.select().from(products);

    const now = Date.now();

    return {
      running: this.config.enabled,
      config: this.config,
      lastResearch: this.lastResearch,
      lastProductSync: this.lastProductSync,
      lastAutoGenerate: this.lastAutoGenerate,
      nextResearch: this.config.enabled && this.lastResearch
        ? new Date(this.lastResearch.getTime() + this.config.researchIntervalMs)
        : null,
      nextProductSync: this.config.enabled && this.lastProductSync
        ? new Date(this.lastProductSync.getTime() + this.config.productSyncIntervalMs)
        : null,
      nextAutoGenerate: this.config.enabled && this.config.autoGenerate && this.lastAutoGenerate
        ? new Date(this.lastAutoGenerate.getTime() + this.config.autoGenerateIntervalMs)
        : null,
      stats: {
        totalPosts: allPosts.length,
        pendingClusters: pending.length,
        contextEntries: entries.length,
        products: prods.length,
      },
    };
  }

  // --- Tasks ---

  async runResearch(): Promise<{ entriesFound: number }> {
    if (this.isResearching) {
      this.log("Research already in progress, skipping");
      return { entriesFound: 0 };
    }

    this.isResearching = true;
    this.log("Starting scheduled research...");

    try {
      const orchestrator = new ResearchOrchestrator({
        concurrency: this.config.researchConcurrency,
      });

      const result = await orchestrator.runResearch({
        sourceTypes: this.config.researchSources,
      });

      const entriesFound = result.results.reduce((s, r) => s + r.entriesFound, 0);
      this.lastResearch = new Date();
      this.log(`Research complete: ${entriesFound} entries found across ${result.completed} agents`);
      return { entriesFound };
    } catch (err: any) {
      this.log(`Research failed: ${err.message}`);
      return { entriesFound: 0 };
    } finally {
      this.isResearching = false;
    }
  }

  async runProductSync(): Promise<{ total: number; new_: number }> {
    if (this.isSyncing) {
      this.log("Product sync already in progress, skipping");
      return { total: 0, new_: 0 };
    }

    this.isSyncing = true;
    this.log("Starting product sync...");

    try {
      const scrapeResult = await scrapeProducts();
      this.log(`Scraped ${scrapeResult.total} products (${scrapeResult.new_} new)`);

      if (scrapeResult.new_ > 0) {
        const mapResult = await mapProductsToVerticals();
        this.log(`Mapped ${mapResult.mapped} new product-vertical connections`);
      }

      this.lastProductSync = new Date();
      return { total: scrapeResult.total, new_: scrapeResult.new_ };
    } catch (err: any) {
      this.log(`Product sync failed: ${err.message}`);
      return { total: 0, new_: 0 };
    } finally {
      this.isSyncing = false;
    }
  }

  async runAutoGenerate(): Promise<{ generated: number }> {
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
        .where(eq(keywordClusters.status, "pending"))
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
            { clusterId: cluster.id },
            (event) => {
              if (event.type === "status") this.log(`  [${event.phase}] ${event.message}`);
            },
          );

          // Render HTML
          const html = await renderShopifyHtml(post);
          await db.update(blogPosts).set({ html }).where(eq(blogPosts.id, post.id));

          generated++;
          this.log(`Generated: "${post.title}" (score: ${post.overallScore}/100)`);
        } catch (err: any) {
          this.log(`Failed to generate for cluster ${cluster.id}: ${err.message}`);
        }
      }

      this.lastAutoGenerate = new Date();
      this.log(`Auto-generate complete: ${generated}/${pending.length} posts created`);
      return { generated };
    } catch (err: any) {
      this.log(`Auto-generate failed: ${err.message}`);
      return { generated: 0 };
    } finally {
      this.isGenerating = false;
    }
  }

  async runExcerptGeneration(postId?: string): Promise<{ generated: number }> {
    if (this.isGeneratingExcerpts) {
      this.log("Excerpt generation already in progress, skipping");
      return { generated: 0 };
    }

    this.isGeneratingExcerpts = true;
    this.log("Starting excerpt generation...");

    try {
      const allPosts = postId
        ? await db.select().from(blogPosts).where(eq(blogPosts.id, postId)).limit(1)
        : await db.select().from(blogPosts);

      let generated = 0;

      for (const post of allPosts) {
        if (!post?.markdown && !post?.html) continue;
        if (!postId && post.excerpt?.trim()) continue;

        const excerpt = await generateExcerptForPost(post);
        await db
          .update(blogPosts)
          .set({
            excerpt,
            updatedAt: new Date(),
          })
          .where(eq(blogPosts.id, post.id));

        if (post.shopifyArticleId) {
          const syncResult = await syncBlogPostToShopify(post.id, post.shopifyBlogId || undefined);
          if (!syncResult.success) {
            this.log(`  [excerpts] Shopify sync failed for "${post.title}": ${syncResult.error}`);
          }
        }

        generated += 1;
        this.log(`  [excerpts] Generated excerpt for "${post.title}"`);
      }

      this.log(`Excerpt generation complete: ${generated} posts updated`);
      return { generated };
    } catch (err: any) {
      this.log(`Excerpt generation failed: ${err.message}`);
      return { generated: 0 };
    } finally {
      this.isGeneratingExcerpts = false;
    }
  }

  async runPhotoAnalysis(postId?: string): Promise<{ analyzed: number }> {
    if (this.isAnalyzingPhotos) {
      this.log("Photo analysis already in progress, skipping");
      return { analyzed: 0 };
    }

    this.isAnalyzingPhotos = true;
    this.log("Starting scheduled photo injection...");

    try {
      const eligiblePosts = postId
        ? await db.select().from(blogPosts).where(eq(blogPosts.id, postId)).limit(1)
        : await db
            .select()
            .from(blogPosts)
            .where(or(eq(blogPosts.status, "approved"), eq(blogPosts.status, "published")));
      const availableProducts = (await db.select().from(products)).filter((product) => product.imageUrl);

      let analyzed = 0;

      for (const post of eligiblePosts) {
        if (!postId && post.photosInjected) continue;
        const sourceType = getPhotoEnrichmentSource(post);
        if (!sourceType) continue;

        let nextMarkdown = post.markdown;
        let nextHtml = post.html;
        let inserted = 0;

        if (sourceType === "markdown") {
          const enrichment = injectProductImagesIntoMarkdown(post.markdown || "", availableProducts);
          if (enrichment.inserted === 0) continue;
          nextMarkdown = enrichment.markdown;
          nextHtml = await renderShopifyHtml(
            { ...post, markdown: enrichment.markdown, html: "" },
            { preferStoredHtml: false },
          );
          inserted = enrichment.inserted;
        } else {
          const enrichment = injectProductImagesIntoHtml(post.html || "", availableProducts);
          if (enrichment.inserted === 0) continue;
          nextHtml = enrichment.html;
          inserted = enrichment.inserted;
        }

        await db
          .update(blogPosts)
          .set({
            markdown: nextMarkdown,
            html: nextHtml,
            photosInjected: true,
            hasPhotos: true,
            photoCount: inserted,
            updatedAt: new Date(),
          })
          .where(eq(blogPosts.id, post.id));

        const syncResult = await syncBlogPostToShopify(post.id, post.shopifyBlogId || undefined);
        if (!syncResult.success) {
          this.log(`  [photos] Shopify sync failed for "${post.title}": ${syncResult.error}`);
        }

        analyzed += 1;
        this.log(`  [photos] Injected ${inserted} images into "${post.title}"`);
      }

      this.lastPhotoAnalysis = new Date();
      this.log(`Photo injection complete: ${analyzed} posts updated`);
      return { analyzed };
    } catch (err: any) {
      this.log(`Photo injection failed: ${err.message}`);
      return { analyzed: 0 };
    } finally {
      this.isAnalyzingPhotos = false;
    }
  }

  async runChunkRebuild(): Promise<{ chunks: number }> {
    if (this.isRebuildingChunks) {
      this.log("Chunk rebuild already in progress, skipping");
      return { chunks: 0 };
    }

    this.isRebuildingChunks = true;
    this.log("Rebuilding context chunks...");

    try {
      const count = await rebuildContextChunks();
      this.lastChunkRebuild = new Date();
      this.log(`Chunk rebuild complete: ${count} chunks`);
      return { chunks: count };
    } catch (err: any) {
      this.log(`Chunk rebuild failed: ${err.message}`);
      return { chunks: 0 };
    } finally {
      this.isRebuildingChunks = false;
    }
  }

  // --- Manual triggers ---

  async triggerResearch(): Promise<{ entriesFound: number }> {
    return this.runResearch();
  }

  async triggerProductSync(): Promise<{ total: number; new_: number }> {
    return this.runProductSync();
  }

  async triggerAutoGenerate(): Promise<{ generated: number }> {
    const original = this.config.autoGenerate;
    this.config.autoGenerate = true;
    const result = await this.runAutoGenerate();
    this.config.autoGenerate = original;
    return result;
  }

  async triggerExcerptGeneration(postId?: string): Promise<{ generated: number }> {
    return this.runExcerptGeneration(postId);
  }

  async triggerPhotoAnalysis(postId?: string): Promise<{ analyzed: number }> {
    return this.runPhotoAnalysis(postId);
  }

  async triggerChunkRebuild(): Promise<{ chunks: number }> {
    return this.runChunkRebuild();
  }

  async triggerFullPublish(postId: string): Promise<{
    products: number;
    newProducts: number;
    excerpts: number;
    analyzed: number;
    published: number;
    syncResult?: Awaited<ReturnType<typeof syncBlogPostToShopify>>;
  }> {
    if (!postId) {
      throw new Error("postId is required for full_publish");
    }

    const productSync = await this.runProductSync();
    const excerpts = await this.runExcerptGeneration(postId);
    const photos = await this.runPhotoAnalysis(postId);
    const syncResult = await syncBlogPostToShopify(postId);

    return {
      products: productSync.total,
      newProducts: productSync.new_,
      excerpts: excerpts.generated,
      analyzed: photos.analyzed,
      published: syncResult.success ? 1 : 0,
      syncResult,
    };
  }
}

// --- Singleton ---

export const scheduler = new BlogScheduler();
