// Shopify Publisher — pushes company blog posts and collection content to Shopify.
// The iBolt store remains a demo/default workspace only.

import { and, eq } from "drizzle-orm";
import { blogPosts, companyIntegrations } from "@shared/schema";
import { db } from "./db";
import { renderShopifyHtml } from "./htmlRenderer";
import { DEFAULT_COMPANY_ID } from "./companyDefaults";
import { getCompanyContext, type CompanyContext } from "./companyContext";
import { decryptSecret } from "./integrationSecrets";

const SHOPIFY_SHOP = process.env.SHOPIFY_SHOP || "iboltmounts";
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const SHOPIFY_NEWS_BLOG_ID = 104843772196;
const SHOPIFY_FISH_FINDER_BLOG_ID = 110121517348;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function getShopifyConfig(companyContext?: CompanyContext | null): {
  shop: string;
  defaultBlogId: number;
  blogTargets: ShopifyBlogTarget[];
} {
  const integration = companyContext?.integrations.shopify;
  const configuredTargets = integration?.blogTargets?.length ? integration.blogTargets : [];
  const canUseDefaultWorkspaceFallback = !companyContext || companyContext.company.id === DEFAULT_COMPANY_ID;
  const fallbackTargets = [
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

  if (companyContext && !integration) {
    return {
      shop: "",
      defaultBlogId: 0,
      blogTargets: [],
    };
  }

  return {
    shop: integration?.shop || SHOPIFY_SHOP,
    defaultBlogId: integration?.defaultBlogId || configuredTargets[0]?.id || (canUseDefaultWorkspaceFallback ? SHOPIFY_NEWS_BLOG_ID : 0),
    blogTargets: configuredTargets.length > 0 ? configuredTargets : canUseDefaultWorkspaceFallback ? fallbackTargets : [],
  };
}

async function getStoredAccessToken(companyContext?: CompanyContext | null): Promise<string> {
  const integrationId = companyContext?.integrations.shopify?.id;
  if (!integrationId || !companyContext?.company.id) return "";

  const [integration] = await db
    .select({ config: companyIntegrations.config })
    .from(companyIntegrations)
    .where(and(
      eq(companyIntegrations.companyId, companyContext.company.id),
      eq(companyIntegrations.id, integrationId),
      eq(companyIntegrations.type, "shopify"),
    ))
    .limit(1);

  const encryptedAccessToken = asRecord(integration?.config).encryptedAccessToken;
  if (typeof encryptedAccessToken !== "string" || !encryptedAccessToken) return "";
  return decryptSecret(encryptedAccessToken);
}

async function getConfiguredAccessToken(companyContext?: CompanyContext | null): Promise<string> {
  const storedToken = await getStoredAccessToken(companyContext);
  if (storedToken) return storedToken;
  return "";
}

export async function getShopifyToken(companyContext?: CompanyContext | null): Promise<string> {
  const config = getShopifyConfig(companyContext);
  if (!config.shop) {
    throw new Error("Shopify integration is not configured for this company.");
  }

  const configuredToken = await getConfiguredAccessToken(companyContext);
  if (configuredToken) {
    return configuredToken;
  }

  throw new Error("Shopify access token is not configured for this company. Connect Shopify with OAuth.");
}

async function shopifyREST(
  method: string,
  endpoint: string,
  body?: any,
  companyContext?: CompanyContext | null,
): Promise<any> {
  const token = await getShopifyToken(companyContext);
  const config = getShopifyConfig(companyContext);
  const url = `https://${config.shop}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/${endpoint}`;
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
  companyContext?: CompanyContext | null;
}): Promise<{ articleId: number; adminUrl: string }> {
  const config = getShopifyConfig(opts.companyContext);
  const blogId = opts.blogId || config.defaultBlogId;
  if (!blogId) {
    throw new Error("No Shopify blog target is configured for this company.");
  }
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
    },
    opts.companyContext,
  );

  const articleId = result.article.id;
  return {
    articleId,
    adminUrl: `https://admin.shopify.com/store/${config.shop}/articles/${articleId}`,
  };
}

export async function updateShopifyArticle(
  blogId: number,
  articleId: number,
  updates: {
    title?: string;
    bodyHtml?: string;
    tags?: string;
    published?: boolean;
  },
  companyContext?: CompanyContext | null,
): Promise<void> {
  const article: any = { id: articleId };
  if (updates.title !== undefined) article.title = updates.title;
  if (updates.bodyHtml !== undefined) article.body_html = updates.bodyHtml;
  if (updates.tags !== undefined) article.tags = updates.tags;
  if (updates.published !== undefined) article.published = updates.published;

  await shopifyREST("PUT", `blogs/${blogId}/articles/${articleId}.json`, { article }, companyContext);
}

export async function deleteShopifyArticle(
  blogId: number,
  articleId: number,
  companyContext?: CompanyContext | null,
): Promise<void> {
  await shopifyREST("DELETE", `blogs/${blogId}/articles/${articleId}.json`, undefined, companyContext);
}

export async function listShopifyArticles(
  blogId?: number,
  limit = 50,
  companyContext?: CompanyContext | null,
): Promise<ShopifyArticle[]> {
  const id = blogId || getShopifyConfig(companyContext).defaultBlogId;
  if (!id) {
    throw new Error("No Shopify blog target is configured for this company.");
  }
  const result = await shopifyREST(
    "GET",
    `blogs/${id}/articles.json?limit=${limit}`,
    undefined,
    companyContext,
  );
  return result.articles;
}

export function getShopifyBlogTargets(companyContext?: CompanyContext | null): ShopifyBlogTarget[] {
  return getShopifyConfig(companyContext).blogTargets;
}

export async function listShopifyBlogs(companyContext?: CompanyContext | null): Promise<ShopifyBlog[]> {
  const result = await shopifyREST("GET", "blogs.json?limit=50", undefined, companyContext);
  return (result.blogs || []).map((blog: any) => ({
    id: blog.id,
    title: blog.title,
    handle: blog.handle,
  }));
}

export async function getShopifyArticle(
  blogId: number,
  articleId: number,
  companyContext?: CompanyContext | null,
): Promise<ShopifyArticle> {
  const result = await shopifyREST(
    "GET",
    `blogs/${blogId}/articles/${articleId}.json`,
    undefined,
    companyContext,
  );
  return result.article;
}

function buildPostTags(post: {
  verticalId?: string | null;
  slug?: string | null;
}, companyContext?: CompanyContext | null): string {
  const companyTag = companyContext?.company.name
    ? `${companyContext.company.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-blog`
    : "generated-blog";
  const tags = [companyTag, "generated-blog"];
  if (post.verticalId) tags.push(post.verticalId);
  if (post.slug) tags.push(post.slug);
  return tags.join(", ");
}

export async function syncBlogPostToShopify(
  blogPostId: string,
  blogId?: number,
  companyId?: string,
): Promise<SyncResult> {
  const companyContext = await getCompanyContext(companyId || DEFAULT_COMPANY_ID);
  const [post] = await db
    .select()
    .from(blogPosts)
    .where(and(eq(blogPosts.companyId, companyContext.company.id), eq(blogPosts.id, blogPostId)))
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

  const targetBlogId = blogId || post.shopifyBlogId || getShopifyConfig(companyContext).defaultBlogId;
  if (!targetBlogId) {
    return {
      success: false,
      blogPostId,
      error: "No Shopify blog target is configured for this company.",
    };
  }
  // Markdown is the editable source of truth. Always re-render it so saved edits,
  // selected assets, product links, and structured data cannot be bypassed by stale HTML.
  const html = post.markdown
    ? await renderShopifyHtml(post, companyContext)
    : post.html!;
  const syncedAt = new Date().toISOString();

  try {
    if (post.shopifyArticleId) {
      await updateShopifyArticle(targetBlogId, post.shopifyArticleId, {
        title: post.title,
        bodyHtml: html,
        tags: buildPostTags(post, companyContext),
      }, companyContext);

      await db
        .update(blogPosts)
        .set({
          html,
          shopifyBlogId: targetBlogId,
          shopifySyncedAt: syncedAt,
          updatedAt: new Date(),
        })
        .where(and(eq(blogPosts.companyId, companyContext.company.id), eq(blogPosts.id, blogPostId)));

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
      tags: buildPostTags(post, companyContext),
      metaTitle: post.metaTitle || undefined,
      metaDescription: post.metaDescription || undefined,
      published: false,
      blogId: targetBlogId,
      companyContext,
    });

    await db
      .update(blogPosts)
      .set({
        html,
        status: post.status === "published" ? "published" : "approved",
        shopifyArticleId: published.articleId,
        shopifyBlogId: targetBlogId,
        shopifySyncedAt: syncedAt,
        updatedAt: new Date(),
      })
      .where(and(eq(blogPosts.companyId, companyContext.company.id), eq(blogPosts.id, blogPostId)));

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
  onProgress?: (progress: BatchSyncProgress) => void,
  companyId?: string,
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];

  for (let index = 0; index < blogPostIds.length; index += 1) {
    const blogPostId = blogPostIds[index];
    const result = await syncBlogPostToShopify(blogPostId, blogId, companyId);
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
  bodyHtml: string,
  companyContext?: CompanyContext | null,
): Promise<void> {
  await shopifyREST("PUT", `custom_collections/${collectionId}.json`, {
    custom_collection: { id: collectionId, body_html: bodyHtml },
  }, companyContext);
}

export async function listCollections(companyContext?: CompanyContext | null): Promise<
  Array<{ id: number; title: string; handle: string }>
> {
  const result = await shopifyREST(
    "GET",
    "custom_collections.json?limit=250",
    undefined,
    companyContext,
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
  bodyHtml: string,
  companyContext?: CompanyContext | null,
): Promise<void> {
  await shopifyREST("PUT", `pages/${pageId}.json`, {
    page: { id: pageId, body_html: bodyHtml },
  }, companyContext);
}

export async function listPages(companyContext?: CompanyContext | null): Promise<
  Array<{ id: number; title: string; handle: string }>
> {
  const result = await shopifyREST("GET", "pages.json?limit=50", undefined, companyContext);
  return result.pages.map((p: any) => ({
    id: p.id,
    title: p.title,
    handle: p.handle,
  }));
}

// --- Health Check ---

export async function checkShopifyConnection(companyContext?: CompanyContext | null): Promise<{
  connected: boolean;
  shopName?: string;
  error?: string;
}> {
  try {
    const token = await getShopifyToken(companyContext);
    const config = getShopifyConfig(companyContext);
    const r = await fetch(
      `https://${config.shop}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/shop.json`,
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
