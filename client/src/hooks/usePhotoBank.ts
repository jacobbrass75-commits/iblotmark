import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { companyScopedUrl, getRequiredCompanyScopedHeaders, useActiveCompanyId } from "@/lib/company";

export type PhotoStats = {
  total: number;
  analyzed: number;
  unanalyzed: number;
  unassigned: number;
  approved: number;
  needsReview: number;
  restricted: number;
};

export type PhotoMetadataUpdate = {
  productId?: string | null;
  assetStatus?: "needs_review" | "approved" | "archived";
  rightsStatus?: "unknown" | "owned" | "licensed" | "restricted";
  usageRestrictions?: string | null;
  useCases?: string[] | string | null;
  altText?: string | null;
  caption?: string | null;
  notes?: string | null;
  sourceType?: "upload" | "directory" | "shopify" | "url" | "manual";
  sourceUrl?: string | null;
  angleType?: string | null;
  contextType?: string | null;
  settingDescription?: string | null;
  isHero?: boolean;
  verticalRelevance?: string[] | string | null;
};

function invalidatePhotoQueries() {
  queryClient.invalidateQueries({
    predicate: (query) => String(query.queryKey[0] || "").startsWith("/api/blog/photos"),
  });
  queryClient.invalidateQueries({
    predicate: (query) => String(query.queryKey[0] || "").startsWith("/api/blog/products"),
  });
}

export function usePhotos(productId?: string) {
  const activeCompanyId = useActiveCompanyId();
  const url = companyScopedUrl("/api/blog/photos", { productId });
  return useQuery<any[]>({ queryKey: [url], enabled: Boolean(activeCompanyId) });
}

export function usePhotoStats() {
  const activeCompanyId = useActiveCompanyId();
  return useQuery<PhotoStats>({
    queryKey: [companyScopedUrl("/api/blog/photos/stats")],
    enabled: Boolean(activeCompanyId),
  });
}

export function useUploadPhotos() {
  return useMutation({
    mutationFn: async ({ files, productId }: { files: FileList; productId?: string }) => {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append("files", files[i]);
      }
      if (productId) formData.append("productId", productId);
      const res = await fetch("/api/blog/photos/upload", {
        method: "POST",
        headers: getRequiredCompanyScopedHeaders(),
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      invalidatePhotoQueries();
    },
  });
}

export function useAnalyzePhoto() {
  return useMutation({
    mutationFn: async (photoId: string) => {
      const res = await apiRequest("POST", `/api/blog/photos/${photoId}/analyze`);
      return res.json();
    },
    onSuccess: () => {
      invalidatePhotoQueries();
    },
  });
}

export function useUpdatePhoto() {
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: PhotoMetadataUpdate }) => {
      const res = await apiRequest("PATCH", `/api/blog/photos/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      invalidatePhotoQueries();
    },
  });
}

export function useAutoAssociate() {
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/blog/photos/auto-associate");
      return res.json();
    },
    onSuccess: () => {
      invalidatePhotoQueries();
    },
  });
}

export function useDeletePhoto() {
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/blog/photos/${id}`);
      return res.json();
    },
    onSuccess: () => {
      invalidatePhotoQueries();
    },
  });
}
