import { useQuery } from "@tanstack/react-query";

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  tier: string;
  tokensUsed: number;
  tokenLimit: number;
  storageUsed: number;
  storageLimit: number;
  emailVerified: boolean | null;
  billingCycleStart: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isSignedIn: boolean;
  tier: string;
  logout: () => void;
}

const localFallbackUser: AuthUser = {
  id: "local",
  email: "admin@example.local",
  username: "admin",
  firstName: "Local",
  lastName: "Admin",
  tier: "max",
  tokensUsed: 0,
  tokenLimit: 2_000_000,
  storageUsed: 0,
  storageLimit: 5_368_709_120,
  emailVerified: true,
  billingCycleStart: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function allowLocalFallback(): boolean {
  return import.meta.env.DEV;
}

async function fetchCurrentUser(): Promise<AuthUser> {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

export function useAuth(): AuthContextType {
  const { data, isLoading, isError } = useQuery<AuthUser>({
    queryKey: ["/api/auth/me"],
    queryFn: fetchCurrentUser,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const user = data || (isError && allowLocalFallback() ? localFallbackUser : null);

  return {
    user,
    isLoading,
    isSignedIn: Boolean(user),
    tier: user?.tier || "free",
    logout: () => {
      window.location.href = "/sign-in";
    },
  };
}

export function getAuthHeaders(): Record<string, string> {
  return {};
}

type Feature = string;

export function useUserTier() {
  const { tier } = useAuth();
  const level = tier === "max" ? 2 : tier === "pro" ? 1 : 0;
  return {
    tier,
    level,
    can: (_feature: Feature) => true,
    requiredTier: (_feature: Feature) => "free",
  };
}
