import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

export function useKeywords(status?: string) {
  const url = status ? `/api/blog/keywords?status=${status}` : "/api/blog/keywords";
  return useQuery<any[]>({ queryKey: [url] });
}

export function useClusters() {
  return useQuery<any[]>({ queryKey: ["/api/blog/keywords/clusters"] });
}

export function useImports() {
  return useQuery<any[]>({ queryKey: ["/api/blog/keywords/imports"] });
}

export function useImportKeywords() {
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/blog/keywords/import", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blog/keywords"] });
      queryClient.invalidateQueries({ queryKey: ["/api/blog/keywords/imports"] });
    },
  });
}

export function useClusterKeywords() {
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/blog/keywords/cluster");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blog/keywords"] });
      queryClient.invalidateQueries({ queryKey: ["/api/blog/keywords/clusters"] });
    },
  });
}
