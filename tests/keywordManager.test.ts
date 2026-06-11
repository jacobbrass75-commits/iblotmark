import { describe, expect, it, vi } from "vitest";

vi.mock("../server/db", () => ({
  db: {},
}));

import { parseKeywordCSV } from "../server/keywordManager";

describe("keyword CSV parser", () => {
  it("parses quoted keyword fields containing commas", () => {
    const rows = parseKeywordCSV([
      "No,Position,Keyword,Change,SD,Search Volume,URL,Location",
      '1,7,"phone mount, heavy duty",0,24,"1,900",https://iboltmounts.com/products/phone-mount,US',
    ].join("\n"));

    expect(rows).toEqual([
      {
        keyword: "phone mount, heavy duty",
        volume: 1900,
        difficulty: 24,
        position: 7,
        url: "https://iboltmounts.com/products/phone-mount",
      },
    ]);
  });

  it("normalizes Not ranked positions to zero", () => {
    const rows = parseKeywordCSV([
      "Position,Keyword,SD,Search Volume,URL",
      'Not ranked,"restaurant tablet mount",18,880,https://iboltmounts.com/products/tablet-tower',
    ].join("\n"));

    expect(rows[0]?.position).toBe(0);
    expect(rows[0]?.keyword).toBe("restaurant tablet mount");
  });

  it("handles thousands separators in search volume", () => {
    const rows = parseKeywordCSV([
      "Keyword,Volume,Difficulty,Position",
      '"forklift tablet mount","12,400",31,14',
    ].join("\n"));

    expect(rows[0]?.volume).toBe(12400);
    expect(rows[0]?.difficulty).toBe(31);
    expect(rows[0]?.position).toBe(14);
  });

  it("allows missing optional columns", () => {
    const rows = parseKeywordCSV([
      "Keyword",
      "amps mounting plate",
    ].join("\n"));

    expect(rows).toEqual([
      {
        keyword: "amps mounting plate",
        volume: 0,
        difficulty: 0,
        position: 0,
        url: "",
      },
    ]);
  });
});
