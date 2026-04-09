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
      '## Desktop and Workspace\n<img src="https://cdn.shopify.com/desktop.jpg" alt="iBOLT TabDock POS Tablet Stand" style="width:100%;max-width:800px;height:auto;margin:16px 0;border-radius:4px;" />'
    );
    expect(result.markdown).toContain(
      '## Vehicle Tablet Mounting\n<img src="https://cdn.shopify.com/vehicle.jpg" alt="iBOLT TabDock Extend iBOLT Triple Suction Cup Mount" style="width:100%;max-width:800px;height:auto;margin:16px 0;border-radius:4px;" />'
    );
  });

  it("skips sections that already have an image immediately after the H2", () => {
    const markdown = `## Headrest Tablet Holders
<img src="https://cdn.shopify.com/headrest.jpg" alt="Existing image" style="width:100%;max-width:800px;height:auto;margin:16px 0;border-radius:4px;" />

The iBOLT sPro2 Headrest Viewer keeps tablets steady for passengers.`;

    const result = injectProductImagesIntoMarkdown(markdown, products as any);

    expect(result.inserted).toBe(0);
    expect(result.markdown).toBe(markdown);
  });

  it("matches normalized product titles and skips generic installation sections", () => {
    const markdown = `## Magnetic Tablet Mounts

The **iBOLT TabDock MagDock Heavy Duty Magnetic Mount** works well on fridges and workout equipment.

## Installation Best Practices

Use the **iBOLT AMPS to VESA 75/100 Plate** when you need hardware adapters.`;

    const result = injectProductImagesIntoMarkdown(markdown, [
      ...products,
      {
        id: "product-4",
        handle: "ibolt-tabdock-magdock-heavy-duty-magnetic-mount-for-fridges-restaurants-automotive-workout-equipment",
        title: "iBOLT TabDock™ MagDock- Heavy Duty Magnetic Mount for All 7”-10” Tablets- Great for fridges, Restaurants, Automotive, Workout Equipment",
        imageUrl: "https://cdn.shopify.com/magnetic.jpg",
        url: "https://iboltmounts.com/products/ibolt-tabdock-magdock-heavy-duty-magnetic-mount-for-fridges-restaurants-automotive-workout-equipment",
      },
    ] as any);

    expect(result.inserted).toBe(1);
    expect(result.markdown).toContain("https://cdn.shopify.com/magnetic.jpg");
    expect(result.markdown).not.toContain("Installation Best Practices\n<img");
  });
});
