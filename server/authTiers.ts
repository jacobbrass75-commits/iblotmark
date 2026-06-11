export const USER_TIERS = ["free", "pro", "max"] as const;
export type UserTier = typeof USER_TIERS[number];

export const DEFAULT_USER_TIER: UserTier = "free";

export const TIER_LEVELS: Record<UserTier, number> = {
  free: 0,
  pro: 1,
  max: 2,
};

export const TIER_TOKEN_LIMITS: Record<UserTier, number> = {
  free: 50_000,
  pro: 500_000,
  max: 2_000_000,
};

export const TIER_STORAGE_LIMITS: Record<UserTier, number> = {
  free: 52_428_800,
  pro: 524_288_000,
  max: 5_368_709_120,
};

export function normalizeUserTier(value: unknown): UserTier {
  return typeof value === "string" && value in TIER_LEVELS
    ? value as UserTier
    : DEFAULT_USER_TIER;
}

export function getTierLimits(value: unknown): {
  tier: UserTier;
  tokenLimit: number;
  storageLimit: number;
} {
  const tier = normalizeUserTier(value);
  return {
    tier,
    tokenLimit: TIER_TOKEN_LIMITS[tier],
    storageLimit: TIER_STORAGE_LIMITS[tier],
  };
}
