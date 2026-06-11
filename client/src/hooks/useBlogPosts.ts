import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { companyScopedUrl, useActiveCompanyId } from "@/lib/company";

function invalidatePostQueries(postId?: string) {
  queryClient.invalidateQueries({
    predicate: (query) => {
      const key = String(query.queryKey[0] || "");
      if (!key.startsWith("/api/blog/posts")) return false;
      return !postId || key.includes(`/api/blog/posts/${postId}`);
    },
  });
}

export function useBlogPosts(status?: string) {
  const activeCompanyId = useActiveCompanyId();
  const url = companyScopedUrl("/api/blog/posts", { status });
  return useQuery<any[]>({ queryKey: [url], enabled: Boolean(activeCompanyId) });
}

export function useBlogPost(id: string) {
  const activeCompanyId = useActiveCompanyId();
  return useQuery<any>({
    queryKey: [companyScopedUrl(`/api/blog/posts/${id}`)],
    enabled: Boolean(activeCompanyId && id),
  });
}

export function useUpdateBlogPost() {
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string; [key: string]: any }) => {
      const res = await apiRequest("PATCH", `/api/blog/posts/${id}`, data);
      return res.json();
    },
    onSuccess: (_data, variables) => {
      invalidatePostQueries(variables.id);
      invalidatePostQueries();
    },
  });
}

export function usePostPhotos(postId: string) {
  const activeCompanyId = useActiveCompanyId();
  return useQuery<any[]>({
    queryKey: [companyScopedUrl(`/api/blog/posts/${postId}/photos`)],
    enabled: Boolean(activeCompanyId && postId),
  });
}

export function useAddPostPhoto() {
  return useMutation({
    mutationFn: async ({ postId, ...data }: { postId: string; [key: string]: any }) => {
      const res = await apiRequest("POST", `/api/blog/posts/${postId}/photos`, data);
      return res.json();
    },
    onSuccess: (_data, variables) => {
      invalidatePostQueries(variables.postId);
    },
  });
}

export function useDeletePostPhoto() {
  return useMutation({
    mutationFn: async ({ postId, selectionId }: { postId: string; selectionId: string }) => {
      const res = await apiRequest("DELETE", `/api/blog/posts/${postId}/photos/${selectionId}`);
      return res.json();
    },
    onSuccess: (_data, variables) => {
      invalidatePostQueries(variables.postId);
    },
  });
}

export function useBatches() {
  const activeCompanyId = useActiveCompanyId();
  return useQuery<any[]>({
    queryKey: [companyScopedUrl("/api/blog/batches")],
    enabled: Boolean(activeCompanyId),
  });
}
