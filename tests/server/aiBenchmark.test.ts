import { describe, expect, it } from "vitest";
import { computeSimilarity, deriveBrandAliasVariants } from "../../server/aiBenchmarkUtils";

describe("aiBenchmark", () => {
  it("scores overlapping long-tail queries as similar", () => {
    const score = computeSimilarity(
      "best fish finder mount for small boat",
      "small boat fish finder mount buyer guide",
    );

    expect(score).toBeGreaterThan(0.35);
  });

  it("keeps unrelated topics clearly separated", () => {
    const score = computeSimilarity(
      "best fish finder mount for small boat",
      "best restaurant tablet mount",
    );

    expect(score).toBeLessThan(0.25);
  });

  it("derives short aliases from brand names and domains", () => {
    expect(deriveBrandAliasVariants("iBolt Mounts")).toEqual(
      expect.arrayContaining(["iBolt Mounts", "iBoltMounts", "iBolt"]),
    );
    expect(deriveBrandAliasVariants("iboltmounts")).toContain("ibolt");
  });
});
