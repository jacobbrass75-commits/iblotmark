// Auth stripped — internal tool, no login required.

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

export function useAuth(): AuthContextType {
  return {
    user: {
      id: "local",
      email: "admin@iboltmounts.com",
      username: "admin",
      firstName: "iBolt",
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
    },
    isLoading: false,
    isSignedIn: true,
    tier: "max",
    logout: () => {},
  };
}

export function getAuthHeaders(): Record<string, string> {
  return {};
}

type Feature = string;

export function useUserTier() {
  return {
    tier: "max",
    level: 2,
    can: (_feature: Feature) => true,
    requiredTier: (_feature: Feature) => "free",
  };
}
