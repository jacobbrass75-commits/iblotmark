import { describe, expect, it } from "vitest";
import { validateInternalLinkInsertion } from "../server/internalLinker";

describe("internal link safety validator", () => {
  it("accepts markdown that only adds approved links", () => {
    const original = "Use a tablet tower when several delivery apps need to stay visible.";
    const revised = "Use a [tablet tower](https://iboltmounts.com/blogs/news/tablet-tower-guide) when several delivery apps need to stay visible.";

    const result = validateInternalLinkInsertion(original, revised, [
      "https://iboltmounts.com/blogs/news/tablet-tower-guide",
    ]);

    expect(result.valid).toBe(true);
    expect(result.added).toBe(1);
  });

  it("rejects altered prose", () => {
    const original = "Use a tablet tower when several delivery apps need to stay visible.";
    const revised = "Use a [tablet tower](https://iboltmounts.com/blogs/news/tablet-tower-guide) when many delivery apps need to stay visible.";

    const result = validateInternalLinkInsertion(original, revised, [
      "https://iboltmounts.com/blogs/news/tablet-tower-guide",
    ]);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("non-link text");
  });

  it("rejects inserted URLs outside the candidate list", () => {
    const original = "Use a tablet tower when several delivery apps need to stay visible.";
    const revised = "Use a [tablet tower](https://example.com/foreign) when several delivery apps need to stay visible.";

    const result = validateInternalLinkInsertion(original, revised, [
      "https://iboltmounts.com/blogs/news/tablet-tower-guide",
    ]);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not an allowed candidate");
  });
});
