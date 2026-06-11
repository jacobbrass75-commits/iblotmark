import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getActiveCompanyId, getCompanyScopedHeaders } from "@/lib/company";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    if (res.status === 401) {
      // Clerk session expired — redirect to sign-in
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/sign-in")) {
        window.location.href = "/sign-in";
      }
    }
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const upperMethod = method.toUpperCase();
  const isBlogMutation = url.startsWith("/api/blog") && !["GET", "HEAD", "OPTIONS"].includes(upperMethod);
  const isCompanyBootstrap = upperMethod === "POST" && url === "/api/blog/company";
  if (isBlogMutation && !isCompanyBootstrap && !getActiveCompanyId()) {
    throw new Error("Choose or create a company workspace before changing blog data.");
  }

  const headers = new Headers();
  if (data) {
    headers.set("Content-Type", "application/json");
  }
  const requestHeaders = url.startsWith("/api/blog") ? getCompanyScopedHeaders(headers) : headers;

  const res = await fetch(url, {
    method: upperMethod,
    headers: requestHeaders,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = queryKey.join("/") as string;
    const headers = url.startsWith("/api/blog") ? getCompanyScopedHeaders() : undefined;

    const res = await fetch(url, {
      headers,
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
