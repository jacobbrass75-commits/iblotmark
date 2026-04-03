import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

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
      // Invalidate the blog posts list and the specific post
      queryClient.invalidateQueries({ queryKey: ["/api/blog/posts"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/blog/posts", variables.postId],
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/blog/shopify/posts/${variables.postId}/status`],
      });
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
        headers: { "Content-Type": "application/json" },
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
      queryClient.invalidateQueries({ queryKey: ["/api/blog/posts"] });
    },
  });
}

/**
 * Query for Shopify sync status of a specific post.
 */
export function useShopifyStatus(postId: string) {
  return useQuery<ShopifyStatus>({
    queryKey: [`/api/blog/shopify/posts/${postId}/status`],
    enabled: !!postId,
    staleTime: 30_000, // 30 seconds
  });
}

/**
 * Query to list available Shopify blogs.
 */
export function useShopifyBlogs() {
  return useQuery<ShopifyBlogsResponse>({
    queryKey: ["/api/blog/shopify/blogs"],
    staleTime: 5 * 60_000, // 5 minutes
  });
}
