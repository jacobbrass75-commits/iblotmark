import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

export function useBenchmarkQueries() {
  return useQuery<any[]>({ queryKey: ["/api/blog/benchmark/queries"] });
}

export function useBenchmarkRuns(limit = 8) {
  return useQuery<any[]>({ queryKey: [`/api/blog/benchmark/runs?limit=${limit}`] });
}

export function useLatestBenchmarkSummary() {
  return useQuery<any | null>({ queryKey: ["/api/blog/benchmark/latest"] });
}

export function useBenchmarkContentPlan(runId?: string, limit = 8) {
  const suffix = runId ? `?runId=${runId}&limit=${limit}` : `?limit=${limit}`;
  return useQuery<any[]>({
    queryKey: [`/api/blog/benchmark/content-plan${suffix}`],
    enabled: true,
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
      priority?: number;
    }) => {
      const res = await apiRequest("POST", "/api/blog/benchmark/queries", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blog/benchmark/queries"] });
    },
  });
}

export function useAddBenchmarkQueriesBulk() {
  return useMutation({
    mutationFn: async (data: {
      category: string;
      queries: string[];
      benchmarkGoal?: string;
      priority?: number;
    }) => {
      const res = await apiRequest("POST", "/api/blog/benchmark/queries/bulk", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blog/benchmark/queries"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/blog/keywords/clusters"] });
      queryClient.invalidateQueries({ queryKey: ["/api/blog/posts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/blog/queue"] });
    },
  });
}
