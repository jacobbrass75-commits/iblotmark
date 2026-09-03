#!/usr/bin/env node

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const model = process.env.TOP_TEN_WRITER_MODEL || "claude-fable-5";
const outputRoot = path.resolve(
  process.argv.find((arg) => arg.startsWith("--output="))?.slice("--output=".length)
    || `content-output/top-10-category-program-${new Date().toISOString().slice(0, 10)}/drafts`,
);
const requestedSlug = process.argv.find((arg) => arg.startsWith("--article="))?.slice("--article=".length);
const concurrency = Math.max(1, Math.min(4, Number(process.env.TOP_TEN_GENERATION_CONCURRENCY || 3)));
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required.");

const campaigns = [
  {
    slug: "top-10-forklift-tablet-mounts",
    title: "Top 10 Forklift Tablet Mounts for Warehouses",
    keyword: "best forklift tablet mounts",
    collection: "heavy-duty-forklift-material-handling-tablet-mounts",
    audience: "warehouse operations and material-handling teams",
    competitors: "RAM Mounts, Havis, Gamber-Johnson, Zebra, and Arkon",
    handles: [
      "ibolt-tabdock-incredibolt-360-forklift-tablet-mount",
      "ibolt-tabdock-magdock-360-magnetic-tablet-mount-heavy-duty-forklift-warehouse-holder",
      "ibolt-dock-n-lock-bizmount-forklift-locking-tablet-mount",
      "ibolt-tabdock-bizmount-pillar-mount-heavy-duty-forklift-tablet-mount-for-warehouse-vehicles-and-7-10-inch-tablets",
      "ibolt-lockpro-38mm-amps-metal-locking-tablet-mount",
      "ibolt-lockprotm-incredibolttm-360-pillar-mount-heavy-duty-forklift-tablet-mount-for-warehouse-vehicles-and-7-10-inch-tablets",
      "ibolt-tabdock-incredibolt-360-heavy-duty-dual-suction-cup-mount",
      "heavy-duty-composite-locking-tablet-cradle-dock-n-lock-ibbz-33935",
      "ibolt-tabdock-bizmount-dualmag-low-profile-strong-magnetic-mount-for-7-to-10-inch-tablets",
      "ibolt-dock-n-lock-bizmount™-forklift-locking-tablet-38mm-mount",
    ],
  },
  {
    slug: "top-10-barcode-scanner-mounts",
    title: "Top 10 Barcode Scanner Mounts for Warehouses",
    keyword: "best barcode scanner mounts",
    collection: "barcode-scanners",
    audience: "warehouse, inventory, and forklift teams",
    competitors: "RAM Mounts, Zebra, Honeywell accessories, and ProClip",
    handles: [
      "ibolt-xl-barcode-scanner-forklift-pillar-mount-for-warehouse-vehicles-inventory-management-and-material-handling",
      "forklift-and-warehouse-vehicle-pillar-bracket-mount-barcode-scanner-holder-ibfl-34503",
      "ibolt-xl-barcode-scanner-incredibolt-360-forklift-pillar-mount",
      "ibolt-xl-barcode-scanner-magnetic-forklift-mount",
      "ibolt-xl-forklift-barcode-scanner-holder-38mm-mount",
      "ibolt-xl-barcode-scanner-dualmag-low-profile-strong-magnetic-mount",
      "ibolt-xl-barcode-scanner-bizmount-magnetic-mount-heavy-duty-88mm-magnetic-base-for-warehouse-vehicles-inventory-management-material-handling",
      "ibolt-xl-barcode-scanner-magnetic-mount-heavy-duty-88mm-magnetic-base-for-warehouse-vehicles-inventory-management-material-handling",
      "ibolt-xl-barcode-scanner-incredibolt-360-magnetic-mount-heavy-duty-88mm-magnetic-base-for-warehouse-vehicles-inventory-management-material-handling",
      "ibolt-vesa-75x75-mm-100x100-mm-dual-xl-barcode-scanner-forklift-pillar-mount",
    ],
  },
  {
    slug: "top-10-eld-fleet-tablet-mounts",
    title: "Top 10 ELD Tablet Mounts for Commercial Fleets",
    keyword: "best ELD tablet mounts",
    collection: "fleet-heavy-duty-eld-mandate-mounts",
    audience: "fleet managers, owner-operators, and field-service teams",
    competitors: "RAM Mounts, ProClip, Arkon, Havis, and Gamber-Johnson",
    handles: [
      "tabdock-bizmount-amps-heavy-duty-drill-base-tablet-mount-ibbz-33921",
      "tabdock-fixedpro-360-heavy-duty-metal-drill-base-tablet-mount-ibbz-33768",
      "ibolt-dock-n-lock-bizmount-heavy-duty-industrial-composite-locking-drill-base-mount",
      "ibolt-tabdock-incredibolt-360-heavy-duty-triple-suction-cup-mount",
      "ibolt-lockpro-metal-locking-tablet-drill-base-mount-ibbz-33779",
      "ibolt-dock-n-lock-incredibolt-360-amps",
      "ibolt-tabdock-fixedpro-360-suction-heavy-duty-metal-8-multi-angle-suction-cup-mount-for-all-7-10-tablets",
      "tabdock-bizmount-flexpro-heavy-duty-tablet-metal-seat-rail-mount-1-inch-ball-ibbz-33957",
      "ibolt-tabdock-dynamount-360-amps-tablet-mount",
      "ibolt-tabdocktm-incredibolttm-360-suction-heavy-duty-metal-6-inch-multi-angle-mount-for-all-7-10-tablets-for-commercial-vehicles-trucks-and-eld-devices",
    ],
  },
  {
    slug: "top-10-restaurant-pos-tablet-stands",
    title: "Top 10 Restaurant Tablet Stands for POS",
    keyword: "best restaurant tablet stands",
    collection: "point-of-sale-pos-purchase-retail-restaurant-tablet-mounts1",
    audience: "restaurant operators managing POS, delivery, and kitchen tablets",
    competitors: "CTA Digital, Heckler, Bouncepad, Arkon, and Compulocks",
    handles: [
      "tablet-tower-multi-tablet-stand-ipad-point-of-sale-purchase-restaurant-triple-ibrt-34700",
      "tabstand-pro-weighted-base-tablet-stand-ibbz-33769",
      "multi-tablet-stand-five-holders-restaurant-point-of-sale-purchase-ipad-ibrt-34706",
      "ibolt-quad-tablet-tower-stand",
      "ibolt-tablet-tower-tabdock-point-of-purchase-pos-wall-mount-with-3-tablet-holders",
      "ibolt-tabdock-point-of-purchase-pos-wall-mount-with-4-tablet-holders",
      "multi-tablet-stand-four-ipad-holders-point-of-sale-purchase-restaurant-ibrt-34707",
      "ibolttm-lockprotm-drill-base-locking-tablet-stand-point-of-purchase-pos-mount",
      "tablet-tower-multi-tablet-locking-stand-three-ipad-holders-point-of-sale-purchase-restaurant-ibrt-34701",
      "ibolt-dock-n-lock-drill-base-locking-dual-tablet-stand",
    ],
  },
  {
    slug: "top-10-tractor-agriculture-tablet-mounts",
    title: "Top 10 Tablet Mounts for Tractors and Farms",
    keyword: "best tractor tablet mounts",
    collection: "agriculture",
    audience: "farm operators using tablets and phones in tractors and equipment",
    competitors: "RAM Mounts, Arkon, ProClip, and Gamber-Johnson",
    handles: [
      "tabdock-bizmount-amps-heavy-duty-drill-base-tablet-mount-ibbz-33921",
      "tabdock-fixedpro-360-heavy-duty-metal-drill-base-tablet-mount-ibbz-33768",
      "ibolt-dock-n-lock-bizmount-heavy-duty-industrial-composite-locking-drill-base-mount",
      "ibolt-lockpro-metal-locking-tablet-drill-base-mount-ibbz-33779",
      "ibolt-dock-n-lock-incredibolt-360-amps",
      "ibolt-tabdock-fixedpro-360-suction-heavy-duty-metal-8-multi-angle-suction-cup-mount-for-all-7-10-tablets",
      "heavy-duty-composite-locking-tablet-cradle-dock-n-lock-ibbz-33935",
      "ibolt-tabdock-incredibolt-360-heavy-duty-dual-suction-cup-mount",
      "ibolt-tabdock-dynamount-360-amps-tablet-mount",
      "ibolt-tabdocktm-incredibolttm-360-suction-heavy-duty-metal-6-inch-multi-angle-mount-for-all-7-10-tablets-for-commercial-vehicles-trucks-and-eld-devices",
    ],
  },
  {
    slug: "top-10-fish-finder-mounts",
    title: "Top 10 Fish Finder Mounts for Kayaks and Boats",
    keyword: "best fish finder mounts",
    collection: "fish-finder-mounts2",
    audience: "kayak anglers and small-boat operators",
    competitors: "RAM Mounts, Scotty, YakAttack, and Railblaza",
    handles: [
      "ibolt-universal-marine-fish-finder-handlebar-rail-mount",
      "ibolt-garmin-striker-4-fish-finder-handlebar-rail-mount",
      "ibolt-universal-marine-fish-finder-incredibolt-clamp-handlebar-rail-mount",
      "ibolt-garmin-striker-4-fish-finder-incredibolt-360-clamp-handlebar-rail-mount",
      "ibolt-38mm-1-5-inch-composite-universal-marine-electronic-fish-finder-to-composite-rectangular-amps-pattern-drill-base-dual-ball-mount-featuring-a-8-5-inch-aluminum-38mm-bizmount-arm",
      "ibolt-universal-marine-fish-finder-handlebar-rail-mount-1",
      "ibolt-25mm-1-inch-composite-universal-marine-fish-finder-to-metal-amps2-75-inch-dual-ball-mount",
      "ibolt-garmin-striker-4-fish-finder-dual-arm-handlebar-rail-mount",
      "ibolt-25mm-1-inch-composite-universal-marine-electronic-fish-finder-to-composite-rectangular-amps-pattern-drill-base-dual-ball-mount",
      "ibolt-38mm-1-5-inch-composite-universal-marine-fish-finder-to-metal-amps-drill-base-mount",
    ],
  },
  {
    slug: "top-10-creator-overhead-mounts",
    title: "Top 10 Overhead Mounts for Content Creators",
    keyword: "best overhead phone mounts",
    collection: "social-media-live-streaming-mounts",
    audience: "creators filming tutorials, product demos, cooking, and livestreams",
    competitors: "Arkon, SmallRig, Ulanzi, Elgato, and Neewer",
    handles: [
      "livestream-stream-cast-stand-adjustable-overhead-camera-phone-mount-ibsc-34606",
      "livestreaming-overhead-phone-camera-stream-cast-stand-ibsc-34607",
      "tabdock-flexpro-tablet-gooseneck-clamp-ibbz-33763",
      "minipro-xl-flexilble-smartphone-gopro-camera-tripod-ibcm-3410",
      "tabstand-pro-weighted-base-tablet-stand-ibbz-33769",
      "livestream-stream-cast-clamp-adjustable-overhead-camera-phone-mount-ibsc-34605",
      "ibolt-stream-cast-overhead-camera-rig-desk-mount-for-dslr-cameras-for-top-down-and-front-facing-photography",
      "ibolt-stream-cast-overhead-ceiling-wall-metal-multi-angle-drill-base-mount-for-dslr-cameras-smartphones-mini-projectors",
      "ibolt-stream-cast-creator-custom-mount-kit-with-over-60-variations-live-streaming-tutorial-videos-ibsc-34615",
      "ibolt-stream-cast-tabdock-tablet-livestreaming-social-media-stand-ibsc-34614",
    ],
  },
  {
    slug: "top-10-wheelchair-mobility-device-mounts",
    title: "Top 10 Mounts for Wheelchairs and Mobility Devices",
    keyword: "best wheelchair tablet mounts",
    collection: "accessibility",
    audience: "wheelchair users, caregivers, clinicians, and mobility-equipment teams",
    competitors: "RAM Mounts, CTA Digital, AbleNet, and specialized AAC mounting suppliers",
    handles: [
      "ibolt-armtrack-for-wheelchairs-rehab-chairs-and-mobility-devices-with-a-track-system",
      "ibolt-accessibolt-dock-n-lock-wheelchair-mobility-tablet-mount",
      "ibolt-accessibolt-dock-n-lock-wheelchair-multi-angle-mobility-tablet-mount",
      "ibolt-diamond-amps-plate-accessibolt-armtrack-great-for-wheelchairs-rehab-chairs-and-mobility-devices-with-a-track-system",
      "ibolt-miniproxl-accessibolt-armtrack-for-wheelchairs-rehab-chairs-and-mobility-devices-with-a-track-system",
      "ibolt-miniproxl-accessibolt-seat-track-for-2-2-3-7-screen-phones-great-for-wheelchairs-rehab-chairs-and-mobility-devices-with-a-track-system",
      "ibolt-tabdock-accessibolt-universal-wheelchair-mobility-tablet-mount",
      "ibolt-tabdock-accessibolt-universal-wheelchair-multi-arm-mobility-tablet-mount",
      "ibolt-spro2-phone-tablet-accessibility-post-pole-rail-handlebar-clamp-mount-for-wheelchairs-exercise-equipment-ibac-34702",
      "ibolt-tabdock-accessibility-post-pole-rail-handlebar-mount-for-wheelchairs-exercise-equipment",
    ],
  },
  {
    slug: "top-10-industrial-magnetic-mounts",
    title: "Top 10 Industrial Magnetic Mounting Solutions",
    keyword: "best industrial magnetic mounts",
    collection: "magnetic-camera-mounts",
    audience: "warehouse, maintenance, fleet, and production teams",
    competitors: "RAM Mounts, Arkon, Scosche, and industrial magnetic-base suppliers",
    handles: [
      "ibolt-tabdock-magdock-360-magnetic-tablet-mount-heavy-duty-forklift-warehouse-holder",
      "ibolttm-heavy-duty-strength-88mm-diameter-magnetic-mount-4-25-inch-incredibolttm-w-inch-20-camera-screw",
      "ibolt-38mm-1-5-inch-dualmag-industrial-strength-magnetic-base",
      "ibolt-tabdock-bizmount-dualmag-low-profile-strong-magnetic-mount-for-7-to-10-inch-tablets",
      "ibolt-25mm-1-inch-dualmag-industrial-strength-magnetic-base",
      "ibolt-88mm-diameter-magnetic-mount-base-w-1-4-20-camera-screw-gopro-adapter",
      "ibolt-vesa-trimag-magnetic-monitor-mount-heavy-duty-screen-mount-with-38mm-ball-joints-and-vesa-75x75-100x100-plate-for-forklifts-warehouse-vehicles-and-material-handling-equipment",
      "ibolt-xl-barcode-scanner-dualmag-low-profile-strong-magnetic-mount",
      "ibolt-xl-barcode-scanner-bizmount-magnetic-mount-heavy-duty-88mm-magnetic-base-for-warehouse-vehicles-inventory-management-material-handling",
      "ibolt-xl-barcode-scanner-incredibolt-360-magnetic-mount-heavy-duty-88mm-magnetic-base-for-warehouse-vehicles-inventory-management-material-handling",
    ],
  },
  {
    slug: "top-10-bike-handlebar-mounts",
    title: "Top 10 Heavy-Duty Bike and Handlebar Mounts",
    keyword: "best heavy duty bike phone mounts",
    collection: "bike",
    audience: "cyclists, guides, rental operators, and field teams using handlebar-mounted devices",
    competitors: "Quad Lock, Peak Design, RAM Mounts, SP Connect, and Rokform",
    handles: [
      "ibolt-gopro-action-camera-selfie-pole-clamp-handlebar-rail-mount",
      "ibolt-tabdock-bizmount-clamp-heavy-duty-post-pole-mount",
      "ibolt-spro2-grip-compact-clamp-mount",
      "ibolt-tabdock-grip-post-pole-mount-fits-7-10-inch-tablets-and-posts-18mm-35mm-in-diameter",
      "ibolt-moto-vise-bizmount-clamp-heavy-duty-phone-claw-clamp-motorcycle-excercise-equipment-ibmc-34700",
      "ibolt-moto-vise-incredibolt-360-heavy-duty-phone-clamp-handlebar-rail-mount",
      "ibolt-moto-vise-phone-mount-9mm-bolt-mount-for-motorcycles-mirror-frames-ibmc-34722",
      "ibolt-gopro-action-camera-dynamount-clamp-handlebar-rail-mount",
      "ibolt-gopro-action-camera-incredibolt-clamp-handlebar-rail-mount-1",
      "ibolt-moto-vise-incredibolt-heavy-duty-phone-clamp-handlebar-rail-mount",
    ],
  },
];

const bannedPhrases = [
  "game-changer", "revolutionize", "seamless", "cutting-edge", "next-level",
  "groundbreaking", "innovative solution", "state-of-the-art", "paradigm shift",
  "synergy", "leverage", "empower", "robust", "holistic", "streamline",
  "best-in-class", "world-class", "look no further", "budget option",
  "affordable alternative", "cheaper than RAM", "cost-effective alternative",
];

function decodeHtml(value = "") {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadProducts(campaign) {
  const collectionUrl = `https://iboltmounts.com/collections/${campaign.collection}`;
  const response = await fetch(`${collectionUrl}/products.json?limit=250`);
  if (!response.ok) throw new Error(`${campaign.slug}: catalog request returned ${response.status}`);
  const payload = await response.json();
  const byHandle = new Map(payload.products.map((product) => [product.handle, product]));
  const products = campaign.handles.map((handle) => byHandle.get(handle));
  const missing = campaign.handles.filter((handle, index) => !products[index]);
  if (missing.length) throw new Error(`${campaign.slug}: missing live handles: ${missing.join(", ")}`);
  return {
    collectionUrl,
    checkedAt: new Date().toISOString(),
    products: products.map((product) => ({
      title: product.title,
      handle: product.handle,
      url: `https://iboltmounts.com/products/${product.handle}`,
      price: product.variants?.[0]?.price || null,
      image: product.images?.[0]?.src || null,
      manufacturerCopy: decodeHtml(product.body_html).slice(0, 350),
    })),
  };
}

function systemPrompt() {
  return `You are the iBOLT Mounts senior commerce editor. Write a Shopify-ready, specification-based buyer guide in a conversational expert voice. Education comes before selling.

Nonnegotiable rules:
- Return Markdown only.
- Start with Meta Title:, Meta Description:, and Slug: on separate lines, then an H1.
- Keep Meta Title under 60 characters and Meta Description under 155 characters.
- Write 800 to 1100 words, with a hard maximum of 1200 words including the comparison table and FAQ.
- Rank exactly 10 supplied iBOLT products. Give each a numbered H3, a concise "Best for" label, and no more than two short sentences.
- Include a compact comparison table near the top with rank, product, best use, mounting approach, and current listed price.
- Link every ranked product using its exact supplied URL.
- Include exactly 3 supplied official product images in HTML image blocks, each linked to its product page with useful alt text and a price caption.
- Include this exact disclosure sentence: "iBOLT manufactures the products in this guide. Rankings use published specifications and configured price; prices may change, and these products were not physically tested for this article."
- Include a short section comparing iBOLT's approach with the named competitor landscape. Be fair. Do not rank or state specs for competitors because competitor product evidence is not supplied.
- Position iBOLT as a commercial-duty specialist and smart total-value choice through concrete selection logic, modularity, complete configurations, and use-case fit. Never state that iBOLT is the market leader, most durable, cheapest, or universally best.
- Never invent testing, materials, load ratings, vibration ratings, certifications, device fit, warranties, compliance, availability, or product specs.
- Manufacturer copy is context, not independent proof. Narrow or omit absolute claims such as "only," "industrial strength," or "compliant."
- Discuss ELD mounting only as placement support. Do not say a mount itself is FMCSA compliant.
- Always write iBOLT exactly.
- Do not use em dashes or en dashes.
- Avoid: ${bannedPhrases.join(", ")}.
- End with 4 useful FAQs and an invitational CTA.`;
}

function userPrompt(campaign, catalog) {
  const productEvidence = catalog.products.map((product, index) => [
    `${index + 1}. ${product.title}`,
    `Current listed price: $${product.price}`,
    `URL: ${product.url}`,
    `Official image: ${product.image || "none supplied"}`,
    `Manufacturer catalog copy: ${product.manufacturerCopy || "No description supplied."}`,
  ].join("\n")).join("\n\n");

  return `Write this review-only draft.

Title direction: ${campaign.title}
Primary keyword: ${campaign.keyword}
Audience: ${campaign.audience}
Official collection: ${catalog.collectionUrl}
Catalog checked: ${catalog.checkedAt}
Competitor landscape to acknowledge: ${campaign.competitors}

Scoring method: retention and stability design 18%, installation fit 14%, published material/build details 12%, device compatibility 10%, adjustability 10%, security 8%, modularity 10%, complete configured price 10%, commercial deployment fit 5%, warranty/support 3%. Unknown facts remain unknown, not zero.

Use only the supplied product evidence. You may reorder the products when the evidence supports a clearer use-case ranking. Do not imply hands-on testing.

${productEvidence}`;
}

function clean(markdown) {
  return String(markdown || "")
    .replace(/^```(?:markdown)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/[—–]/g, ",")
    .replace(/\bleverage\b/gi, "use")
    .replace(/\bstreamline\b/gi, "simplify")
    .trim();
}

function validate(markdown, catalog) {
  const issues = [];
  const lower = markdown.toLowerCase();
  const wordCount = markdown.split(/\s+/).filter(Boolean).length;
  if (wordCount < 780 || wordCount > 1350) issues.push(`word count ${wordCount}`);
  if (/[—–]/.test(markdown)) issues.push("contains em dash or en dash");
  for (const phrase of bannedPhrases) if (lower.includes(phrase)) issues.push(`banned phrase: ${phrase}`);
  for (const product of catalog.products) if (!markdown.includes(product.url)) issues.push(`missing link: ${product.handle}`);
  const rankedHeadings = markdown.match(/^###\s+(?:#?\d+\.?|\d+\))/gm) || [];
  if (rankedHeadings.length !== 10) issues.push(`ranked headings ${rankedHeadings.length}, expected 10`);
  const imageCount = (markdown.match(/<img\s/gi) || []).length;
  if (imageCount !== 3) issues.push(`image count ${imageCount}, expected 3`);
  if (!/Meta Title:/i.test(markdown) || !/Meta Description:/i.test(markdown) || !/Slug:/i.test(markdown)) issues.push("missing SEO metadata");
  const metaTitle = markdown.match(/^Meta Title:\s*(.+)$/im)?.[1]?.trim() || "";
  const metaDescription = markdown.match(/^Meta Description:\s*(.+)$/im)?.[1]?.trim() || "";
  if (metaTitle.length >= 60) issues.push(`meta title length ${metaTitle.length}`);
  if (metaDescription.length >= 155) issues.push(`meta description length ${metaDescription.length}`);
  if (!/not physically tested/i.test(markdown)) issues.push("missing test disclosure");
  return issues;
}

async function generate(campaign, catalog) {
  let lastIssues = [];
  let repairInstruction = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 8192,
      output_config: { effort: "low" },
      system: systemPrompt(),
      messages: [{ role: "user", content: `${userPrompt(campaign, catalog)}${repairInstruction}` }],
    });
    const markdown = clean(response.content.filter((item) => item.type === "text").map((item) => item.text).join("\n"));
    lastIssues = validate(markdown, catalog);
    if (!lastIssues.length) return markdown;
    console.warn(`[retry] ${campaign.slug}: ${lastIssues.join("; ")}`);
    repairInstruction = `\n\nVALIDATION CORRECTION REQUIRED: The prior attempt failed because it ${lastIssues.join("; ")}. Write a fresh, tighter draft. Keep the entire response under 1150 words, use exactly 10 numbered H3 product headings and exactly 3 image tags, link all 10 products, and include the exact disclosure sentence from the system rules.`;
  }
  throw new Error(lastIssues.join("; "));
}

async function runOne(campaign) {
  const startedAt = new Date().toISOString();
  try {
    console.log(`[catalog] ${campaign.slug}`);
    const catalog = await loadProducts(campaign);
    console.log(`[generate] ${model} effort=low ${campaign.slug}`);
    const markdown = await generate(campaign, catalog);
    const outputPath = path.join(outputRoot, `${campaign.slug}.md`);
    await writeFile(outputPath, `${markdown}\n`, "utf8");
    return {
      slug: campaign.slug,
      success: true,
      model,
      effort: "low",
      startedAt,
      finishedAt: new Date().toISOString(),
      outputPath: path.relative(process.cwd(), outputPath),
      wordCount: markdown.split(/\s+/).filter(Boolean).length,
      catalogCheckedAt: catalog.checkedAt,
      collectionUrl: catalog.collectionUrl,
      products: catalog.products,
    };
  } catch (error) {
    return {
      slug: campaign.slug,
      success: false,
      model,
      effort: "low",
      startedAt,
      finishedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  await mkdir(outputRoot, { recursive: true });
  const selected = requestedSlug ? campaigns.filter((item) => item.slug === requestedSlug) : campaigns;
  if (!selected.length) throw new Error(`Unknown article: ${requestedSlug}`);
  const results = new Array(selected.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < selected.length) {
      const index = nextIndex++;
      results[index] = await runOne(selected[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, worker));
  const manifest = {
    generatedAt: new Date().toISOString(),
    mode: "review-only",
    publishedToShopify: false,
    model,
    effort: "low",
    concurrency,
    results,
  };
  await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(manifest, null, 2));
  if (results.some((result) => !result.success)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
