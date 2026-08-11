import { describe, expect, it } from "vitest";
import {
  DEFAULT_BLOG_QUALITY_GATE,
  resolveBlogQualityGate,
  shouldRetryBlogVerification,
} from "../server/blogQuality";

describe("blog quality gate", () => {
  it("uses the specified 70-point gate when configuration is absent or invalid", () => {
    expect(DEFAULT_BLOG_QUALITY_GATE).toBe(70);
    expect(resolveBlogQualityGate(undefined)).toBe(70);
    expect(resolveBlogQualityGate("not-a-number")).toBe(70);
  });

  it("retries exactly when a completed verification score misses the gate", () => {
    expect(shouldRetryBlogVerification(69, 70)).toBe(true);
    expect(shouldRetryBlogVerification(70, 70)).toBe(false);
    expect(shouldRetryBlogVerification(92, 70)).toBe(false);
    expect(shouldRetryBlogVerification(0, 70)).toBe(false);
  });
});
