#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT_ROOT = path.join(ROOT, "content-output");
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function csv(rows) {
  return `${rows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (!rows.length) return [];
  const [headers, ...records] = rows;
  return records
    .filter((record) => record.some((value) => String(value ?? "").length > 0))
    .map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])));
}

async function readCsv(filePath) {
  return parseCsv(await readFile(filePath, "utf8"));
}

async function latestDir(prefix) {
  const entries = await readdir(OUTPUT_ROOT, { withFileTypes: true });
  const matches = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort();
  if (!matches.length) throw new Error(`No content-output directory found with prefix ${prefix}`);
  return path.join(OUTPUT_ROOT, matches.at(-1));
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function brandCase(value) {
  return String(value ?? "")
    .replace(/IBOLT(?=[™\s])/g, "iBOLT")
    .replace(/iBolt(?=[™\s])/g, "iBOLT")
    .replace(/\bIBOLT\b/g, "iBOLT")
    .replace(/\biBolt\b/g, "iBOLT")
    .replace(/\bibolt\b/g, "iBOLT");
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function groupKey(row) {
  const prompt = row.prompt.toLowerCase();
  if (row.source === "competitor_displacement" || row.source === "head_to_head_comparison") {
    return `${row.category}:competitor`;
  }
  if (row.category === "amps/modular") return "amps/modular:system";
  if (row.category === "cycling") return "cycling:bike";
  if (row.category === "travel") return "travel:road-trip";
  if (row.category === "kitchen/home") return "kitchen/home:kitchen";
  if (row.category === "streaming") return prompt.includes("cooking") ? "streaming:cooking-video" : "streaming:creator";
  if (row.category === "agriculture") return "agriculture:farm-vehicle";
  if (row.category === "education") return "education:school-transport";
  if (row.category === "offroad") return "offroad:trail";
  if (row.category === "warehouse") return "warehouse:competitor";
  return `${row.category}:gap`;
}

const BRIEF_LIBRARY = {
  "amps/modular:system": {
    title: "AMPS Mounting System and Plate Compatibility Guide",
    pageType: "solution guide",
    primaryKeyword: "AMPS mounting system",
    intent: "Explain AMPS plates, ball sizes, clamps, screws, sockets, and how iBOLT modular parts fit together.",
    action: "Create one canonical AMPS hub and link it from product, fleet, restaurant, fish finder, and creator articles.",
  },
  "cycling:bike": {
    title: "Bike and E-Bike Phone and Camera Mount Guide",
    pageType: "vertical guide",
    primaryKeyword: "best phone mount for mountain biking",
    intent: "Cover bicycle handlebars, e-bike delivery, GoPro/action cameras, clamp style, and trail vibration.",
    action: "Create one cycling/powersports guide with phone and action-camera product cards.",
  },
  "travel:road-trip": {
    title: "Road Trip Headrest Tablet and Phone Mount Guide",
    pageType: "vertical guide",
    primaryKeyword: "best headrest tablet mount for road trips",
    intent: "Cover back-seat tablets, Nintendo Switch, rental cars, RV road trips, kids' screens, and removable installs.",
    action: "Create a road-trip/headrest guide that links travel products and charging accessories.",
  },
  "kitchen/home:kitchen": {
    title: "Kitchen Tablet and Overhead Phone Mount Guide",
    pageType: "vertical guide",
    primaryKeyword: "best tablet mount for kitchen recipes",
    intent: "Cover recipe apps, counter stands, wall mounts, overhead cooking video, home workout equipment, and cleanup concerns.",
    action: "Create a kitchen/home hub that links tablet holders, magnetic docks, and camera screw mounts.",
  },
  "streaming:creator": {
    title: "Phone and Camera Mounts for Live Streaming and Product Videos",
    pageType: "vertical guide",
    primaryKeyword: "best phone stand for live streaming",
    intent: "Cover table cameras, product videos, overhead product photography, camera screw mounts, and multi-angle positioning.",
    action: "Create a creator-focused guide using exact camera screw and clamp product names.",
  },
  "streaming:cooking-video": {
    title: "Phone Stands for Streaming Cooking Videos",
    pageType: "supporting guide",
    primaryKeyword: "phone stand for streaming cooking videos",
    intent: "Connect creator mounting with kitchen workflows, overhead shots, stable counters, and recipe recording.",
    action: "Build as a supporting page or section under the creator/kitchen hubs.",
  },
  "agriculture:farm-vehicle": {
    title: "Tablet and Phone Mounts for Tractors, Sprayers, and Farm UTVs",
    pageType: "vertical guide",
    primaryKeyword: "tablet mount for tractor cab",
    intent: "Cover precision agriculture screens, GPS tablets, tractor cabs, sprayers, farm UTVs, vibration, dust, and seasonal use.",
    action: "Create an agriculture guide with rugged mounting, clamp/drill-base choices, and power/charging notes.",
  },
  "education:school-transport": {
    title: "Tablet Mounts for School Buses, Classrooms, and Student Transportation",
    pageType: "vertical guide",
    primaryKeyword: "tablet mount for school bus fleet",
    intent: "Cover student transportation tablets, classroom checkout, locking stands, and classroom video recording.",
    action: "Create a small education hub with locking/security language and fleet-style device management.",
  },
  "offroad:trail": {
    title: "Jeep, UTV, and Overlanding Phone, Tablet, and Action Camera Mounts",
    pageType: "vertical guide",
    primaryKeyword: "best phone mount for UTV roll cage",
    intent: "Cover trail navigation, roll cages, Jeep trails, overlanding rigs, GoPro/action cameras, vibration, and removable mounts.",
    action: "Create one offroad hub rather than separate Jeep/UTV/camera posts.",
  },
};

function cleanCompetitor(value) {
  return brandCase(value)
    .replace(/\biBOLT\b/gi, "")
    .replace(/\s+for\s+.*$/i, "")
    .replace(/^[\s,:-]+|[\s,:-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCompetitor(prompt) {
  const text = brandCase(prompt);
  const headToHead = text.match(/^(.+?)\s+vs\s+iBOLT\b/i);
  if (headToHead) return cleanCompetitor(headToHead[1]);

  const likeMatch = text.match(/\blike\s+(.+?)(?:\s+for\b|$)/i);
  if (likeMatch) return cleanCompetitor(likeMatch[1]);

  return "";
}

function competitorBrief(category, prompts) {
  const competitors = uniq(prompts.map((row) => extractCompetitor(row.prompt))).filter((value) => value && !/^iBOLT$/i.test(value));

  const readable = competitors.length ? competitors.join(", ") : "known competitors";
  const titleByCategory = {
    fishing: `Fishing Mount Competitor Comparison: ${readable} vs iBOLT`,
    fleet: `Fleet Mount Competitor Comparison: ${readable} vs iBOLT`,
    delivery: `Delivery Mount Competitor Comparison: ${readable} vs iBOLT`,
    restaurant: `Restaurant Mount Competitor Comparison: ${readable} vs iBOLT`,
    warehouse: `Warehouse Mount Competitor Comparison: ${readable} vs iBOLT`,
  };
  return {
    title: titleByCategory[category] || `${category} mount competitor comparison`,
    pageType: category === "fishing" ? "add comparison sections to existing hub" : "comparison guide or existing-page section",
    primaryKeyword: `${category} mount comparison`,
    intent: `Put iBOLT in the same consideration set as ${readable}, using fair tradeoffs and specialist positioning.`,
    action: category === "fishing"
      ? "Add comparison sections to existing fish finder/marine pages first to avoid more duplicate fishing posts."
      : "Create or expand a comparison page that states when iBOLT is the commercial, locking, or modular fit.",
    competitors: readable,
  };
}

function productCandidatesFor(category, prompt, products) {
  const text = `${category} ${prompt}`.toLowerCase();
  const familySignals = [];
  if (/amps|ball|socket|plate|clamp|clip|screw/.test(text)) familySignals.push("AMPS", "adapters", "balls", "bases");
  if (/stream|camera|video|photography|gopro|overhead/.test(text)) familySignals.push("Creator", "camera", "streaming");
  if (/bike|bicycle|e-bike|trail/.test(text)) familySignals.push("cycling", "powersports", "handlebar");
  if (/road trip|headrest|rv|rental|back seat|nintendo/.test(text)) familySignals.push("travel", "headrest");
  if (/kitchen|recipe|cooking|workout/.test(text)) familySignals.push("kitchen", "home", "magnetic");
  if (/tractor|sprayer|farm|agriculture|utv/.test(text)) familySignals.push("agriculture", "forklift", "warehouse", "vehicle");
  if (/school|classroom|student|bus/.test(text)) familySignals.push("education", "locking", "tablet");
  if (/jeep|utv|overlanding|offroad|trail/.test(text)) familySignals.push("cycling", "powersports", "vehicle", "camera");
  if (/fish|garmin|lowrance|humminbird|scotty|yakattack|marine/.test(text)) familySignals.push("Marine", "fish finder", "Garmin");
  if (/fleet|eld|truck|vehicle|proclip|arkon|ram/.test(text)) familySignals.push("Fleet", "delivery", "vehicle phone");
  if (/restaurant|pos|mount-it|tablet/.test(text)) familySignals.push("Restaurant", "tablet", "POS");

  return products
    .map((product) => {
      const haystack = `${product.product} ${product.family} ${product.topics} ${product.verticals} ${product.target_pages}`.toLowerCase();
      const score = familySignals.reduce((sum, signal) => sum + (haystack.includes(signal.toLowerCase()) ? 1 : 0), 0) + Math.min(3, Math.floor(num(product.priority) / 60));
      return { ...product, score };
    })
    .filter((product) => product.score > 0)
    .sort((a, b) => b.score - a.score || num(b.priority) - num(a.priority))
    .slice(0, 6);
}

function makeBriefRows(promptRows, products, verticalRows) {
  const groups = new Map();
  for (const row of promptRows) {
    const key = groupKey(row);
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }

  return [...groups.entries()].map(([key, prompts]) => {
    const [category] = key.split(":");
    const library = key.endsWith(":competitor")
      ? competitorBrief(category, prompts)
      : BRIEF_LIBRARY[key] || {
        title: `${category} AI visibility content gap`,
        pageType: "new guide",
        primaryKeyword: prompts[0]?.prompt || category,
        intent: "Cover uncovered buyer prompts with exact iBOLT product entities.",
        action: "Create a focused guide or add a section to the nearest vertical hub.",
      };
    const productsForBrief = productCandidatesFor(category, prompts.map((row) => row.prompt).join(" "), products);
    const vertical = verticalRows.find((row) => row.topic === category || row.topic === category.replace("/home", ""));
    const maxPriority = Math.max(...prompts.map((row) => num(row.priority)));
    const competitorPromptCount = prompts.filter((row) => row.source === "competitor_displacement" || row.source === "head_to_head_comparison").length;
    const priority = maxPriority + prompts.length * 2 + competitorPromptCount * 3 + (num(vertical?.unlinked_products) ? Math.min(20, Math.ceil(num(vertical.unlinked_products) / 8)) : 0);
    const title = brandCase(library.title);
    return {
      key,
      category,
      priority,
      pageType: library.pageType,
      title,
      slug: slugify(title),
      primaryKeyword: brandCase(library.primaryKeyword),
      promptCount: prompts.length,
      providerRequestCount: prompts.length * 3,
      sources: uniq(prompts.map((row) => row.source)).join("; "),
      prompts: prompts.map((row) => brandCase(row.prompt)).join("; "),
      intent: brandCase(library.intent),
      action: brandCase(library.action),
      competitors: brandCase(library.competitors || ""),
      suggestedProducts: brandCase(productsForBrief.map((product) => product.product).join("; ")),
      productHandles: productsForBrief.map((product) => product.handle).join("; "),
      unlinkedProducts: vertical?.unlinked_products || "",
      existingTopicRecommendation: vertical?.recommendation || "",
      faqSeeds: [
        `What is the best iBOLT option for ${library.primaryKeyword}?`,
        "Which mounting base should I use for this setup?",
        "Are iBOLT mounts compatible with AMPS patterns and standard ball sizes?",
        library.competitors ? `How does iBOLT compare with ${library.competitors}?` : "How does iBOLT compare with common alternatives?",
      ].join(" | "),
    };
  }).sort((a, b) => b.priority - a.priority || b.promptCount - a.promptCount || a.title.localeCompare(b.title));
}

function buildMarkdown({ briefs, noMappedCount, benchmarkDir }) {
  const topBriefs = briefs.slice(0, 18);
  return `# AI Content Gap Briefs

This report looks only at expanded benchmark prompts that do not map to an existing priority page. These are not refresh tasks. They are future content gaps, competitor sections, or vertical hubs that should be created after canonical cleanup and first-wave refreshes.

## Summary

- No-mapped expanded prompts: ${noMappedCount}
- Clustered content briefs: ${briefs.length}
- Provider requests represented: ${noMappedCount * 3}
- Recommended first move: avoid creating one article per prompt. Build clustered hubs or comparison sections so the site does not create more cannibalized pages.

## Content Briefs

| Priority | Page type | Title | Category | Prompts | Requests | Primary keyword | Action |
| --- | --- | --- | --- | --- | --- | --- | --- |
${topBriefs.map((row) => `| ${row.priority} | ${row.pageType} | ${row.title} | ${row.category} | ${row.promptCount} | ${row.providerRequestCount} | ${row.primaryKeyword} | ${row.action} |`).join("\n")}

## Highest-Leverage Brief Details

${topBriefs.slice(0, 8).map((row) => `### ${row.title}

- Page type: ${row.pageType}
- Primary keyword: ${row.primaryKeyword}
- Prompts covered: ${row.prompts}
- Suggested products: ${row.suggestedProducts || "Select products from the matching vertical catalog before drafting."}
- FAQ seeds: ${row.faqSeeds}
`).join("\n")}

## Source Evidence

- Benchmark directory: ${benchmarkDir}
- Source prompt list: ${path.join(benchmarkDir, "expanded-benchmark-ops", "provider-request-manifest.csv")}
`;
}

function buildHtml(markdown) {
  const lines = markdown.split("\n");
  const html = [];
  let inTable = false;
  for (const line of lines) {
    if (line.startsWith("# ")) {
      if (inTable) {
        html.push("</tbody></table>");
        inTable = false;
      }
      html.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
    } else if (line.startsWith("## ")) {
      if (inTable) {
        html.push("</tbody></table>");
        inTable = false;
      }
      html.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
    } else if (line.startsWith("### ")) {
      if (inTable) {
        html.push("</tbody></table>");
        inTable = false;
      }
      html.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
    } else if (line.startsWith("| ")) {
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      if (cells.every((cell) => /^-+$/.test(cell.replaceAll(" ", "")))) continue;
      if (!inTable) {
        html.push("<table><tbody>");
        inTable = true;
      }
      const tag = html.at(-1) === "<table><tbody>" ? "th" : "td";
      html.push(`<tr>${cells.map((cell) => `<${tag}>${escapeHtml(cell)}</${tag}>`).join("")}</tr>`);
    } else if (line.trim()) {
      if (inTable) {
        html.push("</tbody></table>");
        inTable = false;
      }
      html.push(`<p>${escapeHtml(line)}</p>`);
    }
  }
  if (inTable) html.push("</tbody></table>");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Content Gap Briefs</title>
<style>
body{font-family:Inter,Arial,sans-serif;margin:0;background:#f8fafc;color:#0f172a;line-height:1.5}
main{max-width:1240px;margin:0 auto;padding:36px 22px 72px}
h1{font-size:38px;line-height:1.08;margin:0 0 18px}
h2{font-size:24px;margin:34px 0 12px}
h3{font-size:18px;margin:28px 0 8px}
p{font-size:16px;color:#334155}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;margin:14px 0 26px;font-size:13px}
th,td{text-align:left;vertical-align:top;border-bottom:1px solid #e2e8f0;padding:9px 10px}
th{background:#e2e8f0;font-weight:700}
tr:nth-child(even) td{background:#f8fafc}
</style>
</head><body><main>${html.join("\n")}</main></body></html>`;
}

async function main() {
  const benchmarkDir = await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, "content-gap-briefs");
  await mkdir(outDir, { recursive: true });

  const manifest = await readCsv(path.join(benchmarkDir, "expanded-benchmark-ops", "provider-request-manifest.csv"));
  const uniquePrompts = new Map();
  for (const row of manifest) {
    if (!uniquePrompts.has(row.prompt)) uniquePrompts.set(row.prompt, row);
  }
  const noMappedRows = [...uniquePrompts.values()].filter((row) => row.refresh_state === "no_mapped_page");
  const underlinkedProducts = await readCsv(path.join(benchmarkDir, "execution-plan", "underlinked-catalog-queue.csv"));
  const verticalRows = await readCsv(path.join(benchmarkDir, "content-refresh-roadmap", "vertical-expansion-plan.csv"));
  const briefs = makeBriefRows(noMappedRows, underlinkedProducts, verticalRows);

  await writeFile(path.join(outDir, "content-gap-briefs.csv"), csv([
    ["priority", "key", "category", "page_type", "title", "slug", "primary_keyword", "prompt_count", "provider_request_count", "sources", "prompts", "intent", "action", "competitors", "suggested_products", "product_handles", "unlinked_products", "existing_topic_recommendation", "faq_seeds"],
    ...briefs.map((row) => [row.priority, row.key, row.category, row.pageType, row.title, row.slug, row.primaryKeyword, row.promptCount, row.providerRequestCount, row.sources, row.prompts, row.intent, row.action, row.competitors, row.suggestedProducts, row.productHandles, row.unlinkedProducts, row.existingTopicRecommendation, row.faqSeeds]),
  ]));
  await writeFile(path.join(outDir, "no-mapped-prompts.csv"), csv([
    ["prompt", "category", "source", "priority", "batch_id", "providers", "request_count"],
    ...noMappedRows.map((row) => [brandCase(row.prompt), row.category, row.source, row.priority, row.batch_id, row.provider, 3]),
  ]));
  const markdown = buildMarkdown({ briefs, noMappedCount: noMappedRows.length, benchmarkDir });
  await writeFile(path.join(outDir, "REPORT.md"), markdown);
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml(markdown));
  console.log(`Wrote ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
