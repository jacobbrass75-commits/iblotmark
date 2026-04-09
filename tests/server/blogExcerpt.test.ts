import { describe, expect, it } from "vitest";
import { generateExcerpt } from "../../server/blogExcerpt";

describe("blogExcerpt", () => {
  it("falls back to a keyword-aware plain-text excerpt when AI is unavailable", async () => {
    const excerpt = await generateExcerpt({
      title: "The Complete Guide to Tablet Mounts",
      metaTitle: "Tablet Mount Guide",
      metaDescription: "Find the right tablet mount for fleets, POS, and warehouses.",
      markdown: `# The Complete Guide to Tablet Mounts

Tablet mounts help keep screens secure in restaurant POS stations, fleet dashboards, warehouse forklifts, and accessibility setups.

This guide covers magnetic mounts, headrest mounts, and drill-base tablet holders for iBOLT systems.`,
      primaryKeyword: "tablet mounts",
      secondaryKeywords: ["headrest mounts", "magnetic mounts"],
    });

    expect(excerpt.toLowerCase()).toContain("tablet mounts");
    expect(excerpt.length).toBeGreaterThan(80);
    expect(excerpt).not.toContain("#");
  });
});
