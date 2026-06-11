import { describe, expect, it } from "vitest";
import {
  TIER_STORAGE_LIMITS,
  TIER_TOKEN_LIMITS,
  getTierLimits,
  normalizeUserTier,
} from "../../server/authTiers";

describe("auth tier normalization", () => {
  it("defaults missing or invalid Clerk metadata to free", () => {
    expect(normalizeUserTier(undefined)).toBe("free");
    expect(normalizeUserTier(null)).toBe("free");
    expect(normalizeUserTier("enterprise")).toBe("free");
  });

  it("preserves supported tiers and returns matching limits", () => {
    expect(normalizeUserTier("pro")).toBe("pro");
    expect(normalizeUserTier("max")).toBe("max");

    expect(getTierLimits("pro")).toEqual({
      tier: "pro",
      tokenLimit: TIER_TOKEN_LIMITS.pro,
      storageLimit: TIER_STORAGE_LIMITS.pro,
    });
  });
});
