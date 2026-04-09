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
import { autoLinkProducts } from "./htmlRenderer";
import JSZip from "jszip";
import { writingQueue } from "./writingQueue";
import { processCompetitorUrls, fetchCompetitorSitemap } from "./competitorScraper";
import { createVerticalFromDescription, autoMapKeywordsToVerticals } from "./verticalCreator";
import {
  publishBlogPost,
  updateShopifyArticle,
  deleteShopifyArticle,
  listShopifyArticles,
  updateCollectionDescription,
  listCollections,
  checkShopifyConnection,
} from "./shopifyPublisher";

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
        const html = await renderShopifyHtml(post);
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
          const html = await renderShopifyHtml(post);
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
      const existingPost = await getBlogPost(req.params.id);
      if (!existingPost) return res.status(404).json({ error: "Post not found" });

      const { content, ...rawUpdates } = req.body || {};
      const updates: any = {
        ...rawUpdates,
        ...(content !== undefined ? { markdown: content } : {}),
      };

      if (
        updates.html === undefined &&
        (
          updates.markdown !== undefined ||
          updates.title !== undefined ||
          updates.metaTitle !== undefined ||
          updates.metaDescription !== undefined
        )
      ) {
        updates.html = await renderShopifyHtml(
          { ...existingPost, ...updates, html: "" },
          { preferStoredHtml: false },
        );
      }

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
      const html = await renderShopifyHtml(post);
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
      const html = await renderPreviewHtml(post);
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

  // GET /api/blog/export — Download all approved posts as JSON with HTML
  router.get("/export", async (req: Request, res: Response) => {
    try {
      const status = (req.query.status as string) || "approved";
      const posts = await getBlogPosts(status);

      const exported = [];
      for (const post of posts) {
        const html = await renderShopifyHtml(post);
        exported.push({
          title: post.title,
          slug: post.slug,
          metaTitle: post.metaTitle,
          metaDescription: post.metaDescription,
          excerpt: post.excerpt,
          html,
          markdown: post.markdown,
          wordCount: post.wordCount,
          overallScore: post.overallScore,
          status: post.status,
        });
      }

      res.setHeader("Content-Disposition", `attachment; filename="ibolt-blog-export-${new Date().toISOString().slice(0, 10)}.json"`);
      res.json(exported);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/export/:id/html — Download single post as .html file
  router.get("/export/:id/html", async (req: Request, res: Response) => {
    try {
      const post = await getBlogPost(req.params.id);
      if (!post) return res.status(404).json({ error: "Post not found" });
      const html = await renderShopifyHtml(post);
      res.setHeader("Content-Disposition", `attachment; filename="${post.slug}.html"`);
      res.type("html").send(html);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/export/zip — Download all posts as a ZIP of HTML files
  router.get("/export/zip", async (req: Request, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      // If no status specified, get review + approved posts
      const statuses = status ? [status] : ["review", "approved"];
      let allPosts: any[] = [];
      for (const s of statuses) {
        const posts = await getBlogPosts(s);
        allPosts.push(...posts);
      }

      if (allPosts.length === 0) {
        return res.status(404).json({ error: "No posts found to export" });
      }

      const zip = new JSZip();

      for (const post of allPosts) {
        const html = await renderShopifyHtml(post);
        const preview = await renderPreviewHtml(post);

        // Shopify-ready HTML (just the body)
        zip.file(`shopify/${post.slug}.html`, html);
        // Full preview HTML (standalone page)
        zip.file(`preview/${post.slug}.html`, preview);
        // Markdown source
        zip.file(`markdown/${post.slug}.md`, post.markdown || "");
      }

      // Add an index file
      const index = allPosts.map((p: any) =>
        `${p.title}\n  Slug: ${p.slug}\n  Score: ${p.overallScore}/100\n  Words: ${p.wordCount}\n  Status: ${p.status}\n  Meta: ${p.metaTitle}\n  Desc: ${p.metaDescription}\n`
      ).join("\n");
      zip.file("index.txt", `iBolt Blog Export — ${new Date().toISOString().slice(0, 10)}\n${allPosts.length} posts\n\n${index}`);

      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
      const filename = `ibolt-blog-export-${new Date().toISOString().slice(0, 10)}.zip`;

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(zipBuffer);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // === WRITING QUEUE ===

  // GET /api/blog/queue — Get current queue state
  router.get("/queue", (_req: Request, res: Response) => {
    res.json(writingQueue.getJobs());
  });

  // POST /api/blog/queue/add — Add a cluster to the generation queue
  router.post("/queue/add", (req: Request, res: Response) => {
    try {
      const { clusterId, label } = req.body;
      if (!clusterId) return res.status(400).json({ error: "clusterId required" });
      const job = writingQueue.addJob(clusterId, label || "Blog post");
      res.json(job);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/queue/add-batch — Add multiple clusters to queue
  router.post("/queue/add-batch", (req: Request, res: Response) => {
    try {
      const { items } = req.body;
      if (!items?.length) return res.status(400).json({ error: "items array required" });
      const jobs = writingQueue.addJobs(items);
      res.json(jobs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/blog/queue/:id — Remove a queued job
  router.delete("/queue/:id", (req: Request, res: Response) => {
    writingQueue.removeJob(req.params.id);
    res.json({ ok: true });
  });

  // POST /api/blog/queue/clear — Clear completed/failed jobs
  router.post("/queue/clear", (_req: Request, res: Response) => {
    writingQueue.clearCompleted();
    res.json({ ok: true });
  });

  // GET /api/blog/queue/stream — SSE stream of queue updates
  router.get("/queue/stream", (req: Request, res: Response) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const unsubscribe = writingQueue.subscribe((jobs) => {
      res.write(`data: ${JSON.stringify(jobs)}\n\n`);
    });

    // Send initial state
    res.write(`data: ${JSON.stringify(writingQueue.getJobs())}\n\n`);

    req.on("close", unsubscribe);
  });

  // === COMPETITOR SCRAPER ===

  // POST /api/blog/competitor/analyze — Analyze competitor URLs
  router.post("/competitor/analyze", async (req: Request, res: Response) => {
    try {
      const { urls } = req.body;
      if (!urls?.length) return res.status(400).json({ error: "urls array required" });

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const result = await processCompetitorUrls(urls, (msg) => {
        res.write(`data: ${JSON.stringify({ message: msg })}\n\n`);
      });

      res.write(`event: completed\ndata: ${JSON.stringify(result)}\n\n`);
      res.end();
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      }
    }
  });

  // POST /api/blog/competitor/sitemap — Fetch competitor blog URLs from sitemap
  router.post("/competitor/sitemap", async (req: Request, res: Response) => {
    try {
      const { domain } = req.body;
      if (!domain) return res.status(400).json({ error: "domain required" });
      const urls = await fetchCompetitorSitemap(domain);
      res.json({ domain, urls, count: urls.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // === AI VERTICAL CREATOR ===

  // POST /api/blog/verticals/create-from-description — AI generates a full vertical
  router.post("/verticals/create-from-description", async (req: Request, res: Response) => {
    try {
      const { description } = req.body;
      if (!description) return res.status(400).json({ error: "description required" });
      const vertical = await createVerticalFromDescription(description);
      res.json(vertical);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/keywords/auto-map — Auto-map keywords to verticals
  router.post("/keywords/auto-map", async (_req: Request, res: Response) => {
    try {
      const result = await autoMapKeywordsToVerticals();
      res.json({ message: `Mapped ${result.mapped} keyword clusters to verticals`, ...result });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- Shopify Publishing Routes ---

  // GET /api/blog/shopify/status — Check Shopify connection
  router.get("/shopify/status", async (_req: Request, res: Response) => {
    try {
      const status = await checkShopifyConnection();
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/shopify/publish/:id — Publish a blog post to Shopify
  router.post("/shopify/publish/:id", async (req: Request, res: Response) => {
    try {
      const post = await getBlogPost(req.params.id);
      if (!post) return res.status(404).json({ error: "Post not found" });

      const html = post.html || await renderShopifyHtml(post as any);
      const result = await publishBlogPost({
        title: post.title,
        bodyHtml: html,
        metaTitle: post.metaTitle || undefined,
        metaDescription: post.metaDescription || undefined,
        excerpt: post.excerpt ?? undefined,
        tags: `2026, ${post.verticalId || "general"}`,
        published: req.body.published ?? false,
      });

      // Store Shopify article ID back on the post
      await updateBlogPost(post.id, {
        status: "published",
      });

      res.json({
        message: "Published to Shopify",
        shopifyArticleId: result.articleId,
        adminUrl: result.adminUrl,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/shopify/articles — List Shopify blog articles
  router.get("/shopify/articles", async (_req: Request, res: Response) => {
    try {
      const articles = await listShopifyArticles();
      res.json({ articles });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // PUT /api/blog/shopify/articles/:articleId — Update a Shopify article
  router.put("/shopify/articles/:articleId", async (req: Request, res: Response) => {
    try {
      await updateShopifyArticle(Number(req.params.articleId), {
        title: req.body.title,
        bodyHtml: req.body.body_html,
        excerpt: req.body.excerpt,
        tags: req.body.tags,
        published: req.body.published,
      });
      res.json({ message: "Updated" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/blog/shopify/articles/:articleId — Delete a Shopify article
  router.delete("/shopify/articles/:articleId", async (req: Request, res: Response) => {
    try {
      await deleteShopifyArticle(Number(req.params.articleId));
      res.json({ message: "Deleted" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/shopify/collections — List Shopify collections
  router.get("/shopify/collections", async (_req: Request, res: Response) => {
    try {
      const collections = await listCollections();
      res.json({ collections });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // PUT /api/blog/shopify/collections/:id — Update collection description
  router.put("/shopify/collections/:id", async (req: Request, res: Response) => {
    try {
      await updateCollectionDescription(Number(req.params.id), req.body.body_html);
      res.json({ message: "Collection updated" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.use("/api/blog", router);
}
