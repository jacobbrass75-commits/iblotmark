import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const AUDIT_PREFIX = "live-blog-ai-citability-merged-";

let sharpModulePromise = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pct(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 100) : 0;
}

function csvCell(value) {
  if (Array.isArray(value)) value = value.join("; ");
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function csv(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

async function latestDir(prefix) {
  const entries = await readdir(path.join(process.cwd(), OUTPUT_ROOT), { withFileTypes: true });
  const name = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!name) throw new Error(`No ${prefix} directory found in ${OUTPUT_ROOT}.`);
  return path.join(process.cwd(), OUTPUT_ROOT, name);
}

function scoreIssue(issue) {
  const weights = {
    "FAQ schema": 14,
    "quick answer": 16,
    "comparison block": 12,
    "image alt text": 5,
    "Article/BlogPosting schema": 10,
  };
  return weights[issue] ?? 4;
}

function normalizeText(value) {
  return String(value ?? "").toLowerCase();
}

function productFamily(product) {
  const name = normalizeText(`${product.title} ${product.handle}`);
  const context = normalizeText(`${(product.topics ?? []).join(" ")} ${(product.verticals ?? []).join(" ")}`);
  if (/barcode|scanner|zebra|honeywell|symbol/.test(name)) return "Barcode scanner and warehouse scanning";
  if (/fish finder|marine|boat|kayak|pontoon|garmin|lowrance|humminbird/.test(name)) return "Marine electronics and fish finder mounts";
  if (/camera|gopro|stream|creator|¼|1\/4|overhead|product photography/.test(name)) return "Creator, camera, and streaming mounts";
  if (/charge|nfc|usb-c|charging|safemag|magnetic/.test(name)) return "Charging and magnetic phone docks";
  if (/headrest|road trip|travel|nintendo/.test(name)) return "Travel and headrest mounts";
  if (/moto|motorcycle|bike|cycling|handlebar/.test(name)) return "Cycling, motorcycle, and powersports";
  if (/tractor|agriculture|farming/.test(name)) return "Agriculture and tractor mounts";
  if (/tablet tower|\bpos\b|restaurant|dock.n.lock|dock-n-lock|lockpro/.test(name)) return "Restaurant POS and tablet security";
  if (/forklift|warehouse|vesa|pillar/.test(name)) return "Forklift and warehouse mounts";
  if (/cup holder|console|dash|windshield|suction|vehicle|fleet|eld|truck/.test(name)) return "Fleet, delivery, and vehicle phone mounts";
  if (/clamp|amps|adapter|ball|plate|socket|drill base|base|arm/.test(name)) return "AMPS, adapters, balls, and bases";
  if (/kitchen|home/.test(name) || /kitchen/.test(context)) return "Kitchen and home mounting";
  if (/restaurant/.test(context)) return "Restaurant POS and tablet security";
  if (/warehouse/.test(context)) return "Forklift and warehouse mounts";
  if (/fleet|delivery/.test(context)) return "Fleet, delivery, and vehicle phone mounts";
  if (/streaming/.test(context)) return "Creator, camera, and streaming mounts";
  return "General mounting catalog";
}

function topicFromProduct(product) {
  const highRisk = ["fishing", "tablet", "fleet", "delivery", "restaurant", "warehouse"];
  return (product.topics ?? []).find((topic) => highRisk.includes(topic)) ?? product.topics?.[0] ?? "other";
}

function buildProductFamilyRows(productGaps, pageActions) {
  const byFamily = new Map();
  for (const product of productGaps) {
    const family = productFamily(product);
    if (!byFamily.has(family)) {
      byFamily.set(family, {
        family,
        products: [],
        topics: new Map(),
        targetPages: new Set(),
      });
    }
    const item = byFamily.get(family);
    item.products.push(product);
    for (const topic of product.topics ?? []) item.topics.set(topic, (item.topics.get(topic) ?? 0) + 1);
  }
  for (const item of byFamily.values()) {
    const topics = [...item.topics.entries()].sort((a, b) => b[1] - a[1]).map(([topic]) => topic);
    for (const action of pageActions) {
      if (topics.includes(action.category)) item.targetPages.add(action.pageTitle);
      if (item.family.includes("Barcode") && /barcode|forklift|warehouse/i.test(action.pageTitle)) item.targetPages.add(action.pageTitle);
      if (item.family.includes("Marine") && /fish|boat|marine|kayak/i.test(action.pageTitle)) item.targetPages.add(action.pageTitle);
      if (item.family.includes("Restaurant") && /restaurant|tablet|pos|food/i.test(action.pageTitle)) item.targetPages.add(action.pageTitle);
      if (item.family.includes("Fleet") && /phone|delivery|fleet|truck|vehicle/i.test(action.pageTitle)) item.targetPages.add(action.pageTitle);
      if (item.family.includes("Creator") && /stream|camera|creator|overhead/i.test(action.pageTitle)) item.targetPages.add(action.pageTitle);
    }
  }
  return [...byFamily.values()].map((item) => ({
    family: item.family,
    unlinkedProducts: item.products.length,
    topics: [...item.topics.entries()].sort((a, b) => b[1] - a[1]).map(([topic, count]) => `${topic} ${count}`),
    sampleProducts: item.products.slice(0, 8).map((product) => product.title),
    targetPages: [...item.targetPages].slice(0, 8),
    action: productFamilyAction(item.family),
  })).sort((a, b) => b.unlinkedProducts - a.unlinkedProducts || a.family.localeCompare(b.family));
}

function productFamilyAction(family) {
  if (family.includes("AMPS")) return "Create SKU-level internal links from AMPS guide sections to plates, balls, socket arms, clamps, and drill bases.";
  if (family.includes("Barcode")) return "Add scanner holder comparison module to forklift and warehouse pages, including Zebra/Honeywell/Symbol compatibility language.";
  if (family.includes("Forklift")) return "Add forklift pillar, VESA, and heavy vibration product modules to warehouse pages.";
  if (family.includes("Restaurant")) return "Add best-for table covering Tablet Tower, LockPro, Dock'n Lock, wall mounts, and clamp mounts.";
  if (family.includes("Marine")) return "Add fish finder and AMPS plate modules that explicitly mention Garmin, Lowrance, Humminbird fit contexts.";
  if (family.includes("Creator")) return "Add creator rig modules for overhead, product photography, livestreaming, and multi-camera setups.";
  if (family.includes("Charging")) return "Add charging dock blocks to delivery, fleet, and travel pages where phone uptime is a buyer concern.";
  if (family.includes("Fleet")) return "Add commercial phone holder modules to delivery, Amazon Flex, construction, and ELD pages.";
  return "Add contextual product cards to the most relevant high-risk pages.";
}

function rankedProductsForPage(page, productGaps) {
  const pageText = normalizeText(`${page.pageTitle} ${page.category} ${(page.prompts ?? []).join(" ")}`);
  return productGaps
    .map((product) => ({ product, score: productPageScore(product, pageText, page.category) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.product.title.localeCompare(b.product.title))
    .slice(0, 6)
    .map((row) => row.product.title);
}

function productPageScore(product, pageText, category) {
  const name = normalizeText(`${product.title} ${product.handle}`);
  const topics = product.topics ?? [];
  let score = topics.includes(category) ? 10 : 0;
  if (topics.includes("amps/modular")) score += 1;
  if (/accessibolt|wheelchair|mobility/.test(name) && !/accessib|wheelchair|mobility/.test(pageText)) score -= 30;
  if (/tablet|multi tablet|restaurant|pos|doordash|uber eats|grubhub|food truck/.test(pageText)) {
    if (/tablet|tabdock|tablet tower|pos|lockpro|dock.n.lock|dock-n-lock|wall mount|clamp mount/.test(name)) score += 18;
    if (/camera|phone holder|iphone|motorcycle|bike/.test(name)) score -= 8;
  }
  if (/delivery|amazon flex|instacart|phone|construction|work truck|vehicle|fleet|eld|semi/.test(pageText)) {
    if (/phone|xprodock|minipro|chargedock|safemag|suction|cup holder|dash|windshield|moto-vise|dock.n.lock|dock-n-lock/.test(name)) score += 18;
    if (/tablet tower|fish finder|scanner|action camera|camera screw|gopro|¼|1\/4/.test(name)) score -= 30;
  }
  if (/fish|boat|marine|kayak|pontoon|garmin|lowrance|humminbird/.test(pageText)) {
    if (/fish finder|marine|boat|kayak|pontoon|garmin|amps plate|mounting plate|seatrail/.test(name)) score += 20;
    if (/restaurant|scanner|phone holder|iphone/.test(name)) score -= 8;
  }
  if (/warehouse|forklift|barcode|scanner|zebra|honeywell|symbol/.test(pageText)) {
    if (/barcode|scanner|forklift|pillar|vesa|tablet|tabdock|magnetic/.test(name)) score += 20;
    if (/restaurant|fish finder|headrest/.test(name)) score -= 8;
  }
  if (/stream|camera|creator|overhead|product photography|live/.test(pageText)) {
    if (/camera|gopro|stream|creator|overhead|¼|1\/4|20/.test(name)) score += 20;
    if (/scanner|fish finder|restaurant/.test(name)) score -= 8;
  }
  if (/kitchen|home/.test(pageText)) {
    if (/kitchen|tablet|clamp|magnetic|counter|stand/.test(name)) score += 10;
  }
  return score;
}

function buildRefreshBriefs({ pageActions, postRows, liveRows, productFamilyRows, productGaps, productRows }) {
  const postByUrl = new Map(postRows.filter((row) => row.auditUrl).map((row) => [row.auditUrl, row]));
  const liveByUrl = new Map(liveRows.map((row) => [row.url, row]));
  const productTitleByHandle = new Map((productRows ?? []).map((product) => [product.handle, product.title]));
  return pageActions.map((page) => {
    const post = postByUrl.get(page.pageUrl) ?? {};
    const live = liveByUrl.get(page.pageUrl) ?? {};
    const issueScore = (page.structuralIssues ?? []).reduce((sum, issue) => sum + scoreIssue(issue), 0);
    const benchmarkPressure = Math.max(0, 70 - Number(page.avgPromptScore || 0));
    const priority = Math.round(Number(page.priority || 0) + issueScore + benchmarkPressure / 4 + Math.min(10, Number(page.promptCount || 0) * 2));
    const currentProductTitles = (post.productHandles ?? [])
      .map((handle) => productTitleByHandle.get(handle) ?? handle)
      .filter(Boolean);
    const gapProducts = rankedProductsForPage(page, productGaps);
    const productsToAdd = [...new Set([...currentProductTitles, ...gapProducts])].slice(0, 6);
    const copyBrief = [
      "Add a direct answer at the top that uses the exact query language.",
      page.competitors?.length ? `Add a fair comparison block against ${page.competitors.slice(0, 5).join(", ")}.` : "Add a comparison block against common alternatives.",
      productsToAdd.length ? `Add product module candidates: ${productsToAdd.slice(0, 4).join("; ")}.` : "Add product-specific recommendation module with price and use case.",
      "End with a soft CTA to the relevant product/collection and mount configurator.",
    ].join(" ");
    return {
      priority,
      pageTitle: page.pageTitle,
      pageUrl: page.pageUrl,
      category: page.category,
      prompts: page.prompts ?? [],
      benchmarkAvgScore: page.avgPromptScore,
      aiCitabilityScore: page.pageScore,
      wordCount: live.wordCount ?? post.wordCount ?? "",
      issues: page.structuralIssues ?? [],
      competitors: page.competitors ?? [],
      currentProducts: post.productHandles ?? [],
      productsToAdd,
      schemaFixes: schemaFixes(page.structuralIssues ?? []),
      copyBrief,
      shopifyArticleId: post.shopifyArticleId ?? "",
    };
  }).sort((a, b) => b.priority - a.priority || a.pageTitle.localeCompare(b.pageTitle));
}

function schemaFixes(issues) {
  const fixes = [];
  if (issues.includes("FAQ schema")) fixes.push("FAQPage JSON-LD");
  if (issues.includes("Article/BlogPosting schema")) fixes.push("BlogPosting JSON-LD");
  if (issues.includes("quick answer")) fixes.push("visible quick-answer block");
  if (issues.includes("comparison block")) fixes.push("comparison table/list");
  if (issues.includes("image alt text")) fixes.push("descriptive product alt text");
  return fixes;
}

function buildAllPostMap({ postRows, liveRows, pageActions, duplicateRows }) {
  const actionByUrl = new Map(pageActions.map((row) => [row.pageUrl, row]));
  const duplicateUrlSet = new Set(duplicateRows.flatMap((row) => [row.urlA, row.urlB]));
  const liveByUrl = new Map(liveRows.map((row) => [row.url, row]));
  return postRows.map((post) => {
    const action = actionByUrl.get(post.auditUrl) ?? {};
    const live = liveByUrl.get(post.auditUrl) ?? {};
    const issues = [...new Set([...(post.issues ?? []), ...(live.recommendedFixes ?? []).map(shortIssueFromFix).filter(Boolean)])];
    const basePriority = Number(post.refreshPriority || 0) + Number(action.priority || 0);
    const issuePriority = issues.reduce((sum, issue) => sum + scoreIssue(issue), 0);
    const duplicatePenalty = duplicateUrlSet.has(post.auditUrl) ? 25 : 0;
    const unknownPenalty = (post.unknownProductHandles ?? []).length ? 15 : 0;
    const priority = Math.round(basePriority + issuePriority + duplicatePenalty + unknownPenalty);
    return {
      priority,
      title: post.title,
      slug: post.slug,
      url: post.auditUrl,
      topic: post.topic,
      vertical: post.vertical,
      status: post.status,
      wordCount: post.wordCount,
      aiCitabilityScore: post.aiCitabilityScore,
      productLinkCount: post.productLinkCount,
      issues,
      linkedPrompts: post.linkedPrompts ?? [],
      competitors: post.competitors ?? action.competitors ?? [],
      currentProducts: post.productHandles ?? [],
      unknownProductHandles: post.unknownProductHandles ?? [],
      duplicateRisk: duplicateUrlSet.has(post.auditUrl),
      nextAction: postNextAction({ post, action, issues, duplicateRisk: duplicateUrlSet.has(post.auditUrl) }),
    };
  }).sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));
}

function shortIssueFromFix(fix) {
  if (/FAQ/.test(fix)) return "FAQ schema";
  if (/quick-answer|quick answer/.test(fix)) return "quick answer";
  if (/comparison|tradeoff/.test(fix)) return "comparison block";
  if (/alt text/.test(fix)) return "image alt text";
  if (/Article|BlogPosting/.test(fix)) return "Article/BlogPosting schema";
  return "";
}

function postNextAction({ post, action, issues, duplicateRisk }) {
  if (duplicateRisk) return "Review for canonical merge or redirect before rewriting.";
  if ((post.unknownProductHandles ?? []).length) return "Fix product handle references so product modules and add-to-cart links resolve.";
  if (action.pageUrl) return action.concreteEdit;
  if (issues.length) return `Refresh structure: ${schemaFixes(issues).join(", ") || issues.join(", ")}.`;
  return "Monitor. No urgent benchmark-linked edit.";
}

function buildDuplicatePlan(duplicateRows, liveRows) {
  const liveByUrl = new Map(liveRows.map((row) => [row.url, row]));
  return duplicateRows.map((row) => {
    const liveA = liveByUrl.get(row.urlA) ?? {};
    const liveB = liveByUrl.get(row.urlB) ?? {};
    const scoreA = Number(liveA.aiCitabilityScore ?? 0);
    const scoreB = Number(liveB.aiCitabilityScore ?? 0);
    const canonical = chooseCanonical(row, scoreA, scoreB);
    const duplicate = canonical === "A" ? "B" : "A";
    return {
      duplicateScore: row.score,
      category: row.categoryA || row.categoryB,
      canonicalTitle: canonical === "A" ? row.titleA : row.titleB,
      canonicalUrl: canonical === "A" ? row.urlA : row.urlB,
      duplicateTitle: duplicate === "A" ? row.titleA : row.titleB,
      duplicateUrl: duplicate === "A" ? row.urlA : row.urlB,
      canonicalScore: canonical === "A" ? scoreA : scoreB,
      duplicatePageScore: duplicate === "A" ? scoreA : scoreB,
      action: "Merge useful content into canonical page, then redirect or unpublish duplicate if Shopify/admin policy allows.",
    };
  }).sort((a, b) => b.duplicateScore - a.duplicateScore || a.category.localeCompare(b.category));
}

function chooseCanonical(row, scoreA, scoreB) {
  if (scoreA !== scoreB) return scoreA > scoreB ? "A" : "B";
  const aLooksCopy = /-1$/.test(row.urlA) || /copy/i.test(row.titleA);
  const bLooksCopy = /-1$/.test(row.urlB) || /copy/i.test(row.titleB);
  if (aLooksCopy !== bLooksCopy) return aLooksCopy ? "B" : "A";
  return row.urlA.length <= row.urlB.length ? "A" : "B";
}

function buildVerticalRows({ mentionTopicRows, blogTopicRows, productGaps, liveSummary }) {
  const mentionByTopic = new Map(mentionTopicRows.map((row) => [row.topic, row]));
  const blogByTopic = new Map(blogTopicRows.map((row) => [row.topic, row]));
  const gapsByTopic = new Map();
  for (const product of productGaps) {
    for (const topic of product.topics ?? ["other"]) gapsByTopic.set(topic, (gapsByTopic.get(topic) ?? 0) + 1);
  }
  const liveByTopic = new Map((liveSummary.categories ?? []).map((row) => [row.category, row]));
  const topics = [...new Set([...mentionByTopic.keys(), ...blogByTopic.keys(), ...gapsByTopic.keys(), ...liveByTopic.keys()])];
  return topics.map((topic) => {
    const mention = mentionByTopic.get(topic) ?? {};
    const blog = blogByTopic.get(topic) ?? {};
    const live = liveByTopic.get(topic) ?? {};
    const unlinkedProducts = gapsByTopic.get(topic) ?? 0;
    const posts = Number(blog.posts || 0);
    const riskScore = Number(mention.riskScore || 0);
    const avgPageScore = Number(live.avgScore || blog.avgPageScore || 0);
    const priority = topic === "comparison"
      ? 30
      : Math.round(riskScore + Math.max(0, 80 - avgPageScore) + Math.min(35, unlinkedProducts) + (posts < 4 ? 18 : 0));
    return {
      priority,
      topic,
      benchmarkRisk: riskScore || "",
      mentionRate: mention.mentionRate ?? "",
      competitorOnlyRate: mention.competitorOnlyRate ?? "",
      localPosts: posts || "",
      auditedPages: live.count ?? mention.auditedPages ?? "",
      avgPageScore: avgPageScore || "",
      uniqueProducts: blog.uniqueProducts ?? "",
      unlinkedProducts,
      recommendation: verticalRecommendation(topic, posts, unlinkedProducts, mention),
    };
  }).sort((a, b) => b.priority - a.priority || a.topic.localeCompare(b.topic));
}

function verticalRecommendation(topic, posts, unlinkedProducts, mention) {
  if (topic === "comparison") return "Keep comparison pages, but treat them as supporting content rather than a standalone vertical.";
  if (topic === "fishing") return "Consolidate and refresh existing fish finder pages, add Garmin/Lowrance/Humminbird comparison language, avoid net-new duplicate posts.";
  if (topic === "tablet") return "Create or strengthen one broad tablet mount hub that routes to restaurant, warehouse, fleet, and travel tablet use cases.";
  if (topic === "delivery") return "Refresh delivery pages around commercial-grade retention, heat/vibration, charging, and exact app workflows.";
  if (topic === "fleet") return "Add heavier comparison blocks versus RAM, Arkon, ProClip, and consumer phone mounts.";
  if (topic === "warehouse") return "Expand barcode scanner and forklift tablet content with product-specific modules and Zebra/Honeywell/Symbol compatibility.";
  if (topic === "restaurant") return "Merge restaurant POS duplicates and make Tablet Tower, LockPro, Dock'n Lock, and wall/clamp options explicit.";
  if (topic === "kitchen") return "Build a Kitchen & Home hub because products exist but blog coverage is thin.";
  if (topic === "travel") return "Build road-trip/headrest/charging content that links underused travel products.";
  if (unlinkedProducts > 20) return "Use existing pages as internal-link hubs for underlinked products before adding more broad posts.";
  if (posts < 4) return "Add a small vertical hub and two product-led supporting posts.";
  return "Refresh structure and product modules; monitor benchmark movement.";
}

function svgShell(width, height, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
  <style>
    .bg{fill:#f8fafc}.panel{fill:#fff;stroke:#d7dee8;stroke-width:1}.title{font:700 24px Arial,sans-serif;fill:#111827}.subtitle{font:400 14px Arial,sans-serif;fill:#64748b}.label{font:700 13px Arial,sans-serif;fill:#111827}.small{font:400 12px Arial,sans-serif;fill:#475569}.value{font:700 13px Arial,sans-serif;fill:#0f172a}
  </style>
  <rect class="bg" width="${width}" height="${height}"/>
  ${body}
</svg>`;
}

function wrapText(value, maxChars) {
  const words = String(value ?? "").replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function barChart({ title, subtitle, rows, color = "#2563eb", maxValue }) {
  const width = 1220;
  const rowH = 52;
  const height = 128 + rows.length * rowH + 34;
  const left = 430;
  const top = 108;
  const barW = width - left - 150;
  const max = maxValue || Math.max(1, ...rows.map((row) => Number(row.value || 0)));
  const body = rows.map((row, index) => {
    const y = top + index * rowH;
    const value = Number(row.value || 0);
    const w = Math.max(value > 0 ? 4 : 0, Math.round((value / max) * barW));
    const labels = wrapText(row.label, 48).map((line, lineIndex) =>
      `<text class="${lineIndex === 0 ? "label" : "small"}" x="54" y="${y + 14 + lineIndex * 15}">${escapeHtml(line)}</text>`
    ).join("\n");
    return `
      ${labels}
      <rect x="${left}" y="${y}" width="${barW}" height="24" rx="8" fill="#e2e8f0"/>
      <rect x="${left}" y="${y}" width="${w}" height="24" rx="8" fill="${color}"/>
      <text class="value" x="${left + barW + 14}" y="${y + 17}">${escapeHtml(row.display ?? value)}</text>
      <text class="small" x="${left}" y="${y + 42}">${escapeHtml(row.note || "")}</text>
    `;
  }).join("\n");
  return svgShell(width, height, `
    <rect class="panel" x="28" y="24" width="${width - 56}" height="${height - 48}" rx="14"/>
    <text class="title" x="54" y="64">${escapeHtml(title)}</text>
    <text class="subtitle" x="54" y="88">${escapeHtml(subtitle)}</text>
    ${body}
  `);
}

async function writeSvgAndPng(outDir, filename, svg) {
  await writeFile(path.join(outDir, `${filename}.svg`), svg);
  try {
    sharpModulePromise ||= import("sharp");
    const sharp = (await sharpModulePromise).default;
    await sharp(Buffer.from(svg)).png().toFile(path.join(outDir, `${filename}.png`));
  } catch (error) {
    console.warn(`Could not render ${filename}.png: ${error.message}`);
  }
}

function buildHtml({ summary, refreshBriefs, duplicatePlan, productFamilyRows, verticalRows, allPostMap }) {
  const cards = [
    ["Blog posts analyzed", summary.localPosts, "local published inventory"],
    ["Live pages audited", summary.auditedPages, "public/fallback pages"],
    ["Page refresh briefs", refreshBriefs.length, "benchmark-linked edits"],
    ["Duplicate pairs", duplicatePlan.length, "canonical cleanup candidates"],
    ["Unlinked products", summary.unlinkedProducts, `${summary.unlinkedProductRate}% of catalog`],
    ["Product families", productFamilyRows.length, "grouped linking opportunities"],
    ["All-post map", allPostMap.length, "every local post scored"],
    ["Top priority", refreshBriefs[0]?.pageTitle ?? "n/a", "first edit target"],
  ].map(([label, value, note]) => `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div><div class="s">${escapeHtml(note)}</div></div>`).join("");

  const refreshRows = refreshBriefs.slice(0, 20).map((row) => `
    <tr><td>${row.priority}</td><td><a href="${escapeHtml(row.pageUrl)}">${escapeHtml(row.pageTitle)}</a></td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.prompts.slice(0, 3).join("; "))}</td><td>${escapeHtml(row.competitors.slice(0, 5).join(", "))}</td><td>${escapeHtml(row.schemaFixes.join(", "))}</td><td>${escapeHtml(row.productsToAdd.slice(0, 4).join("; "))}</td></tr>
  `).join("");
  const duplicateRows = duplicatePlan.slice(0, 12).map((row) => `
    <tr><td>${row.duplicateScore}</td><td><a href="${escapeHtml(row.canonicalUrl)}">${escapeHtml(row.canonicalTitle)}</a></td><td><a href="${escapeHtml(row.duplicateUrl)}">${escapeHtml(row.duplicateTitle)}</a></td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.action)}</td></tr>
  `).join("");
  const productRows = productFamilyRows.map((row) => `
    <tr><td>${escapeHtml(row.family)}</td><td>${row.unlinkedProducts}</td><td>${escapeHtml(row.topics.join("; "))}</td><td>${escapeHtml(row.sampleProducts.slice(0, 4).join("; "))}</td><td>${escapeHtml(row.targetPages.slice(0, 4).join("; "))}</td><td>${escapeHtml(row.action)}</td></tr>
  `).join("");
  const verticalHtml = verticalRows.slice(0, 14).map((row) => `
    <tr><td>${row.priority}</td><td>${escapeHtml(row.topic)}</td><td>${escapeHtml(row.benchmarkRisk)}</td><td>${escapeHtml(row.mentionRate)}%</td><td>${escapeHtml(row.competitorOnlyRate)}%</td><td>${escapeHtml(row.localPosts)}</td><td>${row.unlinkedProducts}</td><td>${escapeHtml(row.recommendation)}</td></tr>
  `).join("");
  const postRows = allPostMap.slice(0, 30).map((row) => `
    <tr><td>${row.priority}</td><td><a href="${escapeHtml(row.url)}">${escapeHtml(row.title)}</a></td><td>${escapeHtml(row.topic)}</td><td>${escapeHtml(row.aiCitabilityScore)}</td><td>${row.productLinkCount}</td><td>${escapeHtml(row.issues.join(", "))}</td><td>${escapeHtml(row.nextAction)}</td></tr>
  `).join("");

  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT AI Content Refresh Roadmap</title>
  <style>
    :root{--ink:#111827;--muted:#64748b;--border:#d7dee8;--bg:#f8fafc;--panel:#fff}
    body{margin:0;background:var(--bg);font-family:Arial,Helvetica,sans-serif;color:var(--ink)}
    main{max-width:1280px;margin:0 auto;padding:34px 26px 64px}h1{font-size:34px;margin:0 0 10px}h2{font-size:22px;margin:34px 0 14px}p{font-size:16px;line-height:1.55;color:#334155;max-width:1020px}.meta{font-size:14px;color:var(--muted)}
    .note{background:#fff;border:1px solid var(--border);border-left:6px solid #2563eb;border-radius:10px;padding:16px 18px}
    .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0}.card{background:#fff;border:1px solid var(--border);border-radius:12px;padding:16px}.k{font-size:12px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;font-weight:700}.v{font-size:26px;font-weight:800;margin-top:8px}.s{font-size:13px;color:var(--muted)}
    figure{background:#fff;border:1px solid var(--border);border-radius:14px;margin:14px 0;padding:10px;overflow:auto}figure img{display:block;width:100%;height:auto}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:22px}th,td{text-align:left;vertical-align:top;padding:11px 12px;border-bottom:1px solid #edf2f7;font-size:14px}th{background:#f1f5f9;color:#475569;font-size:12px;letter-spacing:.04em;text-transform:uppercase}a{color:#0f3f91}
    @media(max-width:980px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media print{body{background:#fff}main{max-width:none;padding:18px}.grid{grid-template-columns:repeat(4,1fr)}figure,.card,table{break-inside:avoid}}
  </style>
</head><body><main>
  <div class="meta">Generated from benchmark mention landscape, live blog audit, and local product/blog inventory</div>
  <h1>iBOLT AI Content Refresh Roadmap</h1>
  <p class="note"><strong>Execution read:</strong> do not just create more blogs. Refresh the pages already mapped to lost AI prompts, consolidate duplicates, and add product-specific modules for underlinked families. This directly targets mention rate, citation readiness, and conversion paths.</p>
  <section class="grid">${cards}</section>
  <h2>Charts</h2>
  <figure><img src="page-refresh-priority.svg" alt="Page refresh priorities"/></figure>
  <figure><img src="product-family-gaps.svg" alt="Product family gaps"/></figure>
  <figure><img src="vertical-expansion-priority.svg" alt="Vertical expansion priorities"/></figure>
  <h2>Page Refresh Briefs</h2>
  <table><thead><tr><th>Priority</th><th>Page</th><th>Topic</th><th>Prompts</th><th>Competitors</th><th>Schema/content fixes</th><th>Products to add</th></tr></thead><tbody>${refreshRows}</tbody></table>
  <h2>Duplicate Consolidation</h2>
  <table><thead><tr><th>Score</th><th>Canonical</th><th>Duplicate</th><th>Topic</th><th>Action</th></tr></thead><tbody>${duplicateRows}</tbody></table>
  <h2>Product Linking Plan</h2>
  <table><thead><tr><th>Family</th><th>Unlinked</th><th>Topics</th><th>Sample products</th><th>Target pages</th><th>Action</th></tr></thead><tbody>${productRows}</tbody></table>
  <h2>Vertical Expansion</h2>
  <table><thead><tr><th>Priority</th><th>Topic</th><th>Risk</th><th>Mention</th><th>Competitor-only</th><th>Posts</th><th>Unlinked products</th><th>Recommendation</th></tr></thead><tbody>${verticalHtml}</tbody></table>
  <h2>All Blog Post Action Map</h2>
  <table><thead><tr><th>Priority</th><th>Post</th><th>Topic</th><th>AI score</th><th>Product links</th><th>Issues</th><th>Next action</th></tr></thead><tbody>${postRows}</tbody></table>
</main></body></html>`;
}

function buildMarkdown({ summary, refreshBriefs, duplicatePlan, productFamilyRows, verticalRows, allPostMap }) {
  return `# iBOLT AI Content Refresh Roadmap

## Scope

- Blog posts analyzed: ${summary.localPosts}
- Shopify-synced local posts: ${summary.shopifySynced}
- Live/audited pages: ${summary.auditedPages}
- Products in catalog: ${summary.products}
- Linked products: ${summary.linkedProducts}
- Unlinked products: ${summary.unlinkedProducts} (${summary.unlinkedProductRate}%)
- Duplicate/cannibalized pairs: ${duplicatePlan.length}
- All-post action rows: ${allPostMap.length}

## What To Do First

${refreshBriefs.slice(0, 10).map((row, index) => `${index + 1}. ${row.pageTitle}: ${row.copyBrief}`).join("\n")}

## Duplicate Cleanup

${duplicatePlan.slice(0, 8).map((row) => `- Keep ${row.canonicalTitle}; merge/redirect ${row.duplicateTitle}.`).join("\n")}

## Product Linking Priorities

${productFamilyRows.slice(0, 10).map((row) => `- ${row.family}: ${row.unlinkedProducts} unlinked products. ${row.action}`).join("\n")}

## Vertical Expansion Priorities

${verticalRows.slice(0, 10).map((row) => `- ${row.topic}: priority ${row.priority}, risk ${row.benchmarkRisk || "n/a"}, posts ${row.localPosts || "n/a"}, unlinked products ${row.unlinkedProducts}. ${row.recommendation}`).join("\n")}

## Highest-Risk Posts Across Full Inventory

${allPostMap.slice(0, 15).map((row) => `- ${row.title}: priority ${row.priority}, AI score ${row.aiCitabilityScore}, action: ${row.nextAction}`).join("\n")}
`;
}

async function main() {
  const benchmarkDir = process.argv[2] ? path.resolve(process.argv[2]) : await latestDir(BENCHMARK_PREFIX);
  const auditDir = process.argv[3] ? path.resolve(process.argv[3]) : await latestDir(AUDIT_PREFIX);
  const outDir = path.join(benchmarkDir, "content-refresh-roadmap");
  await mkdir(outDir, { recursive: true });

  const mention = JSON.parse(await readFile(path.join(benchmarkDir, "mention-landscape", "mention-landscape-data.json"), "utf8"));
  const blogAudit = JSON.parse(await readFile(path.join(benchmarkDir, "blog-inventory-audit", "blog-inventory-audit-data.json"), "utf8"));
  const liveAudit = JSON.parse(await readFile(path.join(auditDir, "live-blog-page-audit.merged.json"), "utf8"));
  const liveRows = liveAudit.rows ?? [];

  const productFamilyRows = buildProductFamilyRows(blogAudit.productGaps, mention.pageActions);
  const refreshBriefs = buildRefreshBriefs({
    pageActions: mention.pageActions,
    postRows: blogAudit.postRows,
    liveRows,
    productFamilyRows,
    productGaps: blogAudit.productGaps,
    productRows: blogAudit.productRows,
  });
  const duplicatePlan = buildDuplicatePlan(blogAudit.duplicateRows, liveRows);
  const allPostMap = buildAllPostMap({
    postRows: blogAudit.postRows,
    liveRows,
    pageActions: mention.pageActions,
    duplicateRows: blogAudit.duplicateRows,
  });
  const verticalRows = buildVerticalRows({
    mentionTopicRows: mention.topicRows,
    blogTopicRows: blogAudit.topicRows,
    productGaps: blogAudit.productGaps,
    liveSummary: liveAudit.summary,
  });

  await writeFile(path.join(outDir, "page-refresh-briefs.csv"), csv([
    ["priority", "page_title", "page_url", "category", "prompts", "benchmark_avg_score", "ai_citability_score", "word_count", "issues", "competitors", "current_products", "products_to_add", "schema_fixes", "copy_brief", "shopify_article_id"],
    ...refreshBriefs.map((row) => [row.priority, row.pageTitle, row.pageUrl, row.category, row.prompts, row.benchmarkAvgScore, row.aiCitabilityScore, row.wordCount, row.issues, row.competitors, row.currentProducts, row.productsToAdd, row.schemaFixes, row.copyBrief, row.shopifyArticleId]),
  ]));
  await writeFile(path.join(outDir, "all-blog-post-action-map.csv"), csv([
    ["priority", "title", "slug", "url", "topic", "vertical", "status", "word_count", "ai_citability_score", "product_link_count", "issues", "linked_prompts", "competitors", "current_products", "unknown_product_handles", "duplicate_risk", "next_action"],
    ...allPostMap.map((row) => [row.priority, row.title, row.slug, row.url, row.topic, row.vertical, row.status, row.wordCount, row.aiCitabilityScore, row.productLinkCount, row.issues, row.linkedPrompts, row.competitors, row.currentProducts, row.unknownProductHandles, row.duplicateRisk, row.nextAction]),
  ]));
  await writeFile(path.join(outDir, "duplicate-consolidation-plan.csv"), csv([
    ["duplicate_score", "category", "canonical_title", "canonical_url", "canonical_score", "duplicate_title", "duplicate_url", "duplicate_score_page", "action"],
    ...duplicatePlan.map((row) => [row.duplicateScore, row.category, row.canonicalTitle, row.canonicalUrl, row.canonicalScore, row.duplicateTitle, row.duplicateUrl, row.duplicatePageScore, row.action]),
  ]));
  await writeFile(path.join(outDir, "product-linking-plan.csv"), csv([
    ["family", "unlinked_products", "topics", "sample_products", "target_pages", "action"],
    ...productFamilyRows.map((row) => [row.family, row.unlinkedProducts, row.topics, row.sampleProducts, row.targetPages, row.action]),
  ]));
  await writeFile(path.join(outDir, "vertical-expansion-plan.csv"), csv([
    ["priority", "topic", "benchmark_risk", "mention_rate", "competitor_only_rate", "local_posts", "audited_pages", "avg_page_score", "unique_products", "unlinked_products", "recommendation"],
    ...verticalRows.map((row) => [row.priority, row.topic, row.benchmarkRisk, row.mentionRate, row.competitorOnlyRate, row.localPosts, row.auditedPages, row.avgPageScore, row.uniqueProducts, row.unlinkedProducts, row.recommendation]),
  ]));
  await writeFile(path.join(outDir, "content-refresh-roadmap-data.json"), JSON.stringify({
    summary: blogAudit.summary,
    liveSummary: liveAudit.summary,
    refreshBriefs,
    duplicatePlan,
    productFamilyRows,
    verticalRows,
    allPostMap,
  }, null, 2));

  await writeSvgAndPng(outDir, "page-refresh-priority", barChart({
    title: "Highest Impact Page Refreshes",
    subtitle: "Priority combines benchmark gaps, missing structure, competitors, and page mapping.",
    rows: refreshBriefs.slice(0, 14).map((row) => ({
      label: row.pageTitle,
      value: row.priority,
      note: `${row.category}; score ${row.aiCitabilityScore}; prompts ${row.prompts.slice(0, 2).join("; ")}`,
    })),
    color: "#2563eb",
  }));
  await writeSvgAndPng(outDir, "product-family-gaps", barChart({
    title: "Underlinked Product Families",
    subtitle: "Grouped from product gap rows where products are not detected in blog content.",
    rows: productFamilyRows.slice(0, 12).map((row) => ({
      label: row.family,
      value: row.unlinkedProducts,
      note: row.topics.slice(0, 5).join("; "),
    })),
    color: "#f97316",
  }));
  await writeSvgAndPng(outDir, "vertical-expansion-priority", barChart({
    title: "Vertical Refresh and Expansion Priority",
    subtitle: "Combines benchmark risk, page score, unlinked product count, and undercoverage.",
    rows: verticalRows.slice(0, 12).map((row) => ({
      label: row.topic,
      value: row.priority,
      note: `risk ${row.benchmarkRisk || "n/a"}; posts ${row.localPosts || "n/a"}; unlinked products ${row.unlinkedProducts}`,
    })),
    color: "#16a34a",
  }));

  await writeFile(path.join(outDir, "REPORT.md"), buildMarkdown({
    summary: blogAudit.summary,
    refreshBriefs,
    duplicatePlan,
    productFamilyRows,
    verticalRows,
    allPostMap,
  }));
  await writeFile(path.join(outDir, "REPORT.html"), buildHtml({
    summary: blogAudit.summary,
    refreshBriefs,
    duplicatePlan,
    productFamilyRows,
    verticalRows,
    allPostMap,
  }));
  console.log(path.relative(process.cwd(), outDir));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
