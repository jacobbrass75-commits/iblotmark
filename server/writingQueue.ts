// Writing Queue — Parallel blog generation with max 3 concurrent
// Manages a queue of generation jobs with live progress tracking.

import { runBlogPipeline, type BlogSSEEvent, type BlogGenerationRequest } from "./blogPipeline";
import { renderShopifyHtml } from "./htmlRenderer";
import { updateBlogPost } from "./blogPipeline";

export interface QueueJob {
  id: string;
  clusterId: string;
  label: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: string;
  phase: string;
  postId?: string;
  postTitle?: string;
  score?: number;
  error?: string;
  addedAt: number;
  startedAt?: number;
  completedAt?: number;
}

type QueueListener = (jobs: QueueJob[]) => void;

const MAX_CONCURRENT = 3;

class WritingQueue {
  private jobs: QueueJob[] = [];
  private running = 0;
  private listeners: QueueListener[] = [];

  getJobs(): QueueJob[] {
    return [...this.jobs];
  }

  addJob(clusterId: string, label: string): QueueJob {
    const job: QueueJob = {
      id: `wq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      clusterId,
      label,
      status: "queued",
      progress: "Waiting in queue...",
      phase: "",
      addedAt: Date.now(),
    };

    this.jobs.push(job);
    this.notify();
    this.processQueue();
    return job;
  }

  addJobs(items: Array<{ clusterId: string; label: string }>): QueueJob[] {
    const added: QueueJob[] = [];
    for (const item of items) {
      added.push(this.addJob(item.clusterId, item.label));
    }
    return added;
  }

  removeJob(jobId: string): void {
    const idx = this.jobs.findIndex((j) => j.id === jobId);
    if (idx >= 0 && this.jobs[idx].status === "queued") {
      this.jobs.splice(idx, 1);
      this.notify();
    }
  }

  clearCompleted(): void {
    this.jobs = this.jobs.filter((j) => j.status === "queued" || j.status === "running");
    this.notify();
  }

  subscribe(listener: QueueListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify(): void {
    const snapshot = this.getJobs();
    for (const listener of this.listeners) {
      try { listener(snapshot); } catch {}
    }
  }

  private async processQueue(): Promise<void> {
    while (this.running < MAX_CONCURRENT) {
      const next = this.jobs.find((j) => j.status === "queued");
      if (!next) break;

      this.running++;
      next.status = "running";
      next.startedAt = Date.now();
      next.progress = "Starting pipeline...";
      this.notify();

      this.runJob(next).finally(() => {
        this.running--;
        this.processQueue();
      });
    }
  }

  private async runJob(job: QueueJob): Promise<void> {
    try {
      const post = await runBlogPipeline(
        { clusterId: job.clusterId },
        (event: BlogSSEEvent) => {
          if (event.phase) job.phase = event.phase;
          if (event.message) job.progress = event.message;
          if (event.blogPost) {
            job.postId = event.blogPost.id;
            job.postTitle = event.blogPost.title;
            job.score = event.blogPost.overallScore || undefined;
          }
          this.notify();
        },
      );

      // Render HTML
      const html = await renderShopifyHtml(post);
      await updateBlogPost(post.id, { html });

      job.status = "completed";
      job.postId = post.id;
      job.postTitle = post.title;
      job.score = post.overallScore || undefined;
      job.progress = `Done: ${post.title} (${post.overallScore}/100)`;
      job.completedAt = Date.now();
    } catch (err: any) {
      job.status = "failed";
      job.error = err.message;
      job.progress = `Failed: ${err.message}`;
      job.completedAt = Date.now();
    }

    this.notify();
  }
}

export const writingQueue = new WritingQueue();
