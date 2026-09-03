import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { companyScopedUrl, getRequiredCompanyScopedHeaders, useActiveCompanyId } from "@/lib/company";

interface ShopifyPublishResult {
  success: boolean;
  blogPostId: string;
  shopifyArticleId?: number;
  shopifyBlogId?: number;
  action?: "created" | "updated";
  error?: string;
  message?: string;
}

interface ShopifyStatus {
  blogPostId: string;
  title: string;
  localStatus: string;
  shopifyArticleId: number | null;
  shopifyBlogId: number | null;
  shopifySyncedAt: string | null;
  isSynced: boolean;
  shopifyStatus?: "published" | "draft" | "not_synced" | "unknown";
  shopifyPublishedAt?: string | null;
  shopifyUpdatedAt?: string | null;
  shopifyHandle?: string;
  shopifyFetchError?: string;
}

interface ShopifyBlog {
  id: number;
  title: string;
  handle: string;
  isDefault?: boolean;
}

interface ShopifyBlogsResponse {
  blogs: ShopifyBlog[];
  note?: string;
}

export interface ShopifyArticle {
  id: number | string;
  title: string;
  handle?: string;
  public_url?: string;
  published: boolean;
  published_at?: string | null;
  updated_at?: string;
}

interface ShopifyArticlesResponse {
  articles: ShopifyArticle[];
  blogUrl?: string | null;
  source?: "shopify-admin" | "public-feed";
}

function invalidateShopifyQueries(postId?: string) {
  queryClient.invalidateQueries({
    predicate: (query) => {
      const key = String(query.queryKey[0] || "");
      if (key.startsWith("/api/blog/shopify")) {
        return !postId || key.includes(`/api/blog/shopify/posts/${postId}/`);
      }
      if (key.startsWith("/api/blog/posts")) {
        return !postId || key.includes(`/api/blog/posts/${postId}`) || key.startsWith("/api/blog/posts?");
      }
      return false;
    },
  });
}

/**
 * Mutation to publish a single blog post to Shopify.
 */
export function usePublishToShopify() {
  return useMutation<
    ShopifyPublishResult,
    Error,
    { postId: string; blogId?: number }
  >({
    mutationFn: async ({ postId, blogId }) => {
      const res = await apiRequest(
        "POST",
        `/api/blog/shopify/posts/${postId}/publish`,
        blogId ? { blogId } : undefined
      );
      return res.json();
    },
    onSuccess: (_data, variables) => {
      invalidateShopifyQueries(variables.postId);
    },
  });
}

/**
 * Mutation for bulk publishing posts to Shopify.
 * Returns results for each post in the batch.
 */
export function useBatchPublishToShopify() {
  return useMutation<
    ShopifyPublishResult[],
    Error,
    { postIds: string[]; blogId?: number }
  >({
    mutationFn: async ({ postIds, blogId }) => {
      // Use SSE for batch publish to get progress updates
      const res = await fetch("/api/blog/shopify/posts/batch-publish", {
        method: "POST",
        headers: getRequiredCompanyScopedHeaders({ "Content-Type": "application/json" }),
        credentials: "include",
        body: JSON.stringify({ postIds, blogId }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }

      // Parse SSE response -- collect the final "complete" event
      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let results: ShopifyPublishResult[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const event of events) {
          const dataMatch = event.match(/^data: (.+)$/m);
          if (dataMatch) {
            try {
              const data = JSON.parse(dataMatch[1]);
              if (data.results) {
                results = data.results;
              }
            } catch {
              // Skip malformed events
            }
          }
        }
      }

      return results;
    },
    onSuccess: () => {
      invalidateShopifyQueries();
    },
  });
}

/**
 * Query for Shopify sync status of a specific post.
 */
export function useShopifyStatus(postId: string) {
  const activeCompanyId = useActiveCompanyId();
  return useQuery<ShopifyStatus>({
    queryKey: [companyScopedUrl(`/api/blog/shopify/posts/${postId}/status`)],
    enabled: Boolean(activeCompanyId && postId),
    staleTime: 30_000, // 30 seconds
  });
}

/**
 * Query to list available Shopify blogs.
 */
export function useShopifyBlogs() {
  const activeCompanyId = useActiveCompanyId();
  return useQuery<ShopifyBlogsResponse>({
    queryKey: [companyScopedUrl("/api/blog/shopify/blogs")],
    enabled: Boolean(activeCompanyId),
    staleTime: 5 * 60_000, // 5 minutes
  });
}

/**
 * Query the connected store directly so the dashboard reflects what is
 * actually live even when an article was created outside the local post table.
 */
export function useShopifyArticles() {
  const activeCompanyId = useActiveCompanyId();
  return useQuery<ShopifyArticlesResponse>({
    queryKey: [companyScopedUrl("/api/blog/shopify/articles")],
    enabled: Boolean(activeCompanyId),
    staleTime: 60_000,
  });
}
