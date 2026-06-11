import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { companyScopedUrl, getRequiredCompanyScopedHeaders, useActiveCompanyId } from "@/lib/company";

function invalidateCatalogQueries() {
  queryClient.invalidateQueries({
    predicate: (query) => String(query.queryKey[0] || "").startsWith("/api/blog/catalog"),
  });
  queryClient.invalidateQueries({ queryKey: [companyScopedUrl("/api/blog/company/setup-status")] });
}

export function useCatalogImports() {
  const activeCompanyId = useActiveCompanyId();
  return useQuery<any[]>({
    queryKey: [companyScopedUrl("/api/blog/catalog/imports")],
    enabled: Boolean(activeCompanyId),
  });
}

export function useCatalogExtractions(importId: string) {
  const activeCompanyId = useActiveCompanyId();
  return useQuery<any[]>({
    queryKey: [companyScopedUrl(`/api/blog/catalog/imports/${importId}/extractions`)],
    enabled: Boolean(activeCompanyId && importId),
  });
}

export function useImportCatalog() {
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/blog/catalog/import", {
        method: "POST",
        headers: getRequiredCompanyScopedHeaders(),
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      invalidateCatalogQueries();
    },
  });
}
