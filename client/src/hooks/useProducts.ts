import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { companyScopedUrl, getRequiredCompanyScopedHeaders, useActiveCompanyId } from "@/lib/company";

function invalidateProductQueries() {
  queryClient.invalidateQueries({
    predicate: (query) => String(query.queryKey[0] || "").startsWith("/api/blog/products"),
  });
  queryClient.invalidateQueries({ queryKey: [companyScopedUrl("/api/blog/company/setup-status")] });
}

export function useProducts(verticalId?: string) {
  const activeCompanyId = useActiveCompanyId();
  const url = companyScopedUrl("/api/blog/products", { verticalId });
  return useQuery<any[]>({ queryKey: [url], enabled: Boolean(activeCompanyId) });
}

export function useProductStats() {
  const activeCompanyId = useActiveCompanyId();
  return useQuery<{ count: number; lastScraped: string | null }>({
    queryKey: [companyScopedUrl("/api/blog/products/stats")],
    enabled: Boolean(activeCompanyId),
  });
}

export function useScrapeProducts() {
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/blog/products/scrape");
      return res.json();
    },
    onSuccess: () => {
      invalidateProductQueries();
    },
  });
}

export function useMapVerticals() {
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/blog/products/map-verticals");
      return res.json();
    },
    onSuccess: () => {
      invalidateProductQueries();
    },
  });
}

export function useImportProductsCsv() {
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/blog/products/import-csv", {
        method: "POST",
        headers: getRequiredCompanyScopedHeaders(),
        body: form,
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      invalidateProductQueries();
    },
  });
}

export function useImportProductUrl() {
  return useMutation({
    mutationFn: async (url: string) => {
      const res = await apiRequest("POST", "/api/blog/products/import-url", { url });
      return res.json();
    },
    onSuccess: () => {
      invalidateProductQueries();
    },
  });
}
