import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { companyScopedUrl, useActiveCompanyId } from "@/lib/company";

function invalidateBenchmarkQueries() {
  queryClient.invalidateQueries({
    predicate: (query) => String(query.queryKey[0] || "").startsWith("/api/blog/benchmark"),
  });
}

export function useBenchmarkQueries() {
  const activeCompanyId = useActiveCompanyId();
  return useQuery<any[]>({
    queryKey: [companyScopedUrl("/api/blog/benchmark/queries")],
    enabled: Boolean(activeCompanyId),
  });
}

export function useBenchmarkRuns(limit = 8) {
  const activeCompanyId = useActiveCompanyId();
  return useQuery<any[]>({
    queryKey: [companyScopedUrl("/api/blog/benchmark/runs", { limit })],
    enabled: Boolean(activeCompanyId),
  });
}

export function useLatestBenchmarkSummary() {
  const activeCompanyId = useActiveCompanyId();
  return useQuery<any | null>({
    queryKey: [companyScopedUrl("/api/blog/benchmark/latest")],
    enabled: Boolean(activeCompanyId),
  });
}

export function useBenchmarkProviderStatus() {
  const activeCompanyId = useActiveCompanyId();
  return useQuery<Record<string, boolean>>({
    queryKey: [companyScopedUrl("/api/blog/benchmark/providers")],
    enabled: Boolean(activeCompanyId),
  });
}

export function useBenchmarkContentPlan(runId?: string, limit = 8) {
  const activeCompanyId = useActiveCompanyId();
  return useQuery<any[]>({
    queryKey: [companyScopedUrl("/api/blog/benchmark/content-plan", { runId, limit })],
    enabled: Boolean(activeCompanyId),
  });
}

export function useAddBenchmarkQuery() {
  return useMutation({
    mutationFn: async (data: {
      category: string;
      label?: string;
      query: string;
      verticalId?: string | null;
      benchmarkGoal?: string;
      persona?: string;
      painPoint?: string;
      brandAngle?: string;
      targetProducts?: string[];
      priority?: number;
    }) => {
      const res = await apiRequest("POST", "/api/blog/benchmark/queries", data);
      return res.json();
    },
    onSuccess: () => {
      invalidateBenchmarkQueries();
    },
  });
}

export function useAddBenchmarkQueriesBulk() {
  return useMutation({
    mutationFn: async (data: {
      category: string;
      queries: Array<string | {
        query: string;
        label?: string | null;
        persona?: string | null;
        painPoint?: string | null;
        brandAngle?: string | null;
        targetProducts?: string[];
        benchmarkGoal?: string | null;
      }>;
      benchmarkGoal?: string;
      priority?: number;
    }) => {
      const res = await apiRequest("POST", "/api/blog/benchmark/queries/bulk", data);
      return res.json();
    },
    onSuccess: () => {
      invalidateBenchmarkQueries();
    },
  });
}

export function useMaterializeContentPlan() {
  return useMutation({
    mutationFn: async (data: { item: any; generateNow?: boolean; queueForGeneration?: boolean }) => {
      const res = await apiRequest("POST", "/api/blog/benchmark/content-plan/materialize", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (query) => String(query.queryKey[0] || "").startsWith("/api/blog/keywords/clusters"),
      });
      queryClient.invalidateQueries({
        predicate: (query) => String(query.queryKey[0] || "").startsWith("/api/blog/posts"),
      });
      queryClient.invalidateQueries({
        predicate: (query) => String(query.queryKey[0] || "").startsWith("/api/blog/queue"),
      });
    },
  });
}
