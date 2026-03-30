import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

export function useBlogPosts(status?: string) {
  const url = status ? `/api/blog/posts?status=${status}` : "/api/blog/posts";
  return useQuery<any[]>({ queryKey: [url] });
}

export function useBlogPost(id: string) {
  return useQuery<any>({
    queryKey: ["/api/blog/posts", id],
    enabled: !!id,
  });
}

export function useUpdateBlogPost() {
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string; [key: string]: any }) => {
      const res = await apiRequest("PATCH", `/api/blog/posts/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blog/posts"] });
    },
  });
}

export function useBatches() {
  return useQuery<any[]>({ queryKey: ["/api/blog/batches"] });
}
