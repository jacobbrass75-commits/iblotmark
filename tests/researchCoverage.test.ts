import { describe, expect, it } from "vitest";
import { getResearchStaleness } from "../server/researchCoverage";

describe("research coverage staleness", () => {
  const now = new Date("2026-06-11T12:00:00Z");

  it("marks missing research dates as never", () => {
    expect(getResearchStaleness(null, now)).toBe("never");
  });

  it("marks research newer than seven days as fresh", () => {
    expect(getResearchStaleness(new Date("2026-06-06T12:00:00Z"), now)).toBe("fresh");
  });

  it("marks research between seven and thirty days as aging", () => {
    expect(getResearchStaleness(new Date("2026-05-20T12:00:00Z"), now)).toBe("aging");
  });

  it("marks research thirty days or older as stale", () => {
    expect(getResearchStaleness(new Date("2026-05-01T12:00:00Z"), now)).toBe("stale");
  });
});
