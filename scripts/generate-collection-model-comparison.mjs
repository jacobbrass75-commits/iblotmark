#!/usr/bin/env node

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = path.resolve(
  "content-output/collection-fitment-package-2026-08-02/model-comparison",
);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is required.");
}

const bannedPhrases = [
  "game-changer",
  "revolutionize",
  "seamless",
  "cutting-edge",
  "next-level",
  "groundbreaking",
  "innovative solution",
  "state-of-the-art",
  "paradigm shift",
  "synergy",
  "leverage",
  "empower",
  "robust",
  "holistic",
  "streamline",
  "best-in-class",
  "world-class",
  "look no further",
];

const models = [
  { id: "claude-sonnet-5", directory: "claude-sonnet-5" },
  { id: "claude-fable-5", directory: "claude-fable-5" },
];
const requestedModel = process.argv.find((arg) => arg.startsWith("--model="))?.split("=")[1] || "";
const requestedTopic = process.argv.find((arg) => arg.startsWith("--topic="))?.split("=")[1] || "";

const briefs = [
  {
    slug: "zebra-et40-forklift-pillar-mounts",
    title: "Zebra ET40 Forklift Pillar Mounts",
    primaryKeyword: "Zebra ET40 forklift mount",
    intent: "Zebra ET40 or ET45 tablet used on a warehouse forklift with a pillar or roll-cage installation.",
    facts: [
      "Zebra sells ET40 and ET45 enterprise tablets in 8-inch and 10-inch screen sizes.",
      "Zebra lists the 8-inch chassis as 213.9 x 134.8 x 11.4 mm and the 10-inch chassis as 257.9 x 162.9 x 11.4 mm.",
      "A case, expansion back, payment accessory, or hand strap can change the final dimensions, so do not claim universal physical fit without measuring the deployed device.",
    ],
    products: [
      "IBFL-34514, iBOLT TabDock Bizmount Pillar Mount, $74.95, https://iboltmounts.com/products/ibolt-tabdock-bizmount-pillar-mount-heavy-duty-forklift-tablet-mount-for-warehouse-vehicles-and-7-10-inch-tablets",
      "IBFL-34547, iBOLT TabDock IncrediBOLT 360 Forklift Tablet Mount, $91.95, https://iboltmounts.com/products/ibolt-tabdock-incredibolt-360-forklift-tablet-mount",
      "IBFL-34550, iBOLT LockPro IncrediBOLT 360 Pillar Mount, $169.95, https://iboltmounts.com/products/ibolt-lockprotm-incredibolttm-360-pillar-mount-heavy-duty-forklift-tablet-mount-for-warehouse-vehicles-and-7-10-inch-tablets",
      "IBFL-34530, iBOLT Dock'n Lock Bizmount Forklift Locking Tablet Mount, $93.95, https://iboltmounts.com/products/ibolt-dock-n-lock-bizmount-forklift-locking-tablet-mount",
    ],
  },
  {
    slug: "samsung-tab-active5-commercial-vehicle-mounts",
    title: "Samsung Galaxy Tab Active5 Commercial Vehicle Mounts",
    primaryKeyword: "Samsung Galaxy Tab Active5 vehicle mount",
    intent: "An 8-inch Galaxy Tab Active5 used for ELD, dispatch, navigation, inspection, or field-service work in a commercial vehicle.",
    facts: [
      "Samsung positions the Galaxy Tab Active5 as a rugged business tablet with an 8-inch display.",
      "The selected iBOLT TabDock products are sold for 7-inch to 10-inch tablets, but a protective case, hand strap, or charging accessory changes the installed envelope.",
      "Do not claim Peterbilt 579-specific fitment. Explain that cab mounting location, sightline, drilling policy, and cable route must be verified per vehicle.",
    ],
    products: [
      "IBBZ-34990, iBOLT TabDock IncrediBOLT 360 Suction Commercial Vehicle Mount, $74.95, https://iboltmounts.com/products/ibolt-tabdocktm-incredibolttm-360-suction-heavy-duty-metal-6-inch-multi-angle-mount-for-all-7-10-tablets-for-commercial-vehicles-trucks-and-eld-devices",
      "IBDY-34352, iBOLT TabDock IncrediBOLT 360 Triple Suction Cup Mount, $89.95, https://iboltmounts.com/products/ibolt-tabdock-incredibolt-360-heavy-duty-triple-suction-cup-mount",
      "IBBZ-33957, iBOLT TabDock Bizmount Flexpro Seat Rail Mount, $34.95, https://iboltmounts.com/products/tabdock-bizmount-flexpro-heavy-duty-tablet-metal-seat-rail-mount-1-inch-ball-ibbz-33957",
      "IBDY-34333, iBOLT TabDock IncrediBOLT 360 AMPS Tablet Mount, $64.95, https://iboltmounts.com/products/ibolt-tabdock-dynamount-360-amps-tablet-mount",
      "IBBZ-33971, iBOLT LockPro FlexPro Locking Tablet Seat Rail Mount, $159.95, https://iboltmounts.com/products/ibolt-lockpro-flexpro-heavy-duty-locking-tablet-seat-rail-mount",
    ],
  },
  {
    slug: "garmin-striker-4-kayak-rail-mounts",
    title: "Garmin Striker 4 Kayak Rail Mounts",
    primaryKeyword: "Garmin Striker 4 kayak mount",
    intent: "A Garmin Striker 4 fish finder mounted to a kayak rail, round thwart, handlebar, post, or pole without duplicating the existing Garmin Striker 4 collection.",
    facts: [
      "The existing Shopify collection is https://iboltmounts.com/collections/garmin-stricker-4-mounts and should be refreshed, not duplicated.",
      "The three iBOLT products below are explicitly sold for Garmin Striker 4 and rail, handlebar, or clamp installations.",
      "The IBWS-34765 product page lists posts, poles, and handlebars up to 33 mm in diameter, a 25 mm B-size ball, a 3.75-inch arm, and a Garmin Striker 4-compatible three-hole pattern.",
      "Do not generalize the 33 mm limit to the other two mounts unless their individual product page confirms it.",
    ],
    products: [
      "IBWS-34754, iBOLT Garmin Striker 4 Fish Finder IncrediBOLT 360 Clamp Rail Mount, $57.95, https://iboltmounts.com/products/ibolt-garmin-striker-4-fish-finder-incredibolt-360-clamp-handlebar-rail-mount",
      "IBWS-34764, iBOLT Garmin Striker 4 Fish Finder Dual Arm Rail Mount, $36.95, https://iboltmounts.com/products/ibolt-garmin-striker-4-fish-finder-dual-arm-handlebar-rail-mount",
      "IBWS-34765, iBOLT Garmin Striker 4 Fish Finder Handlebar Rail Mount, $27.95, https://iboltmounts.com/products/ibolt-garmin-striker-4-fish-finder-handlebar-rail-mount",
    ],
  },
];

function systemPrompt() {
  return `You are the iBOLT Mounts senior content editor. Write practical, buyer-aware Shopify blog copy with conversational expertise. Education comes before product promotion.

Rules:
- Return Markdown only.
- Start with these exact three plain-text labels on separate lines: Meta Title:, Meta Description:, and Slug:. Then add an H1 title.
- Target 800 to 1100 words.
- Use 4 or 5 useful H2 sections followed by an FAQ with 4 or 5 concise questions.
- Link exact products with Markdown links and mention SKU and price only when supplied.
- Distinguish verified compatibility from fitment that still requires measurement.
- Do not invent product tests, certifications, vehicle fitment, OEM endorsement, customer evidence, dimensions, materials, or availability.
- Always write iBOLT exactly.
- Never frame iBOLT as cheap, budget, or a cheaper alternative.
- Do not use em dashes or en dashes.
- Avoid these phrases: ${bannedPhrases.join(", ")}.
- End with an invitational CTA.
- Do not mention AI, model comparison, prompts, or internal workflow.`;
}

function userPrompt(brief) {
  return `Write a new companion article for this collection brief.

Title direction: ${brief.title}
Primary keyword: ${brief.primaryKeyword}
Search and buyer intent: ${brief.intent}

Verified or constrained facts:
${brief.facts.map((fact) => `- ${fact}`).join("\n")}

Approved iBOLT products:
${brief.products.map((product) => `- ${product}`).join("\n")}

The article must add installation and selection guidance, not repeat generic collection copy. Include practical checks for device size with case, mounting surface, vibration, sightline or reach, cable routing, removal frequency, and security when relevant.`;
}

function clean(text) {
  return String(text || "")
    .replace(/^```(?:markdown)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/[—–]/g, ",")
    .replace(/\bleverage\b/gi, "use")
    .trim();
}

function validate(markdown) {
  const issues = [];
  if (/[—–]/.test(markdown)) issues.push("contains em dash or en dash");
  const lower = markdown.toLowerCase();
  for (const phrase of bannedPhrases) {
    if (lower.includes(phrase)) issues.push(`contains banned phrase: ${phrase}`);
  }
  const wordCount = markdown.split(/\s+/).filter(Boolean).length;
  if (wordCount < 750 || wordCount > 1350) issues.push(`word count outside tolerance: ${wordCount}`);
  if (!/Meta Title:/i.test(markdown)) issues.push("missing Meta Title");
  if (!/Meta Description:/i.test(markdown)) issues.push("missing Meta Description");
  if (!/Slug:/i.test(markdown)) issues.push("missing Slug");
  if (!/^# /m.test(markdown)) issues.push("missing H1");
  return issues;
}

async function generate(model, brief) {
  let lastIssues = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await anthropic.messages.create({
      model: model.id,
      max_tokens: 8192,
      system: systemPrompt(),
      messages: [{ role: "user", content: userPrompt(brief) }],
    });
    const markdown = clean(
      response.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n"),
    );
    lastIssues = validate(markdown);
    if (lastIssues.length === 0) return markdown;
    console.warn(`[retry] ${model.id} ${brief.slug}: ${lastIssues.join("; ")}`);
  }
  throw new Error(lastIssues.join("; "));
}

async function main() {
  const results = [];
  const selectedModels = requestedModel
    ? models.filter((model) => model.id === requestedModel)
    : models;
  const selectedBriefs = requestedTopic
    ? briefs.filter((brief) => brief.slug === requestedTopic)
    : briefs;
  if (selectedModels.length === 0) throw new Error(`Unknown model: ${requestedModel}`);
  if (selectedBriefs.length === 0) throw new Error(`Unknown topic: ${requestedTopic}`);

  for (const model of selectedModels) {
    const outputDir = path.join(OUTPUT_ROOT, model.directory);
    await mkdir(outputDir, { recursive: true });
    for (const brief of selectedBriefs) {
      const startedAt = new Date().toISOString();
      try {
        console.log(`[generate] ${model.id} ${brief.slug}`);
        const markdown = await generate(model, brief);
        const outputPath = path.join(outputDir, `${brief.slug}.md`);
        await writeFile(outputPath, `${markdown}\n`, "utf8");
        results.push({
          model: model.id,
          topic: brief.slug,
          success: true,
          startedAt,
          finishedAt: new Date().toISOString(),
          outputPath: path.relative(process.cwd(), outputPath),
          wordCount: markdown.split(/\s+/).filter(Boolean).length,
        });
      } catch (error) {
        results.push({
          model: model.id,
          topic: brief.slug,
          success: false,
          startedAt,
          finishedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    mode: "review-only",
    publishedToShopify: false,
    promptParity: "The same system rules and topic evidence were used for both Anthropic models.",
    results,
  };
  await writeFile(
    path.join(OUTPUT_ROOT, "last-anthropic-run-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify(manifest, null, 2));
  if (results.some((result) => !result.success)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
