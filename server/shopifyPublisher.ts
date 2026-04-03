// Shopify Publisher — pushes blog posts and collection content to iboltmounts.myshopify.com
// Uses Dev Dashboard app (iboltblog) with client credentials grant.

import { eq } from "drizzle-orm";
import { blogPosts } from "@shared/schema";
import { db } from "./db";
import { renderShopifyHtml } from "./htmlRenderer";

const SHOPIFY_SHOP = process.env.SHOPIFY_SHOP || "iboltmounts";
const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID || "";
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET || "";
const SHOPIFY_API_VERSION = "2025-01";
const SHOPIFY_NEWS_BLOG_ID = 104843772196;
const SHOPIFY_FISH_FINDER_BLOG_ID = 110121517348;

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

export async function getShopifyToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  if (!SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
    throw new Error(
      "SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET must be set in environment"
    );
  }

  const response = await fetch(
    `https://${SHOPIFY_SHOP}.myshopify.com/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: SHOPIFY_CLIENT_ID,
        client_secret: SHOPIFY_CLIENT_SECRET,
      }).toString(),
    }
  );

  if (!response.ok) {
    throw new Error(`Shopify token request failed: ${response.status}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in || 86400) * 1000;
  return cachedToken!;
}

async function shopifyREST(
  method: string,
  endpoint: string,
  body?: any
): Promise<any> {
  const token = await getShopifyToken();
  const url = `https://${SHOPIFY_SHOP}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/${endpoint}`;
  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Shopify API ${method} ${endpoint} failed: ${r.status} ${text}`);
  }
  if (method === "DELETE") return { success: true };
  return await r.json();
}

// --- Blog Post Operations ---

export interface ShopifyArticle {
  id: number;
  title: string;
  body_html: string;
  published: boolean;
  tags: string;
  handle?: string;
  published_at?: string | null;
  updated_at?: string;
  metafields?: Array<{
    namespace: string;
    key: string;
    value: string;
    type: string;
  }>;
}

export interface ShopifyBlog {
  id: number;
  title: string;
  handle: string;
}

export interface ShopifyBlogTarget {
  id: number;
  name: string;
  handle: string;
}

export interface SyncResult {
  success: boolean;
  blogPostId: string;
  action?: "created" | "updated";
  shopifyArticleId?: number;
  shopifyBlogId?: number;
  syncedAt?: string;
  adminUrl?: string;
  error?: string;
}

export interface BatchSyncProgress {
  current: number;
  total: number;
  blogPostId: string;
  title?: string;
  success: boolean;
  action?: "created" | "updated";
  shopifyArticleId?: number;
  error?: string;
}

export async function publishBlogPost(opts: {
  title: string;
  bodyHtml: string;
  tags?: string;
  metaTitle?: string;
  metaDescription?: string;
  published?: boolean;
  blogId?: number;
}): Promise<{ articleId: number; adminUrl: string }> {
  const blogId = opts.blogId || SHOPIFY_NEWS_BLOG_ID;
  const metafields: any[] = [];

  if (opts.metaTitle) {
    metafields.push({
      namespace: "global",
      key: "title_tag",
      value: opts.metaTitle,
      type: "single_line_text_field",
    });
  }
  if (opts.metaDescription) {
    metafields.push({
      namespace: "global",
      key: "description_tag",
      value: opts.metaDescription,
      type: "single_line_text_field",
    });
  }

  const result = await shopifyREST(
    "POST",
    `blogs/${blogId}/articles.json`,
    {
      article: {
        title: opts.title,
        body_html: opts.bodyHtml,
        published: opts.published ?? false,
        tags: opts.tags || "",
        ...(metafields.length > 0 ? { metafields } : {}),
      },
    }
  );

  const articleId = result.article.id;
  return {
    articleId,
    adminUrl: `https://admin.shopify.com/store/${SHOPIFY_SHOP}/articles/${articleId}`,
  };
}

export async function updateShopifyArticle(
  articleId: number,
  updates: {
    title?: string;
    bodyHtml?: string;
    tags?: string;
    published?: boolean;
  }
): Promise<void> {
  const article: any = { id: articleId };
  if (updates.title !== undefined) article.title = updates.title;
  if (updates.bodyHtml !== undefined) article.body_html = updates.bodyHtml;
  if (updates.tags !== undefined) article.tags = updates.tags;
  if (updates.published !== undefined) article.published = updates.published;

  await shopifyREST("PUT", `articles/${articleId}.json`, { article });
}

export async function deleteShopifyArticle(articleId: number): Promise<void> {
  await shopifyREST("DELETE", `articles/${articleId}.json`);
}

export async function listShopifyArticles(
  blogId?: number,
  limit = 50
): Promise<ShopifyArticle[]> {
  const id = blogId || SHOPIFY_NEWS_BLOG_ID;
  const result = await shopifyREST(
    "GET",
    `blogs/${id}/articles.json?limit=${limit}`
  );
  return result.articles;
}

export function getShopifyBlogTargets(): ShopifyBlogTarget[] {
  return [
    {
      id: SHOPIFY_NEWS_BLOG_ID,
      name: "News",
      handle: "news",
    },
    {
      id: SHOPIFY_FISH_FINDER_BLOG_ID,
      name: "Fish Finder",
      handle: "fish-finder",
    },
  ];
}

export async function listShopifyBlogs(): Promise<ShopifyBlog[]> {
  const result = await shopifyREST("GET", "blogs.json?limit=50");
  return (result.blogs || []).map((blog: any) => ({
    id: blog.id,
    title: blog.title,
    handle: blog.handle,
  }));
}

export async function getShopifyArticle(
  blogId: number,
  articleId: number
): Promise<ShopifyArticle> {
  const result = await shopifyREST(
    "GET",
    `blogs/${blogId}/articles/${articleId}.json`
  );
  return result.article;
}

function buildPostTags(post: {
  verticalId?: string | null;
  slug?: string | null;
}): string {
  const tags = ["ibolt-blog"];
  if (post.verticalId) tags.push(post.verticalId);
  if (post.slug) tags.push(post.slug);
  return tags.join(", ");
}

export async function syncBlogPostToShopify(
  blogPostId: string,
  blogId?: number
): Promise<SyncResult> {
  const [post] = await db
    .select()
    .from(blogPosts)
    .where(eq(blogPosts.id, blogPostId))
    .limit(1);

  if (!post) {
    return {
      success: false,
      blogPostId,
      error: "Blog post not found",
    };
  }

  if (!post.markdown && !post.html) {
    return {
      success: false,
      blogPostId,
      error: "Blog post has no content to publish",
    };
  }

  const targetBlogId = blogId || post.shopifyBlogId || SHOPIFY_NEWS_BLOG_ID;
  const html = post.html || (await renderShopifyHtml(post));
  const syncedAt = new Date().toISOString();

  try {
    if (post.shopifyArticleId) {
      await updateShopifyArticle(post.shopifyArticleId, {
        title: post.title,
        bodyHtml: html,
        tags: buildPostTags(post),
      });

      await db
        .update(blogPosts)
        .set({
          html,
          shopifyBlogId: targetBlogId,
          shopifySyncedAt: syncedAt,
          updatedAt: new Date(),
        })
        .where(eq(blogPosts.id, blogPostId));

      return {
        success: true,
        blogPostId,
        action: "updated",
        shopifyArticleId: post.shopifyArticleId,
        shopifyBlogId: targetBlogId,
        syncedAt,
      };
    }

    const published = await publishBlogPost({
      title: post.title,
      bodyHtml: html,
      tags: buildPostTags(post),
      metaTitle: post.metaTitle || undefined,
      metaDescription: post.metaDescription || undefined,
      published: false,
      blogId: targetBlogId,
    });

    await db
      .update(blogPosts)
      .set({
        html,
        status: "published",
        shopifyArticleId: published.articleId,
        shopifyBlogId: targetBlogId,
        shopifySyncedAt: syncedAt,
        updatedAt: new Date(),
      })
      .where(eq(blogPosts.id, blogPostId));

    return {
      success: true,
      blogPostId,
      action: "created",
      shopifyArticleId: published.articleId,
      shopifyBlogId: targetBlogId,
      syncedAt,
      adminUrl: published.adminUrl,
    };
  } catch (error) {
    return {
      success: false,
      blogPostId,
      error: error instanceof Error ? error.message : "Unknown Shopify sync error",
    };
  }
}

export async function batchSyncToShopify(
  blogPostIds: string[],
  blogId?: number,
  onProgress?: (progress: BatchSyncProgress) => void
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];

  for (let index = 0; index < blogPostIds.length; index += 1) {
    const blogPostId = blogPostIds[index];
    const result = await syncBlogPostToShopify(blogPostId, blogId);
    results.push(result);

    onProgress?.({
      current: index + 1,
      total: blogPostIds.length,
      blogPostId,
      title: undefined,
      success: result.success,
      action: result.action,
      shopifyArticleId: result.shopifyArticleId,
      error: result.error,
    });
  }

  return results;
}

// --- Collection Operations ---

export async function updateCollectionDescription(
  collectionId: number,
  bodyHtml: string
): Promise<void> {
  await shopifyREST("PUT", `custom_collections/${collectionId}.json`, {
    custom_collection: { id: collectionId, body_html: bodyHtml },
  });
}

export async function listCollections(): Promise<
  Array<{ id: number; title: string; handle: string }>
> {
  const result = await shopifyREST(
    "GET",
    "custom_collections.json?limit=250"
  );
  return result.custom_collections.map((c: any) => ({
    id: c.id,
    title: c.title,
    handle: c.handle,
  }));
}

// --- Page Operations ---

export async function updatePage(
  pageId: number,
  bodyHtml: string
): Promise<void> {
  await shopifyREST("PUT", `pages/${pageId}.json`, {
    page: { id: pageId, body_html: bodyHtml },
  });
}

export async function listPages(): Promise<
  Array<{ id: number; title: string; handle: string }>
> {
  const result = await shopifyREST("GET", "pages.json?limit=50");
  return result.pages.map((p: any) => ({
    id: p.id,
    title: p.title,
    handle: p.handle,
  }));
}

// --- Health Check ---

export async function checkShopifyConnection(): Promise<{
  connected: boolean;
  shopName?: string;
  error?: string;
}> {
  try {
    const token = await getShopifyToken();
    const r = await fetch(
      `https://${SHOPIFY_SHOP}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/shop.json`,
      { headers: { "X-Shopify-Access-Token": token } }
    );
    if (r.ok) {
      const data = await r.json();
      return { connected: true, shopName: data.shop.name };
    }
    return { connected: false, error: `Status ${r.status}` };
  } catch (e: any) {
    return { connected: false, error: e.message };
  }
}
