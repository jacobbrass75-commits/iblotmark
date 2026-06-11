import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { companyScopedUrl, getRequiredCompanyScopedHeaders, useActiveCompanyId } from "@/lib/company";

function invalidateKeywordQueries() {
  queryClient.invalidateQueries({
    predicate: (query) => String(query.queryKey[0] || "").startsWith("/api/blog/keywords"),
  });
  queryClient.invalidateQueries({ queryKey: [companyScopedUrl("/api/blog/company/setup-status")] });
}

export function useKeywords(status?: string) {
  const activeCompanyId = useActiveCompanyId();
  const url = companyScopedUrl("/api/blog/keywords", { status });
  return useQuery<any[]>({ queryKey: [url], enabled: Boolean(activeCompanyId) });
}

export function useClusters() {
  const activeCompanyId = useActiveCompanyId();
  return useQuery<any[]>({
    queryKey: [companyScopedUrl("/api/blog/keywords/clusters")],
    enabled: Boolean(activeCompanyId),
  });
}

export function useImports() {
  const activeCompanyId = useActiveCompanyId();
  return useQuery<any[]>({
    queryKey: [companyScopedUrl("/api/blog/keywords/imports")],
    enabled: Boolean(activeCompanyId),
  });
}

export function useImportKeywords() {
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/blog/keywords/import", {
        method: "POST",
        headers: getRequiredCompanyScopedHeaders(),
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      invalidateKeywordQueries();
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
      invalidateKeywordQueries();
    },
  });
}
