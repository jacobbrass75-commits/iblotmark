import { describe, expect, it } from "vitest";
import { injectProductImagesIntoMarkdown } from "../../server/blogPhotoSupport";

const products = [
  {
    id: "product-1",
    handle: "ibolt-tabdock-pos-tablet-stand",
    title: "iBOLT TabDock POS Tablet Stand",
    imageUrl: "https://cdn.shopify.com/desktop.jpg",
    url: "https://iboltmounts.com/products/ibolt-tabdock-pos-tablet-stand",
  },
  {
    id: "product-2",
    handle: "ibolt-tabdock-extendibolt-triple-suction-cup-mount",
    title: "iBOLT TabDock Extend iBOLT Triple Suction Cup Mount",
    imageUrl: "https://cdn.shopify.com/vehicle.jpg",
    url: "https://iboltmounts.com/products/ibolt-tabdock-extendibolt-triple-suction-cup-mount",
  },
  {
    id: "product-3",
    handle: "ibolt-spro2-headrest-viewer",
    title: "iBOLT sPro2 Headrest Viewer",
    imageUrl: "https://cdn.shopify.com/headrest.jpg",
    url: "https://iboltmounts.com/products/ibolt-spro2-headrest-viewer",
  },
] as const;

describe("blogPhotoSupport", () => {
  it("injects one image immediately after each matching H2 section", () => {
    const markdown = `# Tablet Mount Guide

## Desktop and Workspace

The [iBOLT TabDock POS Tablet Stand](https://iboltmounts.com/products/ibolt-tabdock-pos-tablet-stand) keeps checkout counters stable.

## Vehicle Tablet Mounting

For fleet installs, use the ibolt-tabdock-extendibolt-triple-suction-cup-mount.

## Generic Advice

Choose the mount that fits your use case.`;

    const result = injectProductImagesIntoMarkdown(markdown, products as any);

    expect(result.inserted).toBe(2);
    expect(result.matches.map((match) => match.productHandle)).toEqual([
      "ibolt-tabdock-pos-tablet-stand",
      "ibolt-tabdock-extendibolt-triple-suction-cup-mount",
    ]);
    expect(result.markdown).toContain(
      '## Desktop and Workspace\n<img src="https://cdn.shopify.com/desktop.jpg" alt="iBOLT TabDock POS Tablet Stand" style="width:100%;max-width:800px;height:auto;margin:16px 0;" />'
    );
    expect(result.markdown).toContain(
      '## Vehicle Tablet Mounting\n<img src="https://cdn.shopify.com/vehicle.jpg" alt="iBOLT TabDock Extend iBOLT Triple Suction Cup Mount" style="width:100%;max-width:800px;height:auto;margin:16px 0;" />'
    );
  });

  it("skips sections that already have an image immediately after the H2", () => {
    const markdown = `## Headrest Tablet Holders
<img src="https://cdn.shopify.com/headrest.jpg" alt="Existing image" style="width:100%;max-width:800px;height:auto;margin:16px 0;" />

The iBOLT sPro2 Headrest Viewer keeps tablets steady for passengers.`;

    const result = injectProductImagesIntoMarkdown(markdown, products as any);

    expect(result.inserted).toBe(0);
    expect(result.markdown).toBe(markdown);
  });
});
