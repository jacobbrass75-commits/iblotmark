import { describe, expect, it } from "vitest";
import { lintContent } from "../server/contentLinter";

const products = [
  { title: "Tablet Tower", handle: "tablet-tower", price: 79.95 },
  { title: "LockPro Stand", handle: "lockpro-stand", price: 139.95 },
];

function filler(sentences = 55): string {
  return Array.from({ length: sentences }, () =>
    "Restaurant teams need a stable tablet position that keeps orders visible, protects devices, and gives staff a clear place to work during rush periods."
  ).join(" ");
}

function cleanMarkdown(): string {
  return [
    "## Why Restaurant Tablet Mount Placement Matters",
    filler(20),
    "The Tablet Tower is listed at $79.95 and fits this workflow well.",
    "[View the Tablet Tower](https://iboltmounts.com/products/tablet-tower)",
    '<img src="https://example.com/tablet.jpg" alt="Tablet Tower mounted at a restaurant counter">',
    "## How To Choose The Right Setup",
    filler(18),
    "## Product Fit And Daily Use",
    filler(18),
    "## Frequently Asked Questions",
    "**Q: What is the best restaurant tablet mount for delivery apps?**",
    "A: A stable multi-tablet station is usually best when several apps need to stay visible.",
    "**Q: Can one station hold several tablets?**",
    "A: Yes, choose a holder pattern that matches the device sizes and work surface.",
    "**Q: Should a restaurant use a wall mount or counter mount?**",
    "A: Wall mounts save counter space, while counter mounts are easier to reposition.",
  ].join("\n\n");
}

describe("content linter", () => {
  it("passes a clean post", () => {
    const report = lintContent({
      markdown: cleanMarkdown(),
      title: "Restaurant Tablet Mount Guide",
      metaTitle: "Restaurant Tablet Mount Guide",
      metaDescription: "Choose a restaurant tablet mount for delivery apps, POS counters, and daily restaurant workflows.",
      primaryKeyword: "restaurant tablet mount",
      products,
    });

    expect(report.passed).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it("flags banned phrases, dash characters, H1 headings, and dead product links", () => {
    const report = lintContent({
      markdown: [
        "# Restaurant Tablet Mount Guide",
        "This game-changer setup uses a bad dash — and links to a missing product.",
        filler(55),
        "[Missing product](https://iboltmounts.com/products/not-a-real-handle)",
        "## Section One",
        "## Section Two",
        "## Frequently Asked Questions",
        "**Q: One?** A: One.",
        "**Q: Two?** A: Two.",
        "**Q: Three?** A: Three.",
      ].join("\n\n"),
      title: "Restaurant Tablet Mount Guide",
      metaTitle: "Restaurant Tablet Mount Guide",
      metaDescription: "Choose a restaurant tablet mount for delivery apps, POS counters, and daily restaurant workflows.",
      primaryKeyword: "restaurant tablet mount",
      products,
    });

    const rules = report.errors.map((issue) => issue.rule);
    expect(rules).toContain("banned-phrase");
    expect(rules).toContain("dash");
    expect(rules).toContain("h1-in-body");
    expect(rules).toContain("dead-product-link");
  });

  it("detects brand casing in prose but ignores URLs", () => {
    const urlOnly = lintContent({
      markdown: cleanMarkdown().replace(
        "https://iboltmounts.com/products/tablet-tower",
        "https://iboltmounts.com/products/ibolt-tablet-tower",
      ),
      title: "Restaurant Tablet Mount Guide",
      metaTitle: "Restaurant Tablet Mount Guide",
      metaDescription: "Choose a restaurant tablet mount for delivery apps, POS counters, and daily restaurant workflows.",
      primaryKeyword: "restaurant tablet mount",
      products: [...products, { title: "URL Product", handle: "ibolt-tablet-tower", price: null }],
    });
    expect(urlOnly.errors.some((issue) => issue.rule === "brand-casing")).toBe(false);

    const prose = lintContent({
      markdown: `${cleanMarkdown()}\n\nIBOLT should use the correct brand casing in prose.`,
      title: "Restaurant Tablet Mount Guide",
      metaTitle: "Restaurant Tablet Mount Guide",
      metaDescription: "Choose a restaurant tablet mount for delivery apps, POS counters, and daily restaurant workflows.",
      primaryKeyword: "restaurant tablet mount",
      products,
    });
    expect(prose.errors.some((issue) => issue.rule === "brand-casing")).toBe(true);
  });

  it("enforces word-count bounds", () => {
    const shortReport = lintContent({
      markdown: "## Short\n\nToo short.",
      title: "Restaurant Tablet Mount Guide",
      metaTitle: "Restaurant Tablet Mount Guide",
      metaDescription: "Choose a restaurant tablet mount for delivery apps, POS counters, and daily restaurant workflows.",
      primaryKeyword: "restaurant tablet mount",
      products,
    });
    expect(shortReport.errors.some((issue) => issue.rule === "word-count")).toBe(true);

    const longReport = lintContent({
      markdown: `## Long\n\n${filler(120)}\n\n## Middle\n\n${filler(50)}\n\n## Frequently Asked Questions\n\n**Q: One?** A: One.\n\n**Q: Two?** A: Two.\n\n**Q: Three?** A: Three.`,
      title: "Restaurant Tablet Mount Guide",
      metaTitle: "Restaurant Tablet Mount Guide",
      metaDescription: "Choose a restaurant tablet mount for delivery apps, POS counters, and daily restaurant workflows.",
      primaryKeyword: "restaurant tablet mount",
      products,
    });
    expect(longReport.errors.some((issue) => issue.rule === "word-count")).toBe(true);
  });
});
