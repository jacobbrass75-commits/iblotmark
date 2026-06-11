import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { companyScopedUrl, useActiveCompanyId } from "@/lib/company";

function invalidateContextQueries() {
  queryClient.invalidateQueries({
    predicate: (query) => String(query.queryKey[0] || "").startsWith("/api/blog/context"),
  });
  queryClient.invalidateQueries({ queryKey: [companyScopedUrl("/api/blog/company/setup-status")] });
}

export function useVerticals() {
  const activeCompanyId = useActiveCompanyId();
  return useQuery<any[]>({
    queryKey: [companyScopedUrl("/api/blog/context/verticals")],
    enabled: Boolean(activeCompanyId),
  });
}

export function useVertical(id: string) {
  const activeCompanyId = useActiveCompanyId();
  return useQuery<any>({
    queryKey: [companyScopedUrl(`/api/blog/context/verticals/${id}`)],
    enabled: Boolean(activeCompanyId && id),
  });
}

export function useContextEntries(verticalId: string, includeUnverified = true) {
  const activeCompanyId = useActiveCompanyId();
  return useQuery<any[]>({
    queryKey: [companyScopedUrl(`/api/blog/context/entries/${verticalId}`, { includeUnverified })],
    enabled: Boolean(activeCompanyId && verticalId),
  });
}

export function useAddContextEntry() {
  return useMutation({
    mutationFn: async (data: { verticalId: string; category: string; content: string }) => {
      const res = await apiRequest("POST", "/api/blog/context/entries", data);
      return res.json();
    },
    onSuccess: () => {
      invalidateContextQueries();
    },
  });
}

export function useVerifyEntry() {
  return useMutation({
    mutationFn: async ({ id, verified }: { id: string; verified: boolean }) => {
      const res = await apiRequest("PATCH", `/api/blog/context/entries/${id}/verify`, { verified });
      return res.json();
    },
    onSuccess: () => {
      invalidateContextQueries();
    },
  });
}

export function useDeleteEntry() {
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/blog/context/entries/${id}`);
      return res.json();
    },
    onSuccess: () => {
      invalidateContextQueries();
    },
  });
}

export function useResearchJobs() {
  const activeCompanyId = useActiveCompanyId();
  return useQuery<any[]>({
    queryKey: [companyScopedUrl("/api/blog/context/research/jobs")],
    enabled: Boolean(activeCompanyId),
  });
}
