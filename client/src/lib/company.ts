import { useSyncExternalStore } from "react";

const ACTIVE_COMPANY_ID_KEY = "blog.activeCompanyId";

type QueryParamValue = string | number | boolean | null | undefined;

export function getActiveCompanyId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACTIVE_COMPANY_ID_KEY);
}

function subscribeActiveCompanyId(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === ACTIVE_COMPANY_ID_KEY) callback();
  };
  window.addEventListener("active-company-changed", callback);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("active-company-changed", callback);
    window.removeEventListener("storage", onStorage);
  };
}

export function useActiveCompanyId(): string | null {
  return useSyncExternalStore(subscribeActiveCompanyId, getActiveCompanyId, () => null);
}

export function requireActiveCompanyId(): string {
  const companyId = getActiveCompanyId();
  if (!companyId) {
    throw new Error("Choose or create a company workspace before changing blog data.");
  }
  return companyId;
}

export function setActiveCompanyId(companyId: string | null): void {
  if (typeof window === "undefined") return;
  if (companyId) {
    window.localStorage.setItem(ACTIVE_COMPANY_ID_KEY, companyId);
  } else {
    window.localStorage.removeItem(ACTIVE_COMPANY_ID_KEY);
  }
  window.dispatchEvent(new CustomEvent("active-company-changed", { detail: { companyId } }));
}

export function companyScopedUrl(path: string, params: Record<string, QueryParamValue> = {}): string {
  const search = new URLSearchParams();
  const companyId = getActiveCompanyId();
  if (companyId) search.set("companyId", companyId);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export function getCompanyScopedHeaders(base?: HeadersInit): Headers {
  const headers = new Headers(base);
  const companyId = getActiveCompanyId();
  if (companyId) headers.set("x-company-id", companyId);
  return headers;
}

export function getRequiredCompanyScopedHeaders(base?: HeadersInit): Headers {
  const headers = new Headers(base);
  headers.set("x-company-id", requireActiveCompanyId());
  return headers;
}
