import { useMutation, useQuery } from "@tanstack/react-query";
import { companyScopedUrl, useActiveCompanyId } from "@/lib/company";
import { apiRequest, queryClient } from "@/lib/queryClient";

export interface InventoryProduct {
  id: string;
  title: string;
  handle: string;
  sku?: string | null;
  imageUrl?: string | null;
  price?: string | null;
}

export interface InventoryCount {
  id: string;
  binId: string;
  productId?: string | null;
  sku?: string | null;
  productTitle: string;
  totalWeightOz: number;
  emptyBinWeightOz: number;
  unitWeightOz: number;
  netWeightOz: number;
  rawQuantity: number;
  quantity: number;
  roundingMode: "nearest" | "floor" | "ceil";
  countedBy?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface InventoryBin {
  id: string;
  companyId: string;
  productId?: string | null;
  sku?: string | null;
  productTitle: string;
  binLabel: string;
  qrCode: string;
  unitWeightOz: number;
  emptyBinWeightOz: number;
  location?: string | null;
  notes?: string | null;
  status: "active" | "archived";
  lastQuantity?: number | null;
  lastCountAt?: string | null;
  createdAt: string;
  updatedAt: string;
  product?: InventoryProduct | null;
  lastCount?: InventoryCount | null;
}

export interface InventoryCalculation {
  bin: InventoryBin;
  totalWeightOz: number;
  emptyBinWeightOz: number;
  unitWeightOz: number;
  netWeightOz: number;
  rawQuantity: number;
  quantity: number;
  roundingMode: "nearest" | "floor" | "ceil";
  count?: InventoryCount | null;
}

export interface InventoryBinPayload {
  productId?: string | null;
  productTitle?: string | null;
  sku?: string | null;
  binLabel?: string | null;
  qrCode?: string | null;
  unitWeightOz?: number | string;
  emptyBinWeightOz?: number | string;
  location?: string | null;
  notes?: string | null;
}

function invalidateInventoryQueries() {
  queryClient.invalidateQueries({
    predicate: (query) => String(query.queryKey[0] || "").startsWith("/api/blog/inventory"),
  });
}

export function useInventoryBins(search = "") {
  const activeCompanyId = useActiveCompanyId();
  const url = companyScopedUrl("/api/blog/inventory/bins", { search });
  return useQuery<InventoryBin[]>({ queryKey: [url], enabled: Boolean(activeCompanyId) });
}

export function useInventoryCounts(limit = 25) {
  const activeCompanyId = useActiveCompanyId();
  const url = companyScopedUrl("/api/blog/inventory/counts", { limit });
  return useQuery<InventoryCount[]>({ queryKey: [url], enabled: Boolean(activeCompanyId) });
}

export function useCreateInventoryBin() {
  return useMutation({
    mutationFn: async (payload: InventoryBinPayload) => {
      const res = await apiRequest("POST", "/api/blog/inventory/bins", payload);
      return res.json() as Promise<InventoryBin>;
    },
    onSuccess: invalidateInventoryQueries,
  });
}

export function useUpdateInventoryBin() {
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: InventoryBinPayload & { status?: "active" | "archived" } }) => {
      const res = await apiRequest("PATCH", `/api/blog/inventory/bins/${id}`, payload);
      return res.json() as Promise<InventoryBin>;
    },
    onSuccess: invalidateInventoryQueries,
  });
}

export function useArchiveInventoryBin() {
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/blog/inventory/bins/${id}`);
      return res.json() as Promise<InventoryBin>;
    },
    onSuccess: invalidateInventoryQueries,
  });
}

export function useLookupInventoryBin() {
  return useMutation({
    mutationFn: async (code: string) => {
      const res = await apiRequest("GET", companyScopedUrl("/api/blog/inventory/lookup", { code }));
      return res.json() as Promise<InventoryBin>;
    },
  });
}

export function useCalculateInventory() {
  return useMutation({
    mutationFn: async (payload: {
      binId?: string;
      code?: string;
      totalWeight?: number | string;
      weightUnit?: "oz" | "lb";
      roundingMode?: "nearest" | "floor" | "ceil";
      save?: boolean;
      countedBy?: string | null;
      notes?: string | null;
    }) => {
      const res = await apiRequest("POST", "/api/blog/inventory/calculate", payload);
      return res.json() as Promise<InventoryCalculation>;
    },
    onSuccess: (_data, variables) => {
      if (variables.save) invalidateInventoryQueries();
    },
  });
}
