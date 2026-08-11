import { describe, expect, it } from "vitest";
import {
  auditBlogGroundingV3,
  buildBlogEvidencePacketV3,
  getBlogEvidenceSearchTerms,
  planBlogEvidenceByteBudgetV3,
  rankBlogEvidenceV3,
  type BlogEvidenceRecord,
} from "../server/blogEvidenceV3";

const records: BlogEvidenceRecord[] = [
  {
    id: "reddit-language",
    category: "user_language",
    content: "Forklift operators describe loose scanners as rattling around in a cup holder during every shift.",
    sourceType: "reddit",
    sourceUrl: "https://www.reddit.com/r/forklift/example",
    confidence: 0.9,
  },
  {
    id: "web-spec",
    category: "specification",
    content: "The TabDock2 arm supports a 20 mm mounting ball and a 4-inch extension.",
    sourceType: "web",
    sourceUrl: "https://iboltmounts.com/products/tabdock2",
    confidence: 0.98,
  },
  {
    id: "generic-seed",
    category: "use_case",
    content: "Device mounts can help workers keep screens visible.",
    sourceType: "seed",
    sourceUrl: null,
    confidence: 1,
  },
];

describe("Writing V3 blog evidence retrieval", () => {
  it("builds stable search terms without generic prompt words", () => {
    expect(getBlogEvidenceSearchTerms(["Write a section about forklift scanner mounts"])).toEqual([
      "forklift",
      "scanner",
      "mounts",
    ]);
  });

  it("lets specific lexical relevance outrank a generic human-language boost", () => {
    const ranked = rankBlogEvidenceV3(records, ["TabDock2 20 mm arm"]);
    expect(ranked[0].id).toBe("web-spec");
    expect(ranked[0].matchedTerms).toEqual(expect.arrayContaining(["tabdock2", "20", "arm"]));
  });

  it("prefers approved Reddit language when it is relevant", () => {
    const ranked = rankBlogEvidenceV3(records, ["forklift scanner rattling cup holder"]);
    expect(ranked[0].id).toBe("reddit-language");
  });

  it("respects the UTF-8 packet budget without cutting a record", () => {
    const packet = buildBlogEvidencePacketV3(records, ["forklift mount"], {
      maxUtf8Bytes: 1_000,
      maxEntries: 3,
    });
    expect(Buffer.byteLength(packet.packet, "utf8")).toBeLessThanOrEqual(1_000);
    expect(packet.packet).toContain("[IBOLT BLOG EVIDENCE V3 - VERIFIED CONTEXT BANK]");
    expect(packet.packet).toMatch(/sha256=[0-9a-f]{64}/);
    for (const entry of packet.entries) {
      expect(packet.packet).toContain(entry.content);
    }
  });

  it("adapts the packet budget to query complexity within fixed bounds", () => {
    const narrow = planBlogEvidenceByteBudgetV3(records, ["mount"]);
    const detailed = planBlogEvidenceByteBudgetV3(records, ["TabDock2 20 mm forklift scanner mounting ball extension"]);
    expect(detailed).toBeGreaterThan(narrow);
    expect(narrow).toBeGreaterThanOrEqual(6_000);
    expect(detailed).toBeLessThanOrEqual(12_000);
  });

  it("falls back to the strongest approved records when no query term matches", () => {
    const packet = buildBlogEvidencePacketV3(records, ["completely unrelated phrase"]);
    expect(packet.entries[0].id).toBe("reddit-language");
  });
});

describe("Writing V3 final grounding audit", () => {
  const evidence = [
    "The TabDock2 arm supports a 20 mm mounting ball and a 4-inch extension.",
    "Operators say scanners are rattling around in a cup holder during every shift.",
  ];

  it("accepts a supported measurement claim and exact long quotation", () => {
    const markdown = [
      "The TabDock2 arm supports a 20 mm mounting ball for this setup.",
      "Operators describe scanners as \"rattling around in a cup holder during every shift.\"",
    ].join("\n\n");
    const audit = auditBlogGroundingV3(markdown, evidence);
    expect(audit.passed).toBe(true);
    expect(audit.verifiedHighRiskClaims).toBe(1);
    expect(audit.verifiedQuotes).toBe(1);
  });

  it("blocks unsupported measurements and invented long quotations", () => {
    const markdown = [
      "The TabDock2 arm supports a 30 mm mounting ball for this setup.",
      "An operator said, \"this mount survived ten years of nonstop warehouse abuse without moving at all.\"",
    ].join("\n\n");
    const audit = auditBlogGroundingV3(markdown, evidence);
    expect(audit.passed).toBe(false);
    expect(audit.unsupportedHighRiskClaims[0].unsupportedTokens).toContain("30 mm");
    expect(audit.unsupportedQuotes).toHaveLength(1);
  });

  it("ignores numbers in HTML attributes and Markdown URLs", () => {
    const markdown = '<img src="https://cdn.example.com/12345/image.jpg" alt="Mounted tablet">\n\n[See the mount](https://example.com/products/12345).';
    expect(auditBlogGroundingV3(markdown, evidence).passed).toBe(true);
  });
});
