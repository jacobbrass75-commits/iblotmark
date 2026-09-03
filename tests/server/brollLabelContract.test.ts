import { describe, expect, it } from "vitest";
import { parseBrollLabel, scoreBrollLabelForText } from "../../server/brollLabelContract";

const validLabel = {
  contractVersion: "broll.v1" as const,
  assetId: "drive-123",
  sha256: "a".repeat(64),
  altText: "Tablet mounted inside a commercial truck cab",
  caption: "An iBOLT tablet mount positioned for a fleet driver.",
  scene: "Commercial truck interior with a mounted tablet",
  contextType: "in-use" as const,
  angleType: "in-use" as const,
  orientation: "landscape" as const,
  verticals: ["trucking-fleet"],
  useCases: ["ELD navigation"],
  devices: ["tablet"],
  mountingSurfaces: ["dashboard"],
  blogTopics: ["fleet tablet mounts"],
  keywords: ["truck tablet mount"],
  productCandidates: [{ name: "TabDock", confidence: 0.7, evidence: "Visible tablet cradle and arm" }],
  cropSuitability: { hero: true, inline: true, social: true, notes: "Subject is centered" },
  quality: { score: 0.9, sharp: true, wellLit: true, usableComposition: true },
  reviewFlags: [],
  confidence: 0.86,
  needsReview: false,
};

describe("brollLabelContract", () => {
  it("accepts and normalizes a complete label", () => {
    const parsed = parseBrollLabel({ ...validLabel, keywords: ["truck tablet mount", "truck tablet mount"] });
    expect(parsed.keywords).toEqual(["truck tablet mount"]);
  });

  it("rejects an invalid asset hash", () => {
    expect(() => parseBrollLabel({ ...validLabel, sha256: "bad" })).toThrow();
  });

  it("rewards topic matches and penalizes review flags", () => {
    const clean = scoreBrollLabelForText(parseBrollLabel(validLabel), ["Best truck tablet mount for fleet ELD navigation"]);
    const flagged = scoreBrollLabelForText(parseBrollLabel({ ...validLabel, needsReview: true, reviewFlags: ["product identity uncertain"] }), ["Best truck tablet mount for fleet ELD navigation"]);
    expect(clean).toBeGreaterThan(flagged);
    expect(clean).toBeGreaterThan(0);
  });
});
