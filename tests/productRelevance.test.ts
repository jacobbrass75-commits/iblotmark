import { describe, expect, it } from "vitest";
import { rankRelevantProducts } from "../server/productRelevance";

describe("blog product relevance", () => {
  it("prefers keyword-relevant products and caps broad vertical mappings", () => {
    const products = [
      { id: "generic", title: "Generic Phone Mount", handle: "generic-phone-mount", imageUrl: "generic.jpg" },
      { id: "forklift", title: "Forklift Tablet and Scanner Mount", handle: "forklift-tablet-scanner", imageUrl: "forklift.jpg" },
      { id: "marine", title: "Marine Fish Finder Mount", handle: "marine-fish-finder", imageUrl: "marine.jpg" },
    ];
    const mappingScores = new Map(products.map((product) => [product.id, 0.95]));

    const ranked = rankRelevantProducts(products, ["forklift tablet mount"], mappingScores, 1);
    expect(ranked.map((product) => product.id)).toEqual(["forklift"]);
  });
});
