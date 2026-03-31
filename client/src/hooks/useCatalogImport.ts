import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

export function useCatalogImports() {
  return useQuery<any[]>({ queryKey: ["/api/blog/catalog/imports"] });
}

export function useCatalogExtractions(importId: string) {
  return useQuery<any[]>({
    queryKey: [`/api/blog/catalog/imports/${importId}/extractions`],
    enabled: !!importId,
  });
}

export function useImportCatalog() {
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/blog/catalog/import", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blog/catalog"] });
    },
  });
}
