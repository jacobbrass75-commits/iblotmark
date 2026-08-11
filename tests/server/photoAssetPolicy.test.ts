import { describe, expect, it } from "vitest";
import { isPhotoPublishable } from "../../server/photoAssetPolicy";

describe("photo publishing policy", () => {
  it.each([
    ["approved", "owned", true],
    ["approved", "licensed", true],
    ["approved", "unknown", false],
    ["approved", "restricted", false],
    ["needs_review", "owned", false],
    ["archived", "owned", false],
  ])("requires review approval and usable rights (%s, %s)", (assetStatus, rightsStatus, expected) => {
    expect(isPhotoPublishable({ assetStatus, rightsStatus })).toBe(expected);
  });

  it("rejects a missing photo", () => {
    expect(isPhotoPublishable(undefined)).toBe(false);
  });
});
