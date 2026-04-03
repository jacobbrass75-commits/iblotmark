// Shopify integration API routes
// Handles publishing blog posts to Shopify and checking sync status.

import { Router, type Request, type Response } from "express";
import {
  syncBlogPostToShopify,
  batchSyncToShopify,
  getShopifyArticle,
  listShopifyBlogs,
  getShopifyBlogTargets,
  type SyncResult,
  type BatchSyncProgress,
} from "./shopifyPublisher";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { blogPosts } from "@shared/schema";

export function registerShopifyRoutes(app: {
  use: (path: string, router: Router) => void;
}) {
  const router = Router();

  // POST /api/blog/shopify/posts/:id/publish — Sync single post to Shopify
  router.post(
    "/posts/:id/publish",
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const { blogId } = req.body as { blogId?: number };

        if (!id) {
          return res.status(400).json({ error: "Post ID is required" });
        }

        // Verify post exists
        const [post] = await db
          .select()
          .from(blogPosts)
          .where(eq(blogPosts.id, id));

        if (!post) {
          return res.status(404).json({ error: "Blog post not found" });
        }

        // Check that post has content to publish
        if (!post.markdown && !post.html) {
          return res.status(400).json({
            error: "Blog post has no content to publish",
          });
        }

        const result = await syncBlogPostToShopify(id, blogId);

        if (result.success) {
          return res.json({
            message: `Successfully ${result.action} Shopify article`,
            ...result,
          });
        } else {
          return res.status(500).json({
            message: "Failed to sync to Shopify",
            ...result,
          });
        }
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        console.error("[Shopify Route] Publish error:", message);
        return res.status(500).json({ error: message });
      }
    }
  );

  // POST /api/blog/shopify/posts/batch-publish — Bulk sync posts to Shopify (SSE)
  router.post(
    "/posts/batch-publish",
    async (req: Request, res: Response) => {
      try {
        const { postIds, blogId } = req.body as {
          postIds?: string[];
          blogId?: number;
        };

        if (!postIds || !Array.isArray(postIds) || postIds.length === 0) {
          return res.status(400).json({
            error: "postIds array is required and must not be empty",
          });
        }

        // Validate all post IDs exist
        const posts = await Promise.all(
          postIds.map((id) =>
            db
              .select({ id: blogPosts.id, title: blogPosts.title })
              .from(blogPosts)
              .where(eq(blogPosts.id, id))
          )
        );

        const validIds = posts
          .filter((rows) => rows.length > 0)
          .map((rows) => rows[0].id);

        if (validIds.length === 0) {
          return res.status(404).json({
            error: "None of the specified post IDs were found",
          });
        }

        // SSE setup for progress streaming
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        const sendEvent = (event: string, data: unknown) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        sendEvent("start", {
          message: `Starting batch publish of ${validIds.length} posts`,
          total: validIds.length,
        });

        const results = await batchSyncToShopify(
          validIds,
          blogId,
          (progress: BatchSyncProgress) => {
            sendEvent("progress", progress);
          }
        );

        const succeeded = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;

        sendEvent("complete", {
          message: `Batch publish complete: ${succeeded} succeeded, ${failed} failed`,
          results,
          succeeded,
          failed,
        });

        res.end();
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        console.error("[Shopify Route] Batch publish error:", message);

        if (!res.headersSent) {
          return res.status(500).json({ error: message });
        }
        // If SSE headers already sent, send error event
        res.write(
          `event: error\ndata: ${JSON.stringify({ error: message })}\n\n`
        );
        res.end();
      }
    }
  );

  // GET /api/blog/shopify/posts/:id/status — Check Shopify sync status
  router.get(
    "/posts/:id/status",
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;

        const [post] = await db
          .select({
            id: blogPosts.id,
            title: blogPosts.title,
            status: blogPosts.status,
            shopifyArticleId: blogPosts.shopifyArticleId,
            shopifyBlogId: blogPosts.shopifyBlogId,
            shopifySyncedAt: blogPosts.shopifySyncedAt,
          })
          .from(blogPosts)
          .where(eq(blogPosts.id, id));

        if (!post) {
          return res.status(404).json({ error: "Blog post not found" });
        }

        const syncStatus: Record<string, unknown> = {
          blogPostId: post.id,
          title: post.title,
          localStatus: post.status,
          shopifyArticleId: post.shopifyArticleId,
          shopifyBlogId: post.shopifyBlogId,
          shopifySyncedAt: post.shopifySyncedAt,
          isSynced: !!post.shopifyArticleId,
        };

        // If synced, try to fetch current state from Shopify
        if (post.shopifyArticleId && post.shopifyBlogId) {
          try {
            const article = await getShopifyArticle(
              post.shopifyBlogId,
              post.shopifyArticleId
            );
            syncStatus.shopifyStatus = article.published_at
              ? "published"
              : "draft";
            syncStatus.shopifyPublishedAt = article.published_at;
            syncStatus.shopifyUpdatedAt = article.updated_at;
            syncStatus.shopifyHandle = article.handle;
          } catch {
            // Shopify fetch failed -- just return local data
            syncStatus.shopifyStatus = "unknown";
            syncStatus.shopifyFetchError =
              "Could not fetch current status from Shopify";
          }
        } else {
          syncStatus.shopifyStatus = "not_synced";
        }

        return res.json(syncStatus);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        console.error("[Shopify Route] Status check error:", message);
        return res.status(500).json({ error: message });
      }
    }
  );

  // GET /api/blog/shopify/blogs — List available Shopify blogs
  router.get("/blogs", async (_req: Request, res: Response) => {
    try {
      // First return our known blogs (fast, no API call)
      const knownBlogs = getShopifyBlogTargets();

      // Try to also fetch from Shopify for the complete list
      try {
        const shopifyBlogs = await listShopifyBlogs();
        return res.json({
          blogs: shopifyBlogs.map((b) => ({
            id: b.id,
            title: b.title,
            handle: b.handle,
            isDefault: b.id === knownBlogs[0].id,
          })),
        });
      } catch {
        // Shopify API call failed -- return known blogs as fallback
        return res.json({
          blogs: knownBlogs.map((b) => ({
            id: b.id,
            title: b.name,
            handle: b.handle,
            isDefault: b.id === knownBlogs[0].id,
          })),
          note: "Loaded from local config (Shopify API unavailable)",
        });
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      console.error("[Shopify Route] List blogs error:", message);
      return res.status(500).json({ error: message });
    }
  });

  app.use("/api/blog/shopify", router);
}
