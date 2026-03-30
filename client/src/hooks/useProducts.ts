import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

export function useProducts(verticalId?: string) {
  const url = verticalId ? `/api/blog/products?verticalId=${verticalId}` : "/api/blog/products";
  return useQuery<any[]>({ queryKey: [url] });
}

export function useProductStats() {
  return useQuery<{ count: number; lastScraped: string | null }>({
    queryKey: ["/api/blog/products/stats"],
  });
}

export function useScrapeProducts() {
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/blog/products/scrape");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/blog/products"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/blog/products"] });
    },
  });
}
