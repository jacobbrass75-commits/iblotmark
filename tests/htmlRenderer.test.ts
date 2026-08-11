import { describe, expect, it, vi } from "vitest";
import type { BlogPost } from "../shared/schema";

vi.mock("../server/db", () => ({
  db: {
    select: () => ({
      from: () => [],
    }),
  },
}));

import { buildStructuredDataScripts, injectSelectedPostPhotos, markdownToHtml, renderShopifyHtml } from "../server/htmlRenderer";

function makePost(markdown: string, title = "Best Restaurant Tablet Mounts"): BlogPost {
  const now = new Date("2026-06-11T12:00:00.000Z");
  return {
    id: "post-1",
    companyId: null,
    title,
    slug: "best-restaurant-tablet-mounts",
    metaTitle: title,
    metaDescription: "Compare restaurant tablet mounts for delivery apps, POS counters, and multi-tablet stations.",
    markdown,
    html: null,
    clusterId: null,
    verticalId: null,
    batchId: null,
    status: "review",
    wordCount: 900,
    brandConsistency: 90,
    seoOptimization: 91,
    naturalLanguage: 89,
    factualAccuracy: 93,
    overallScore: 91,
    verificationNotes: null,
    generationProvider: "anthropic",
    generationModel: "claude-sonnet-4-20250514",
    shopifyArticleId: null,
    shopifyBlogId: null,
    shopifySyncedAt: null,
    generatedAt: now,
    updatedAt: now,
  } as BlogPost;
}

const fixtureMarkdown = [
  "## Restaurant Tablet Mount Comparison",
  "A short guide with [Tablet Tower](https://iboltmounts.com/products/tablet-tower) and [LockPro Stand](https://iboltmounts.com/products/lockpro-stand).",
  "",
  "### Quick Picks",
  "",
  "| Use case | Mount |",
  "| --- | --- |",
  "| Delivery apps | Tablet Tower |",
  "| Checkout | LockPro Stand |",
  "",
  "- Counter stations",
  "  - Three tablets",
  "  - Five tablets",
  "- Wall stations",
  "",
  '<div class="ibolt-inline-image"><img src="https://cdn.example.com/restaurant-tablet.jpg" alt="Restaurant tablet station"></div>',
  "",
  "## Frequently Asked Questions",
  "",
  "**Q: What is the best restaurant tablet mount?**",
  "A: A stable multi-tablet station is best when several delivery apps need to remain visible.",
  "",
  "**Q: Can one mount hold several tablets?**",
  "A: Yes, multi-tablet systems can hold several tablets in one station.",
].join("\n");

describe("Shopify HTML renderer", () => {
  it("places review-selected photos once, including a hero and an inline asset", () => {
    const markdown = [
      "Intro copy.",
      "",
      "## First Section",
      "First section copy.",
      "",
      "## Second Section",
      "Second section copy.",
      "",
      "## Frequently Asked Questions",
      "**Q: One?**",
      "A: One.",
    ].join("\n");
    const assets = [
      {
        selection: { placement: "hero", altText: "Mounted tablet hero" },
        photo: { id: "photo-hero", originalFilename: "hero.jpg" },
      },
      {
        selection: { placement: "inline", sectionIndex: 0, altText: "Tablet mount at work" },
        photo: { id: "photo-inline", originalFilename: "inline.jpg" },
      },
    ];

    const rendered = injectSelectedPostPhotos(markdown, assets, "company-1");
    expect(rendered).toMatch(/^!\[Mounted tablet hero\]/);
    expect(rendered.indexOf("photo-inline")).toBeGreaterThan(rendered.indexOf("First section copy."));
    expect(rendered.indexOf("photo-inline")).toBeLessThan(rendered.indexOf("## Second Section"));
    expect(injectSelectedPostPhotos(rendered, assets, "company-1")).toBe(rendered);
  });

  it("renders GitHub-flavored markdown tables, nested lists, and raw HTML", () => {
    const html = markdownToHtml(fixtureMarkdown);

    expect(html).toContain("<table>");
    expect(html).toContain("<ul>");
    expect(html).toContain('<div class="ibolt-inline-image">');
    expect(html).toContain("https://cdn.example.com/restaurant-tablet.jpg");
  });

  it("emits Article, BreadcrumbList, FAQPage, and listicle ItemList JSON-LD", async () => {
    const output = await renderShopifyHtml(makePost(fixtureMarkdown));

    expect(output).toContain('"@type": "Article"');
    expect(output).toContain('"@type": "BreadcrumbList"');
    expect(output).toContain('"@type": "FAQPage"');
    expect(output).toContain('"@type": "ItemList"');
    expect(output).toContain('"name": "Tablet Tower"');
    expect(output).toContain('"url": "https://iboltmounts.com/products/tablet-tower"');
  });

  it("does not emit ItemList for non-listicle titles", () => {
    const scripts = buildStructuredDataScripts(makePost(fixtureMarkdown, "Restaurant Tablet Mount Guide"));
    expect(scripts).toContain('"@type": "Article"');
    expect(scripts).not.toContain('"@type": "ItemList"');
  });

  it("uses a signed absolute URL for selected photos in Article schema", () => {
    const post = {
      ...makePost("![Mounted tablet](/api/public/blog/photos/serve/photo-1?companyId=company-1)"),
      companyId: "company-1",
    };
    const scripts = buildStructuredDataScripts(post);
    expect(scripts).toContain("http://localhost:5001/api/public/blog/photos/serve/photo-1?companyId=company-1&token=");
  });
});
