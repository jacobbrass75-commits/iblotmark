import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

export function usePhotos(productId?: string) {
  const url = productId ? `/api/blog/photos?productId=${productId}` : "/api/blog/photos";
  return useQuery<any[]>({ queryKey: [url] });
}

export function usePhotoStats() {
  return useQuery<{ total: number; analyzed: number; unanalyzed: number; unassigned: number }>({
    queryKey: ["/api/blog/photos/stats"],
  });
}

export function useUploadPhotos() {
  return useMutation({
    mutationFn: async ({ files, productId }: { files: FileList; productId?: string }) => {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append("files", files[i]);
      }
      if (productId) formData.append("productId", productId);
      const res = await fetch("/api/blog/photos/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blog/photos"] });
    },
  });
}

export function useAnalyzePhoto() {
  return useMutation({
    mutationFn: async (photoId: string) => {
      const res = await apiRequest("POST", `/api/blog/photos/${photoId}/analyze`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blog/photos"] });
    },
  });
}

export function useAutoAssociate() {
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/blog/photos/auto-associate");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blog/photos"] });
    },
  });
}

export function useDeletePhoto() {
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/blog/photos/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blog/photos"] });
    },
  });
}
