import { describe, expect, it } from "vitest";
import { assessPublishReadiness } from "../server/publishReadiness";

const passingLint = { errors: [], warnings: [], passed: true } as const;

describe("assessPublishReadiness", () => {
  it("accepts an approved post at the quality gate with passing lint", () => {
    expect(assessPublishReadiness(
      { status: "approved", overallScore: 70 },
      passingLint,
      70,
    )).toEqual({ ready: true, errors: [] });
  });

  it("blocks unapproved, below-gate posts with lint errors", () => {
    const result = assessPublishReadiness(
      { status: "draft", overallScore: 62 },
      {
        passed: false,
        warnings: [],
        errors: [{ rule: "banned-phrase", severity: "error", message: "Banned phrase" }],
      },
      70,
    );

    expect(result.ready).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("status must be approved"),
      expect.stringContaining("at least 70"),
      expect.stringContaining("banned-phrase"),
    ]));
  });
});
