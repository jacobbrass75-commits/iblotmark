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
import { lintContent } from "./contentLinter";
import { addInternalLinks } from "./internalLinker";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { generationBatches, blogPosts, products as productTable } from "@shared/schema";
import JSZip from "jszip";
import { writingQueue } from "./writingQueue";
import { processCompetitorUrls, fetchCompetitorSitemap } from "./competitorScraper";
import { createVerticalFromDescription, autoMapKeywordsToVerticals, suggestMissingVerticals } from "./verticalCreator";
import { getResearchCoverage } from "./researchCoverage";
import { importLegacyContentOutput } from "./legacyContent";
import { getCompanyContext, getCompanyIdFromRequest, requireBlogMutationRole } from "./companyContext";
import {
  addPostPhotoSelection,
  deletePostPhotoSelection,
  listPostPhotoSelections,
  updatePostPhotoSelection,
} from "./photoSelector";

export function registerBlogRoutes(app: { use: (path: string, router: Router) => void }) {
  const router = Router();
  router.use(requireBlogMutationRole("editor"));

  // POST /api/blog/lint — Run deterministic brand/SEO lint on markdown
  router.post("/lint", async (req: Request, res: Response) => {
    try {
      const { markdown, title, metaTitle, metaDescription, primaryKeyword } = req.body || {};
      if (typeof markdown !== "string" || markdown.trim().length === 0) {
        return res.status(400).json({ error: "markdown is required" });
      }
      const companyId = getCompanyIdFromRequest(req);
      const catalog = await db
        .select({
          title: productTable.title,
          handle: productTable.handle,
          price: productTable.price,
        })
        .from(productTable)
        .where(eq(productTable.companyId, companyId));

      const report = lintContent({
        markdown,
        title,
        metaTitle,
        metaDescription,
        primaryKeyword,
        products: catalog.map((product) => {
          const parsedPrice = product.price ? Number.parseFloat(product.price) : Number.NaN;
          return {
            title: product.title,
            handle: product.handle,
            price: Number.isFinite(parsedPrice) ? parsedPrice : null,
          };
        }),
      });
      res.json(report);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/generate — Generate a single blog post from a cluster (SSE)
  router.post("/generate", async (req: Request, res: Response) => {
    try {
      const { clusterId } = req.body;
      const companyId = getCompanyIdFromRequest(req);
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
        const post = await runBlogPipeline({ clusterId, companyId }, sendEvent);
        // Generate HTML
        const html = await renderShopifyHtml(post, await getCompanyContext(companyId));
        await updateBlogPost(post.id, { html }, companyId);
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
      const companyId = getCompanyIdFromRequest(req);
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
        companyId,
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
            { clusterId, batchId: batch.id, companyId },
            (event) => sendEvent("pipeline", { clusterId, ...event }),
          );

          // Render HTML
          const html = await renderShopifyHtml(post, await getCompanyContext(companyId));
          await updateBlogPost(post.id, { html }, companyId);

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
      const posts = await getBlogPosts(status, getCompanyIdFromRequest(req));
      res.json(posts);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/posts/:id — Get a single blog post
  router.get("/posts/:id", async (req: Request, res: Response) => {
    try {
      const post = await getBlogPost(req.params.id, getCompanyIdFromRequest(req));
      if (!post) return res.status(404).json({ error: "Post not found" });
      res.json(post);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/posts/:id/photos — Review selected assets for a post
  router.get("/posts/:id/photos", async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const post = await getBlogPost(req.params.id, companyId);
      if (!post) return res.status(404).json({ error: "Post not found" });
      res.json(await listPostPhotoSelections(req.params.id, companyId));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/posts/:id/photos — Add a selected asset to a post
  router.post("/posts/:id/photos", async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const post = await getBlogPost(req.params.id, companyId);
      if (!post) return res.status(404).json({ error: "Post not found" });
      const selection = await addPostPhotoSelection(req.params.id, req.body || {}, companyId);
      res.status(201).json(selection);
    } catch (error: any) {
      const status = /not found/i.test(error.message) ? 404 : 400;
      res.status(status).json({ error: error.message });
    }
  });

  // PATCH /api/blog/posts/:id/photos/:selectionId — Update selected asset placement/copy
  router.patch("/posts/:id/photos/:selectionId", async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const post = await getBlogPost(req.params.id, companyId);
      if (!post) return res.status(404).json({ error: "Post not found" });
      const selection = await updatePostPhotoSelection(req.params.selectionId, req.params.id, req.body || {}, companyId);
      if (!selection) return res.status(404).json({ error: "Photo selection not found" });
      res.json(selection);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // DELETE /api/blog/posts/:id/photos/:selectionId — Remove a selected asset
  router.delete("/posts/:id/photos/:selectionId", async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const post = await getBlogPost(req.params.id, companyId);
      if (!post) return res.status(404).json({ error: "Post not found" });
      await deletePostPhotoSelection(req.params.selectionId, req.params.id, companyId);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // PATCH /api/blog/posts/:id — Update a blog post
  router.patch("/posts/:id", async (req: Request, res: Response) => {
    try {
      const updates = req.body;
      const post = await updateBlogPost(req.params.id, updates, getCompanyIdFromRequest(req));
      if (!post) return res.status(404).json({ error: "Post not found" });
      res.json(post);
    } catch (error: any) {
      const status = /invalid|must be/i.test(error.message) ? 400 : 500;
      res.status(status).json({ error: error.message });
    }
  });

  // POST /api/blog/posts/:id/internal-links — Insert contextual links to related posts
  router.post("/posts/:id/internal-links", async (req: Request, res: Response) => {
    try {
      const post = await getBlogPost(req.params.id, getCompanyIdFromRequest(req));
      if (!post) return res.status(404).json({ error: "Post not found" });
      res.json(await addInternalLinks(req.params.id));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/posts/:id/html — Get Shopify-ready HTML
  router.get("/posts/:id/html", async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const post = await getBlogPost(req.params.id, companyId);
      if (!post) return res.status(404).json({ error: "Post not found" });
      const html = await renderShopifyHtml(post, await getCompanyContext(companyId));
      res.type("html").send(html);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/posts/:id/preview — Get full preview HTML page
  router.get("/posts/:id/preview", async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const post = await getBlogPost(req.params.id, companyId);
      if (!post) return res.status(404).json({ error: "Post not found" });
      const html = await renderPreviewHtml(post, await getCompanyContext(companyId));
      res.type("html").send(html);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/batches — List generation batches
  router.get("/batches", async (req: Request, res: Response) => {
    try {
      const batches = await db
        .select()
        .from(generationBatches)
        .where(eq(generationBatches.companyId, getCompanyIdFromRequest(req)));
      res.json(batches);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/export — Download all approved posts as JSON with HTML
  router.get("/export", async (req: Request, res: Response) => {
    try {
      const status = (req.query.status as string) || "approved";
      const companyId = getCompanyIdFromRequest(req);
      const companyContext = await getCompanyContext(companyId);
      const posts = await getBlogPosts(status, companyId);

      const exported = [];
      for (const post of posts) {
        const html = await renderShopifyHtml(post, companyContext);
        exported.push({
          title: post.title,
          slug: post.slug,
          metaTitle: post.metaTitle,
          metaDescription: post.metaDescription,
          html,
          markdown: post.markdown,
          wordCount: post.wordCount,
          overallScore: post.overallScore,
          status: post.status,
        });
      }

      res.setHeader("Content-Disposition", `attachment; filename="blog-export-${new Date().toISOString().slice(0, 10)}.json"`);
      res.json(exported);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/export/:id/html — Download single post as .html file
  router.get("/export/:id/html", async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyIdFromRequest(req);
      const post = await getBlogPost(req.params.id, companyId);
      if (!post) return res.status(404).json({ error: "Post not found" });
      const html = await renderShopifyHtml(post, await getCompanyContext(companyId));
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
      const companyId = getCompanyIdFromRequest(req);
      const companyContext = await getCompanyContext(companyId);
      // If no status specified, get review + approved posts
      const statuses = status ? [status] : ["review", "approved"];
      let allPosts: any[] = [];
      for (const s of statuses) {
        const posts = await getBlogPosts(s, companyId);
        allPosts.push(...posts);
      }

      if (allPosts.length === 0) {
        return res.status(404).json({ error: "No posts found to export" });
      }

      const zip = new JSZip();

      for (const post of allPosts) {
        const html = await renderShopifyHtml(post, companyContext);
        const preview = await renderPreviewHtml(post, companyContext);

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
      zip.file("index.txt", `${companyContext.brandProfile.displayName} Blog Export — ${new Date().toISOString().slice(0, 10)}\n${allPosts.length} posts\n\n${index}`);

      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
      const filename = `blog-export-${new Date().toISOString().slice(0, 10)}.zip`;

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(zipBuffer);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/legacy-content/import — Load checked-in content-output HTML into blog_posts.
  router.post("/legacy-content/import", async (req: Request, res: Response) => {
    try {
      if (!["1", "true", "yes", "on"].includes((process.env.BLOG_ALLOW_LEGACY_CONTENT_IMPORT || "").toLowerCase())) {
        return res.status(403).json({ error: "Legacy content import is disabled in this environment." });
      }
      res.json(await importLegacyContentOutput(getCompanyIdFromRequest(req)));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/blog/research/coverage — Research coverage by vertical
  router.get("/research/coverage", async (req: Request, res: Response) => {
    try {
      res.json(await getResearchCoverage(getCompanyIdFromRequest(req)));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // === WRITING QUEUE ===

  // GET /api/blog/queue — Get current queue state
  router.get("/queue", (req: Request, res: Response) => {
    res.json(writingQueue.getJobs(getCompanyIdFromRequest(req)));
  });

  // POST /api/blog/queue/add — Add a cluster to the generation queue
  router.post("/queue/add", (req: Request, res: Response) => {
    try {
      const { clusterId, label } = req.body;
      if (!clusterId) return res.status(400).json({ error: "clusterId required" });
      const job = writingQueue.addJob(clusterId, label || "Blog post", getCompanyIdFromRequest(req));
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
      const jobs = writingQueue.addJobs(items, getCompanyIdFromRequest(req));
      res.json(jobs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/blog/queue/:id — Remove a queued job
  router.delete("/queue/:id", (req: Request, res: Response) => {
    writingQueue.removeJob(req.params.id, getCompanyIdFromRequest(req));
    res.json({ ok: true });
  });

  // POST /api/blog/queue/clear — Clear completed/failed jobs
  router.post("/queue/clear", (req: Request, res: Response) => {
    writingQueue.clearCompleted(getCompanyIdFromRequest(req));
    res.json({ ok: true });
  });

  // GET /api/blog/queue/stream — SSE stream of queue updates
  router.get("/queue/stream", (req: Request, res: Response) => {
    const companyId = getCompanyIdFromRequest(req);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const unsubscribe = writingQueue.subscribe((jobs) => {
      res.write(`data: ${JSON.stringify(jobs.filter((job) => job.companyId === companyId))}\n\n`);
    });

    // Send initial state
    res.write(`data: ${JSON.stringify(writingQueue.getJobs(companyId))}\n\n`);

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
      }, getCompanyIdFromRequest(req));

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
      const vertical = await createVerticalFromDescription(description, getCompanyIdFromRequest(req));
      res.json(vertical);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/verticals/create — AI generates a full vertical from a short description
  router.post("/verticals/create", async (req: Request, res: Response) => {
    try {
      const { description } = req.body || {};
      if (!description) return res.status(400).json({ error: "description required" });
      const vertical = await createVerticalFromDescription(description, getCompanyIdFromRequest(req));
      res.json(vertical);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/verticals/suggest — Suggest missing verticals from unmapped demand
  router.post("/verticals/suggest", async (req: Request, res: Response) => {
    try {
      res.json(await suggestMissingVerticals(getCompanyIdFromRequest(req)));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/blog/keywords/auto-map — Auto-map keywords to verticals
  router.post("/keywords/auto-map", async (req: Request, res: Response) => {
    try {
      const result = await autoMapKeywordsToVerticals(getCompanyIdFromRequest(req));
      res.json({ message: `Mapped ${result.mapped} keyword clusters to verticals`, ...result });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.use("/api/blog", router);
}
