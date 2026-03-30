import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

export function useVerticals() {
  return useQuery<any[]>({ queryKey: ["/api/blog/context/verticals"] });
}

export function useVertical(id: string) {
  return useQuery<any>({
    queryKey: ["/api/blog/context/verticals", id],
    enabled: !!id,
  });
}

export function useContextEntries(verticalId: string, includeUnverified = true) {
  return useQuery<any[]>({
    queryKey: [`/api/blog/context/entries/${verticalId}?includeUnverified=${includeUnverified}`],
    enabled: !!verticalId,
  });
}

export function useAddContextEntry() {
  return useMutation({
    mutationFn: async (data: { verticalId: string; category: string; content: string }) => {
      const res = await apiRequest("POST", "/api/blog/context/entries", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blog/context"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/blog/context"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/blog/context"] });
    },
  });
}

export function useResearchJobs() {
  return useQuery<any[]>({ queryKey: ["/api/blog/context/research/jobs"] });
}
