// Shopify Publisher — Auto-upload blog posts to Shopify via REST Admin API
// Uses client credentials grant (tokens expire every 24h, auto-refreshed).

import { db } from "./db";
import { eq } from "drizzle-orm";
import { blogPosts, type BlogPost } from "@shared/schema";
import { renderShopifyHtml } from "./htmlRenderer";
import { shopifyLimiter, cachedApiCall, cache } from "./apiCache";

// --- Configuration ---

const SHOPIFY_CONFIG = {
  shop: "iboltmounts",
  apiVersion: "2025-01",
  blogId: 104843772196, // "News" blog
  fishFinderBlogId: 110121517348, // "How to Mount a Fish Finder" blog
};

function getShopifyCredentials() {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET environment variables"
    );
  }
  return { clientId, clientSecret };
}

function getShopifyBaseUrl(): string {
  return `https://${SHOPIFY_CONFIG.shop}.myshopify.com/admin/api/${SHOPIFY_CONFIG.apiVersion}`;
}

// --- Token Management ---

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

/**
 * Get a Shopify access token via client credentials grant.
 * Caches the token for 23 hours (they expire at 24h).
 */
export async function getShopifyToken(): Promise<string> {
  const now = Date.now();

  // Return cached token if still valid (with 1-hour buffer)
  if (cachedToken && cachedToken.expiresAt > now) {
    return cachedToken.accessToken;
  }

  const { clientId, clientSecret } = getShopifyCredentials();

  console.log("[Shopify] Requesting new access token via client credentials grant...");

  const tokenUrl = `https://${SHOPIFY_CONFIG.shop}.myshopify.com/admin/oauth/access_token`;

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `[Shopify] Token request failed (${response.status}): ${errorText}`
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    scope: string;
  };

  // Cache for 23 hours (tokens expire at 24h)
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: now + 23 * 60 * 60 * 1000,
  };

  console.log("[Shopify] Access token acquired successfully.");
  return cachedToken.accessToken;
}

// --- Generic REST Wrapper ---

interface ShopifyRestOptions {
  method: "GET" | "POST" | "PUT" | "DELETE";
  endpoint: string;
  body?: Record<string, unknown>;
  skipCache?: boolean;
}

/**
 * Generic Shopify REST API wrapper with auth + rate limiting via shopifyLimiter.
 */
export async function shopifyREST<T = unknown>(
  opts: ShopifyRestOptions
): Promise<T> {
  const { method, endpoint, body, skipCache = true } = opts;
  const url = `${getShopifyBaseUrl()}${endpoint}`;
  const cacheKey = `shopify:${method}:${endpoint}`;

  return cachedApiCall<T>(
    cacheKey,
    async () => {
      const token = await getShopifyToken();

      const fetchOpts: RequestInit = {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
      };

      if (body && (method === "POST" || method === "PUT")) {
        fetchOpts.body = JSON.stringify(body);
      }

      const response = await fetch(url, fetchOpts);

      if (!response.ok) {
        const errorText = await response.text();
        const error: any = new Error(
          `[Shopify] ${method} ${endpoint} failed (${response.status}): ${errorText}`
        );
        error.status = response.status;
        throw error;
      }

      // DELETE requests may return 200 with empty body
      const text = await response.text();
      if (!text) return {} as T;

      return JSON.parse(text) as T;
    },
    { limiter: shopifyLimiter, skipCache }
  );
}

// --- Article CRUD ---

interface ShopifyArticleInput {
  title: string;
  body_html: string;
  tags?: string;
  published?: boolean;
  metafields?: Array<{
    key: string;
    value: string;
    type: string;
    namespace: string;
  }>;
}

interface ShopifyArticle {
  id: number;
  title: string;
  body_html: string;
  blog_id: number;
  published_at: string | null;
  tags: string;
  created_at: string;
  updated_at: string;
  summary_html: string | null;
  handle: string;
}

interface ShopifyArticleResponse {
  article: ShopifyArticle;
}

interface ShopifyArticlesListResponse {
  articles: ShopifyArticle[];
}

/**
 * Create a draft article on a Shopify blog.
 */
export async function createShopifyArticle(
  blogId: number,
  article: ShopifyArticleInput
): Promise<ShopifyArticle> {
  const metafields = article.metafields || [];

  const payload: Record<string, unknown> = {
    article: {
      title: article.title,
      body_html: article.body_html,
      tags: article.tags || "",
      published: article.published ?? false, // default to draft
      metafields: metafields.length > 0 ? metafields : undefined,
    },
  };

  const result = await shopifyREST<ShopifyArticleResponse>({
    method: "POST",
    endpoint: `/blogs/${blogId}/articles.json`,
    body: payload,
  });

  return result.article;
}

/**
 * Update an existing Shopify article.
 */
export async function updateShopifyArticle(
  blogId: number,
  articleId: number,
  updates: Partial<ShopifyArticleInput>
): Promise<ShopifyArticle> {
  const payload: Record<string, unknown> = {
    article: {
      id: articleId,
      ...updates,
    },
  };

  const result = await shopifyREST<ShopifyArticleResponse>({
    method: "PUT",
    endpoint: `/blogs/${blogId}/articles/${articleId}.json`,
    body: payload,
  });

  return result.article;
}

/**
 * Set a Shopify article to published.
 */
export async function publishShopifyArticle(
  blogId: number,
  articleId: number
): Promise<ShopifyArticle> {
  return updateShopifyArticle(blogId, articleId, {
    published: true,
  });
}

/**
 * Fetch the current state of a Shopify article.
 */
export async function getShopifyArticle(
  blogId: number,
  articleId: number
): Promise<ShopifyArticle> {
  const result = await shopifyREST<ShopifyArticleResponse>({
    method: "GET",
    endpoint: `/blogs/${blogId}/articles/${articleId}.json`,
    skipCache: false,
  });

  return result.article;
}

/**
 * List all articles on a Shopify blog.
 */
export async function listShopifyArticles(
  blogId: number,
  limit = 50
): Promise<ShopifyArticle[]> {
  const result = await shopifyREST<ShopifyArticlesListResponse>({
    method: "GET",
    endpoint: `/blogs/${blogId}/articles.json?limit=${limit}`,
    skipCache: false,
  });

  return result.articles;
}

/**
 * List available Shopify blogs.
 */
export async function listShopifyBlogs(): Promise<
  Array<{ id: number; title: string; handle: string }>
> {
  const result = await shopifyREST<{
    blogs: Array<{ id: number; title: string; handle: string }>;
  }>({
    method: "GET",
    endpoint: "/blogs.json",
    skipCache: false,
  });

  return result.blogs;
}

// --- Main Sync Functions ---

export interface SyncResult {
  success: boolean;
  blogPostId: string;
  shopifyArticleId?: number;
  shopifyBlogId?: number;
  action?: "created" | "updated";
  error?: string;
}

/**
 * Main function: Sync a single blog post to Shopify.
 * Reads blog post from DB, renders HTML via htmlRenderer,
 * creates/updates Shopify article, stores shopify_article_id back in DB.
 */
export async function syncBlogPostToShopify(
  blogPostId: string,
  targetBlogId?: number
): Promise<SyncResult> {
  try {
    // 1. Fetch blog post from DB
    const [post] = await db
      .select()
      .from(blogPosts)
      .where(eq(blogPosts.id, blogPostId));

    if (!post) {
      return {
        success: false,
        blogPostId,
        error: "Blog post not found",
      };
    }

    // 2. Render HTML
    const bodyHtml = await renderShopifyHtml(post);

    if (!bodyHtml || bodyHtml.trim().length === 0) {
      return {
        success: false,
        blogPostId,
        error: "HTML rendering produced empty output",
      };
    }

    // 3. Determine target Shopify blog
    const blogId = targetBlogId || post.shopifyBlogId || SHOPIFY_CONFIG.blogId;

    // 4. Build tags from cluster keywords
    const tags = buildTagsFromPost(post);

    // 5. Build metafields for SEO
    const metafields: ShopifyArticleInput["metafields"] = [];
    if (post.metaTitle) {
      metafields.push({
        key: "title_tag",
        value: post.metaTitle,
        type: "single_line_text_field",
        namespace: "global",
      });
    }
    if (post.metaDescription) {
      metafields.push({
        key: "description_tag",
        value: post.metaDescription,
        type: "single_line_text_field",
        namespace: "global",
      });
    }

    // 6. Create or update on Shopify
    let shopifyArticle: ShopifyArticle;
    let action: "created" | "updated";

    if (post.shopifyArticleId) {
      // Update existing article
      shopifyArticle = await updateShopifyArticle(blogId, post.shopifyArticleId, {
        title: post.title,
        body_html: bodyHtml,
        tags,
        // Don't include metafields on update -- Shopify doesn't support metafields in article PUT
      });
      action = "updated";
      console.log(
        `[Shopify] Updated article #${shopifyArticle.id}: "${post.title}"`
      );
    } else {
      // Create new article as draft
      shopifyArticle = await createShopifyArticle(blogId, {
        title: post.title,
        body_html: bodyHtml,
        tags,
        published: false,
        metafields: metafields.length > 0 ? metafields : undefined,
      });
      action = "created";
      console.log(
        `[Shopify] Created draft article #${shopifyArticle.id}: "${post.title}"`
      );
    }

    // 7. Store Shopify article ID back in DB
    const now = new Date().toISOString();
    await db
      .update(blogPosts)
      .set({
        shopifyArticleId: shopifyArticle.id,
        shopifyBlogId: blogId,
        shopifySyncedAt: now,
      })
      .where(eq(blogPosts.id, blogPostId));

    // Invalidate any cached article data
    cache.invalidate(`shopify:GET:/blogs/${blogId}/articles`);

    return {
      success: true,
      blogPostId,
      shopifyArticleId: shopifyArticle.id,
      shopifyBlogId: blogId,
      action,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error during sync";
    console.error(`[Shopify] Sync failed for post ${blogPostId}:`, message);
    return {
      success: false,
      blogPostId,
      error: message,
    };
  }
}

export interface BatchSyncProgress {
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  currentPostId?: string;
  currentPostTitle?: string;
}

/**
 * Bulk sync multiple blog posts to Shopify with rate limiting and progress tracking.
 */
export async function batchSyncToShopify(
  blogPostIds: string[],
  targetBlogId?: number,
  onProgress?: (progress: BatchSyncProgress) => void
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  const progress: BatchSyncProgress = {
    total: blogPostIds.length,
    completed: 0,
    succeeded: 0,
    failed: 0,
  };

  for (const postId of blogPostIds) {
    // Fetch post title for progress reporting
    const [post] = await db
      .select({ id: blogPosts.id, title: blogPosts.title })
      .from(blogPosts)
      .where(eq(blogPosts.id, postId));

    progress.currentPostId = postId;
    progress.currentPostTitle = post?.title || "Unknown";

    if (onProgress) {
      onProgress({ ...progress });
    }

    const result = await syncBlogPostToShopify(postId, targetBlogId);
    results.push(result);

    progress.completed++;
    if (result.success) {
      progress.succeeded++;
    } else {
      progress.failed++;
    }

    if (onProgress) {
      onProgress({ ...progress });
    }

    // Brief pause between posts to be kind to rate limiter queue
    // (the rate limiter handles the actual throttling, this just spaces them out)
    if (progress.completed < progress.total) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return results;
}

// --- Helpers ---

/**
 * Build comma-separated tags string from blog post metadata.
 */
function buildTagsFromPost(post: BlogPost): string {
  const tags: string[] = [];

  // Add "iBolt" brand tag
  tags.push("iBolt");

  // Try to extract keywords from post title
  if (post.title) {
    // Common mounting-related tags
    const titleLower = post.title.toLowerCase();
    if (titleLower.includes("mount")) tags.push("mounting");
    if (titleLower.includes("tablet")) tags.push("tablet mount");
    if (titleLower.includes("phone")) tags.push("phone mount");
    if (titleLower.includes("truck")) tags.push("trucking");
    if (titleLower.includes("forklift")) tags.push("forklift");
    if (titleLower.includes("boat") || titleLower.includes("fish"))
      tags.push("marine");
    if (titleLower.includes("restaurant") || titleLower.includes("pos"))
      tags.push("restaurant");
    if (titleLower.includes("farm") || titleLower.includes("agriculture"))
      tags.push("agriculture");
  }

  return tags.join(", ");
}

/**
 * Get available Shopify blog targets with their IDs.
 */
export function getShopifyBlogTargets() {
  return [
    {
      id: SHOPIFY_CONFIG.blogId,
      name: "News",
      handle: "news",
    },
    {
      id: SHOPIFY_CONFIG.fishFinderBlogId,
      name: "How to Mount a Fish Finder",
      handle: "how-to-mount-a-fish-finder",
    },
  ];
}
