// Shopify integration API routes
// Handles publishing blog posts to Shopify and checking sync status.

import { Router, type Request, type Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import {
  syncBlogPostToShopify,
  batchSyncToShopify,
  getShopifyArticle,
  updateShopifyArticle,
  deleteShopifyArticle,
  listShopifyArticles,
  listShopifyBlogs,
  updateCollectionDescription,
  listCollections,
  checkShopifyConnection,
  getShopifyBlogTargets,
  type SyncResult,
  type BatchSyncProgress,
} from "./shopifyPublisher";
import { db } from "./db";
import { and, eq } from "drizzle-orm";
import { blogPosts, companyIntegrations, companyMemberships, companyUsageEvents } from "@shared/schema";
import {
  companyRoleAtLeast,
  getCompanyContext,
  getCompanyIdFromRequest,
  requireBlogRole,
  type CompanyContext,
} from "./companyContext";
import { encryptSecret } from "./integrationSecrets";

const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID || "";
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET || "";
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const SHOPIFY_OAUTH_SCOPES = process.env.SHOPIFY_OAUTH_SCOPES || "read_products,read_inventory,read_content,write_content";

function normalizeShop(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const host = value.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  if (!host) return null;
  const shop = host.replace(/\.myshopify\.com$/i, "");
  return /^[a-z0-9][a-z0-9-]*$/.test(shop) ? shop : null;
}

function allowDirectCollectionMutation(): boolean {
  return ["1", "true", "yes", "on"].includes((process.env.BLOG_ALLOW_SHOPIFY_COLLECTION_MUTATION || "").toLowerCase());
}

function parseNumericId(value: unknown): number | null {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function atomTag(entry: string, tag: string): string {
  const match = entry.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]).trim() : "";
}

async function listPublicBlogArticles(companyContext: CompanyContext) {
  const integration = companyContext.integrations.shopify;
  const defaultBlogId = integration?.defaultBlogId;
  const blogHandle = integration?.blogTargets.find((target) => target.id === defaultBlogId)?.handle
    || integration?.blogTargets[0]?.handle
    || "news";
  const configuredBlogUrl = companyContext.brandProfile.blogUrl?.trim();
  const storeUrl = integration?.publicStoreUrl?.trim()
    || companyContext.brandProfile.websiteUrl?.trim()
    || companyContext.company.websiteUrl?.trim();
  const blogUrl = configuredBlogUrl || (storeUrl ? `${storeUrl.replace(/\/$/, "")}/blogs/${blogHandle}` : "");
  if (!blogUrl) throw new Error("No public blog URL is configured for this company.");

  const parsedBlogUrl = new URL(blogUrl);
  if (parsedBlogUrl.protocol !== "https:") {
    throw new Error("The public blog URL must use HTTPS.");
  }

  const feedUrl = new URL(`${parsedBlogUrl.pathname.replace(/\/$/, "")}.atom`, parsedBlogUrl.origin);
  const response = await fetch(feedUrl, {
    headers: { Accept: "application/atom+xml, application/xml;q=0.9" },
  });
  if (!response.ok) {
    throw new Error(`Public blog feed request failed with status ${response.status}.`);
  }

  const feed = await response.text();
  const entries = feed.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) || [];
  const articles = entries.map((entry) => {
    const alternateLink = entry.match(/<link\b[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i)
      || entry.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i);
    const link = alternateLink ? decodeXml(alternateLink[1]) : "";
    const handle = link ? new URL(link, parsedBlogUrl.origin).pathname.split("/").filter(Boolean).at(-1) : undefined;
    const publishedAt = atomTag(entry, "published") || null;
    return {
      id: link || atomTag(entry, "id"),
      title: atomTag(entry, "title"),
      handle,
      public_url: link || undefined,
      published: true,
      published_at: publishedAt,
      updated_at: atomTag(entry, "updated") || publishedAt,
    };
  });

  return { articles, blogUrl: parsedBlogUrl.toString().replace(/\/$/, ""), source: "public-feed" as const };
}

async function getLinkedShopifyPost(companyId: string, articleId: number) {
  const [post] = await db
    .select()
    .from(blogPosts)
    .where(and(eq(blogPosts.companyId, companyId), eq(blogPosts.shopifyArticleId, articleId)))
    .limit(1);
  return post;
}

function appBaseUrl(req: Request): string {
  const configured = process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || process.env.PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, "");
  const proto = req.get("x-forwarded-proto") || req.protocol || "http";
  return `${proto}://${req.get("host")}`;
}

function normalizeReturnPath(value: unknown): string {
  if (typeof value !== "string") return "/blog/settings";
  const trimmed = value.trim();
  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//")) return "/blog/settings";
  try {
    const parsed = new URL(trimmed, "https://app.local");
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || "/blog/settings";
  } catch {
    return "/blog/settings";
  }
}

function signPayload(payload: string): string {
  return createHmac("sha256", SHOPIFY_CLIENT_SECRET || process.env.JWT_SECRET || "dev-shopify-state")
    .update(payload)
    .digest("base64url");
}

function createOAuthState(input: { companyId: string; shop: string; returnPath?: string; userId?: string | null }): string {
  const payload = Buffer.from(JSON.stringify({
    companyId: input.companyId,
    userId: input.userId || null,
    shop: input.shop,
    returnPath: normalizeReturnPath(input.returnPath),
    exp: Date.now() + 10 * 60 * 1000,
  })).toString("base64url");
  return `${payload}.${signPayload(payload)}`;
}

function verifyOAuthState(state: unknown): { companyId: string; shop: string; returnPath: string; userId: string | null } {
  if (typeof state !== "string" || !state.includes(".")) {
    throw new Error("Missing Shopify OAuth state.");
  }
  const [payload, signature] = state.split(".");
  const expected = signPayload(payload);
  const left = Buffer.from(signature || "");
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new Error("Invalid Shopify OAuth state.");
  }

  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    companyId?: string;
    userId?: string | null;
    shop?: string;
    returnPath?: string;
    exp?: number;
  };
  if (!parsed.companyId || !parsed.shop || !parsed.exp || parsed.exp < Date.now()) {
    throw new Error("Expired Shopify OAuth state.");
  }

  return {
    companyId: parsed.companyId,
    userId: parsed.userId || null,
    shop: parsed.shop,
    returnPath: normalizeReturnPath(parsed.returnPath),
  };
}

function verifyShopifyHmac(query: Request["query"]): boolean {
  const hmac = typeof query.hmac === "string" ? query.hmac : "";
  if (!hmac || !SHOPIFY_CLIENT_SECRET) return false;

  const message = Object.entries(query)
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      const rendered = Array.isArray(value) ? value.join(",") : String(value ?? "");
      return `${key}=${rendered}`;
    })
    .join("&");

  const digest = createHmac("sha256", SHOPIFY_CLIENT_SECRET).update(message).digest("hex");
  const left = Buffer.from(hmac, "hex");
  const right = Buffer.from(digest, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

async function fetchShopifyBlogs(shop: string, accessToken: string): Promise<Array<{ id: number; name: string; handle: string }>> {
  const response = await fetch(`https://${shop}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/blogs.json?limit=50`, {
    headers: { "X-Shopify-Access-Token": accessToken },
  });
  if (!response.ok) return [];
  const data = await response.json();
  return (data.blogs || []).map((blog: any) => ({
    id: Number(blog.id),
    name: blog.title,
    handle: blog.handle,
  })).filter((blog: { id: number; name: string; handle: string }) => Number.isFinite(blog.id) && blog.name && blog.handle);
}

async function exchangeOAuthCode(shop: string, code: string): Promise<{ accessToken: string; scope?: string }> {
  const response = await fetch(`https://${shop}.myshopify.com/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
      code,
    }),
  });

  if (!response.ok) {
    throw new Error(`Shopify OAuth token exchange failed with status ${response.status}.`);
  }

  const data = await response.json();
  if (!data.access_token) throw new Error("Shopify OAuth did not return an access token.");
  return { accessToken: data.access_token, scope: data.scope };
}

export function registerShopifyRoutes(app: {
  use: (path: string, router: Router) => void;
}) {
  const router = Router();

  router.post("/oauth/start", requireBlogRole("admin"), async (req: Request, res: Response) => {
    try {
      if (!SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
        return res.status(400).json({ error: "SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET must be configured." });
      }

      const shop = normalizeShop(req.body?.shop);
      if (!shop) return res.status(400).json({ error: "A valid Shopify shop is required." });

      const companyId = getCompanyIdFromRequest(req);
      const redirectUri = `${appBaseUrl(req)}/api/blog/shopify/oauth/callback`;
      const state = createOAuthState({
        companyId,
        userId: req.user?.userId || null,
        shop,
        returnPath: normalizeReturnPath(req.body?.returnPath),
      });
      const installUrl = new URL(`https://${shop}.myshopify.com/admin/oauth/authorize`);
      installUrl.searchParams.set("client_id", SHOPIFY_CLIENT_ID);
      installUrl.searchParams.set("scope", SHOPIFY_OAUTH_SCOPES);
      installUrl.searchParams.set("redirect_uri", redirectUri);
      installUrl.searchParams.set("state", state);

      res.json({ installUrl: installUrl.toString(), redirectUri, scopes: SHOPIFY_OAUTH_SCOPES.split(",") });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  router.get("/oauth/callback", async (req: Request, res: Response) => {
    let returnPath = "/blog/settings";
    try {
      if (!SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
        throw new Error("SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET must be configured.");
      }
      if (!verifyShopifyHmac(req.query)) {
        throw new Error("Invalid Shopify OAuth HMAC.");
      }

      const state = verifyOAuthState(req.query.state);
      returnPath = state.returnPath;
      if (state.userId && req.user?.userId && req.user.userId !== state.userId) {
        throw new Error("Shopify OAuth state does not match the current user.");
      }
      if (state.userId) {
        const [membership] = await db
          .select({ id: companyMemberships.id, role: companyMemberships.role })
          .from(companyMemberships)
          .where(and(
            eq(companyMemberships.companyId, state.companyId),
            eq(companyMemberships.userId, state.userId),
            eq(companyMemberships.status, "active"),
          ))
          .limit(1);
        if (!membership) throw new Error("Shopify OAuth user no longer has access to this company.");
        if (!companyRoleAtLeast(membership.role, "admin")) {
          throw new Error("Shopify OAuth requires admin access to this company.");
        }
      }
      const shop = normalizeShop(req.query.shop);
      const code = typeof req.query.code === "string" ? req.query.code : "";
      if (!shop || shop !== state.shop || !code) {
        throw new Error("Invalid Shopify OAuth callback.");
      }

      const { accessToken, scope } = await exchangeOAuthCode(shop, code);
      const blogTargets = await fetchShopifyBlogs(shop, accessToken);
      const defaultBlogId = blogTargets[0]?.id || null;
      const encryptedAccessToken = encryptSecret(accessToken);
      const productUrlPattern = `https://${shop}.myshopify.com/products/{handle}`;

      const [existing] = await db
        .select()
        .from(companyIntegrations)
        .where(and(eq(companyIntegrations.companyId, state.companyId), eq(companyIntegrations.type, "shopify")))
        .limit(1);

      const previousConfig = existing?.config && typeof existing.config === "object" && !Array.isArray(existing.config)
        ? existing.config as Record<string, unknown>
        : {};
      const config = {
        ...previousConfig,
        shop,
        defaultBlogId,
        blogTargets,
        productUrlPattern,
        scopes: scope ? String(scope).split(",") : SHOPIFY_OAUTH_SCOPES.split(","),
        encryptedAccessToken,
        installedAt: new Date().toISOString(),
      };
      const payload = {
        companyId: state.companyId,
        type: "shopify",
        name: "Shopify",
        status: "connected",
        accessTokenRef: null,
        config,
        updatedAt: new Date(),
      };

      if (existing) {
        await db.update(companyIntegrations).set(payload).where(eq(companyIntegrations.id, existing.id));
      } else {
        await db.insert(companyIntegrations).values({ ...payload, createdAt: new Date() });
      }

      await db.insert(companyUsageEvents).values({
        companyId: state.companyId,
        userId: state.userId || req.user?.userId || null,
        eventType: "integration.shopify.oauth_connected",
        metadata: { shop, scopes: config.scopes, blogTargets: blogTargets.length },
      });

      const redirect = new URL(returnPath, appBaseUrl(req));
      redirect.searchParams.set("shopify", "connected");
      redirect.searchParams.set("companyId", state.companyId);
      res.redirect(302, redirect.toString());
    } catch (error: unknown) {
      console.warn("[Shopify OAuth] callback failed:", error instanceof Error ? error.message : "Unknown error");
      const redirect = new URL(returnPath, appBaseUrl(req));
      redirect.searchParams.set("shopify_error", "oauth_failed");
      res.redirect(302, redirect.toString());
    }
  });

  // POST /api/blog/shopify/posts/:id/publish — Sync single post to Shopify
  router.post(
    "/posts/:id/publish",
    requireBlogRole("reviewer"),
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const { blogId } = req.body as { blogId?: number };
        const companyId = getCompanyIdFromRequest(req);

        if (!id) {
          return res.status(400).json({ error: "Post ID is required" });
        }

        // Verify post exists
        const [post] = await db
          .select()
          .from(blogPosts)
          .where(and(eq(blogPosts.companyId, companyId), eq(blogPosts.id, id)));

        if (!post) {
          return res.status(404).json({ error: "Blog post not found" });
        }

        // Check that post has content to publish
        if (!post.markdown && !post.html) {
          return res.status(400).json({
            error: "Blog post has no content to publish",
          });
        }

        const result = await syncBlogPostToShopify(id, blogId, companyId);

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
    requireBlogRole("reviewer"),
    async (req: Request, res: Response) => {
      try {
        const { postIds, blogId } = req.body as {
          postIds?: string[];
          blogId?: number;
        };
        const companyId = getCompanyIdFromRequest(req);

        if (!postIds || !Array.isArray(postIds) || postIds.length === 0) {
          return res.status(400).json({
            error: "postIds array is required and must not be empty",
          });
        }

        // Validate all post IDs exist inside the active company.
        const posts = await Promise.all(
          postIds.map((id) =>
            db
              .select({ id: blogPosts.id, title: blogPosts.title })
              .from(blogPosts)
              .where(and(eq(blogPosts.companyId, companyId), eq(blogPosts.id, id)))
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
          },
          companyId,
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
        const companyId = getCompanyIdFromRequest(req);
        const companyContext = await getCompanyContext(companyId);

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
          .where(and(eq(blogPosts.companyId, companyId), eq(blogPosts.id, id)));

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
              post.shopifyArticleId,
              companyContext,
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
  router.get("/blogs", async (req: Request, res: Response) => {
    try {
      const companyContext = await getCompanyContext(getCompanyIdFromRequest(req));
      // First return our known blogs (fast, no API call)
      const knownBlogs = getShopifyBlogTargets(companyContext);

      // Try to also fetch from Shopify for the complete list
      try {
        const shopifyBlogs = await listShopifyBlogs(companyContext);
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

  // GET /api/blog/shopify/status — Check active company's Shopify connection
  router.get("/status", async (req: Request, res: Response) => {
    try {
      const status = await checkShopifyConnection(await getCompanyContext(getCompanyIdFromRequest(req)));
      res.json(status);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  // GET /api/blog/shopify/articles — List Shopify blog articles
  router.get("/articles", async (req: Request, res: Response) => {
    try {
      const companyContext = await getCompanyContext(getCompanyIdFromRequest(req));
      try {
        const articles = await listShopifyArticles(undefined, 50, companyContext);
        res.json({
          articles,
          blogUrl: companyContext.brandProfile.blogUrl || null,
          source: "shopify-admin",
        });
      } catch (error: unknown) {
        try {
          res.json(await listPublicBlogArticles(companyContext));
        } catch (fallbackError: unknown) {
          const message = fallbackError instanceof Error
            ? fallbackError.message
            : error instanceof Error
              ? error.message
              : "Unknown error";
          res.status(500).json({ error: message });
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  // PUT /api/blog/shopify/articles/:articleId — Update a Shopify article
  router.put("/articles/:articleId", requireBlogRole("reviewer"), async (req: Request, res: Response) => {
    try {
      const articleId = parseNumericId(req.params.articleId);
      if (!articleId) return res.status(400).json({ error: "A valid article ID is required." });
      const companyId = getCompanyIdFromRequest(req);
      const linkedPost = await getLinkedShopifyPost(companyId, articleId);
      if (!linkedPost) {
        return res.status(404).json({ error: "Shopify article is not linked to a post in this company." });
      }
      if (!linkedPost.shopifyBlogId) {
        return res.status(400).json({ error: "Linked post is missing its Shopify blog ID." });
      }
      const companyContext = await getCompanyContext(companyId);

      await updateShopifyArticle(linkedPost.shopifyBlogId, articleId, {
        title: req.body.title,
        bodyHtml: req.body.body_html,
        tags: req.body.tags,
        published: req.body.published,
      }, companyContext);
      await db.insert(companyUsageEvents).values({
        companyId,
        userId: req.user?.userId || null,
        eventType: "shopify.article.updated",
        metadata: { articleId, blogPostId: linkedPost.id },
      });
      res.json({ message: "Updated" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  // DELETE /api/blog/shopify/articles/:articleId — Delete a Shopify article
  router.delete("/articles/:articleId", requireBlogRole("admin"), async (req: Request, res: Response) => {
    try {
      const articleId = parseNumericId(req.params.articleId);
      if (!articleId) return res.status(400).json({ error: "A valid article ID is required." });
      const companyId = getCompanyIdFromRequest(req);
      const linkedPost = await getLinkedShopifyPost(companyId, articleId);
      if (!linkedPost) {
        return res.status(404).json({ error: "Shopify article is not linked to a post in this company." });
      }
      if (!linkedPost.shopifyBlogId) {
        return res.status(400).json({ error: "Linked post is missing its Shopify blog ID." });
      }
      await deleteShopifyArticle(linkedPost.shopifyBlogId, articleId, await getCompanyContext(companyId));
      await db
        .update(blogPosts)
        .set({
          shopifyArticleId: null,
          shopifyBlogId: null,
          shopifySyncedAt: null,
          status: linkedPost.status === "published" ? "approved" : linkedPost.status,
          updatedAt: new Date(),
        })
        .where(and(eq(blogPosts.companyId, companyId), eq(blogPosts.id, linkedPost.id)));
      await db.insert(companyUsageEvents).values({
        companyId,
        userId: req.user?.userId || null,
        eventType: "shopify.article.deleted",
        metadata: { articleId, blogPostId: linkedPost.id },
      });
      res.json({ message: "Deleted" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  // GET /api/blog/shopify/collections — List Shopify collections
  router.get("/collections", async (req: Request, res: Response) => {
    try {
      const collections = await listCollections(await getCompanyContext(getCompanyIdFromRequest(req)));
      res.json({ collections });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  // PUT /api/blog/shopify/collections/:id — Update collection description
  router.put("/collections/:id", requireBlogRole("admin"), async (req: Request, res: Response) => {
    try {
      if (!allowDirectCollectionMutation()) {
        return res.status(403).json({ error: "Direct Shopify collection mutation is disabled. Set BLOG_ALLOW_SHOPIFY_COLLECTION_MUTATION=true to enable this admin tool." });
      }
      const collectionId = parseNumericId(req.params.id);
      if (!collectionId) return res.status(400).json({ error: "A valid collection ID is required." });
      const companyId = getCompanyIdFromRequest(req);
      await updateCollectionDescription(collectionId, req.body.body_html, await getCompanyContext(companyId));
      await db.insert(companyUsageEvents).values({
        companyId,
        userId: req.user?.userId || null,
        eventType: "shopify.collection.updated",
        metadata: { collectionId },
      });
      res.json({ message: "Collection updated" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  app.use("/api/blog/shopify", router);
}
