// Blog generation API routes
// SSE streaming for blog pipeline + post management.

import { Router, type Request, type Response } from "express";
import {
  runBlogPipeline,
  getBlogPosts,
  getBlogPost,
  updateBlogPost,
  type BlogSSEEvent,
} from "./blogPipeline";
import { renderShopifyHtml, renderPreviewHtml } from "./htmlRenderer";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { generationBatches, keywordClusters, blogPosts } from "@shared/schema";

export function registerBlogRoutes(app: { use: (path: string, router: Router) => void }) {
  const router = Router();

  // POST /api/blog/generate — Generate a single blog post from a cluster (SSE)
  router.post("/generate", async (req: Request, res: Response) => {
    try {
      const { clusterId } = req.body;
      if (!clusterId) {
        return res.status(400).json({ error: "clusterId is required" });
      }

      // SSE setup
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const sendEvent = (event: BlogSSEEvent) => {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      };

      try {
        const post = await runBlogPipeline({ clusterId }, sendEvent);
        // Generate HTML
        const html = renderShopifyHtml(post);
        await updateBlogPost(post.id, { html });
        sendEvent({ type: "complete", message: "HTML rendered", blogPost: { ...post, html } });
      } catch (err: any) {
        sendEvent({ type: "error", error: err.message });
      }

      res.end();
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      }
    }
  });

  // POST /api/blog/generate/batch — Batch generate from multiple clusters
  router.post("/generate/batch", async (req: Request, res: Response) => {
    try {
      const { clusterIds, name } = req.body;
      if (!clusterIds || !Array.isArray(clusterIds) || clusterIds.length === 0) {
        return res.status(400).json({ error: "clusterIds array is required" });
      }

      // SSE setup
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const sendEvent = (event: string, data: any) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // Create batch record
      const [batch] = await db.insert(generationBatches).values({
        name: name || `Batch ${new Date().toISOString().slice(0, 10)}`,
        totalPosts: clusterIds.length,
        status: "running",
        startedAt: new Date(),
      }).returning();

      sendEvent("started", { batchId: batch.id, total: clusterIds.length });

      let completed = 0;
      let failed = 0;

      for (const clusterId of clusterIds) {
        try {
          sendEvent("progress", {
            current: completed + failed + 1,
            total: clusterIds.length,
            clusterId,
            status: "generating",
          });

          const post = await runBlogPipeline(
            { clusterId, batchId: batch.id },
            (event) => sendEvent("pipeline", { clusterId, ...event }),
          );

          // Render HTML
          const html = renderShopifyHtml(post);
          await updateBlogPost(post.id, { html });

          completed++;
          sendEvent("post_complete", {
            clusterId,
            postId: post.id,
            title: post.title,
            score: post.overallScore,
            completed,
            failed,
          });
        } catch (err: any) {
          failed++;
          sendEvent("post_failed", {
            clusterId,
            error: err.message,
            completed,
            failed,
          });
        }
      }

      // Update batch record
      await db.update(generationBatches).set({
        completedPosts: completed,
        failedPosts: failed,
        status: failed === clusterIds.length ? "failed" : "completed",
        completedAt: new Date(),
      }).where(eq(generationBatches.id, batch.id));

      sendEvent("batch_complete", { batchId: batch.id, completed, failed, total: clusterIds.length });
      res.end();
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      }
    }
  });

  // GET /api/blog/posts — List all blog posts
  router.get("/posts", async (req: Request, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      const posts = await getBlogPosts(status);
      res.json(posts);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/posts/:id — Get a single blog post
  router.get("/posts/:id", async (req: Request, res: Response) => {
    try {
      const post = await getBlogPost(req.params.id);
      if (!post) return res.status(404).json({ error: "Post not found" });
      res.json(post);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // PATCH /api/blog/posts/:id — Update a blog post
  router.patch("/posts/:id", async (req: Request, res: Response) => {
    try {
      const updates = req.body;
      const post = await updateBlogPost(req.params.id, updates);
      res.json(post);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/posts/:id/html — Get Shopify-ready HTML
  router.get("/posts/:id/html", async (req: Request, res: Response) => {
    try {
      const post = await getBlogPost(req.params.id);
      if (!post) return res.status(404).json({ error: "Post not found" });
      const html = renderShopifyHtml(post);
      res.type("html").send(html);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/posts/:id/preview — Get full preview HTML page
  router.get("/posts/:id/preview", async (req: Request, res: Response) => {
    try {
      const post = await getBlogPost(req.params.id);
      if (!post) return res.status(404).json({ error: "Post not found" });
      const html = renderPreviewHtml(post);
      res.type("html").send(html);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/batches — List generation batches
  router.get("/batches", async (_req: Request, res: Response) => {
    try {
      const batches = await db.select().from(generationBatches);
      res.json(batches);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.use("/api/blog", router);
}
