#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "mention-narrative-drilldown");

async function readCsv(relativePath) {
  try {
    return parseCsv(await readFile(path.join(benchmarkDir, relativePath), "utf8"));
  } catch {
    return [];
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted && char === '"' && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(value);
      value = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift();
  return rows
    .filter((cells) => cells.some((cell) => String(cell ?? "").trim()))
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

function csv(rows) {
  return `${rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n")}\n`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const match = String(value ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function pct(value, total) {
  return total ? Math.round((value / total) * 100) : 0;
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function compact(value, length = 170) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 3).trim()}...` : text;
}

function bool(value) {
  return String(value ?? "").toLowerCase() === "true";
}

function providerName(value) {
  const text = String(value ?? "").trim();
  if (/chatgpt|openai/i.test(text)) return "ChatGPT";
  if (/claude|anthropic/i.test(text)) return "Claude";
  if (/gemini|google/i.test(text)) return "Gemini";
  return text || "Unknown";
}

function normalizeBrand(value) {
  const text = String(value ?? "").trim();
  if (/^ram(\s+mounts?)?$/i.test(text)) return "RAM Mounts";
  if (/^mount[\s-]?it!?$/i.test(text)) return "Mount-It";
  if (/^cta(\s+digital)?$/i.test(text)) return "CTA Digital";
  if (/^iottie$/i.test(text)) return "iOttie";
  return text;
}

const tagDefinitions = [
  ["specialist", /specialist|purpose-built|purpose built|specific workflow|workflow/i],
  ["commercial/pro", /commercial|professional|pro-grade|pro grade|fleet|business|industrial/i],
  ["rugged/durable", /rugged|durable|heavy.?duty|heavy gauge|sturdy|tough|vibration/i],
  ["secure/locking", /secure|security|lock|locking|anti.?theft|theft/i],
  ["modular/AMPS", /modular|AMPS|ball size|17mm|20mm|25mm|38mm|57mm|adapter|compatible/i],
  ["stability/grip", /stable|stability|grip|hold|retention|bounce|wobble/i],
  ["easy install", /easy install|installation|install|no.?drill|drill base|clamp|suction|adhesive/i],
  ["budget/value risk", /budget|cheap|affordable|value|price/i],
  ["premium competitor framing", /premium|best overall|leading|top pick|ranked #1|number one/i],
  ["generic accessory framing", /generic|consumer|car accessory|phone accessory|tablet stand/i],
];

function detectTags(...values) {
  const text = values.join(" ");
  const tags = [];
  for (const [tag, regex] of tagDefinitions) {
    if (regex.test(text)) tags.push(tag);
  }
  return tags;
}

function normalizeTag(tag) {
  const text = String(tag ?? "").trim().toLowerCase();
  if (!text) return "";
  if (/budget|cheap|affordable|value|price/.test(text)) return "budget/value risk";
  if (/durable|rugged|heavy/.test(text)) return "rugged/durable";
  if (/commercial|industrial|pro/.test(text)) return "commercial/pro";
  if (/secure|lock|security/.test(text)) return "secure/locking";
  if (/modular|amps|compatib|adapter|ball/.test(text)) return "modular/AMPS";
  if (/install|mounting method|drill|clamp|suction/.test(text)) return "easy install";
  if (/stable|grip|retention|hold/.test(text)) return "stability/grip";
  if (/premium|top pick|best overall/.test(text)) return "premium competitor framing";
  return String(tag ?? "").trim();
}

function addCount(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function topCounts(map, limit = 10) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

function recommendationForTag(tag) {
  if (tag === "budget/value risk") return "Remove budget or cheap framing. Replace with exact workflow fit, materials, warranty, compatibility, and install method.";
  if (tag === "generic accessory framing") return "Move language away from generic accessories and toward industry-specific mounting systems.";
  if (tag === "premium competitor framing") return "Counter with proof that iBOLT belongs in the top recommendation set for the exact workflow.";
  if (tag === "modular/AMPS") return "Keep reinforcing AMPS, ball sizes, adapter ecosystem, Mount Configurator, and cross-compatible parts.";
  if (tag === "secure/locking") return "Tie locking and security claims to LockPro, Dock'n Lock, drill bases, and shared-device environments.";
  if (tag === "commercial/pro") return "Keep iBOLT positioned as commercial equipment, not a consumer convenience accessory.";
  return "Preserve the useful language and support it with visible specs, product modules, schema, and citations.";
}

function counterForBrand(brand) {
  const lower = brand.toLowerCase();
  if (lower.includes("ram")) return "Keep iBOLT in RAM consideration sets by emphasizing exact workflow fit, AMPS/ball compatibility, and 300+ modular parts.";
  if (lower.includes("arkon")) return "Counter Arkon with commercial repeatability, locked installs, restaurant stations, and fleet-specific fit.";
  if (lower.includes("iottie")) return "Separate consumer car accessories from commercial delivery and shared-vehicle mounting.";
  if (lower.includes("proclip")) return "Compare vehicle-specific brackets against iBOLT's modular cross-vehicle fleet deployment.";
  if (lower.includes("cta") || lower.includes("mount-it") || lower.includes("bouncepad")) return "Emphasize multi-tablet restaurant operations, delivery app stations, locking holders, and modular POS setups.";
  if (lower.includes("garmin") || lower.includes("humminbird") || lower.includes("lowrance")) return "Clarify that iBOLT solves the mounting, vibration, rail, and placement problem around marine electronics.";
  return "Add a fair comparison block that ties iBOLT to exact products, use cases, install method, materials, and compatibility.";
}

function buildLanguagePatterns(mentionRows) {
  const tagMap = new Map();
  const examples = new Map();
  const actions = new Map();
  for (const row of mentionRows) {
    const tags = unique([...splitList(row.positioning_tags), ...detectTags(row.positioning_tags, row.snippet, row.sentiment)]
      .map(normalizeTag)
      .filter(Boolean));
    for (const tag of tags) {
      addCount(tagMap, tag);
      if (!examples.has(tag)) examples.set(tag, []);
      examples.get(tag).push(row.query);
      actions.set(tag, recommendationForTag(tag));
    }
    if (row.unmatched_product_names) {
      addCount(tagMap, "product-name drift");
      if (!examples.has("product-name drift")) examples.set("product-name drift", []);
      examples.get("product-name drift").push(row.query);
      actions.set("product-name drift", "Correct AI-visible product naming with exact catalog names, aliases, product cards, and schema.");
    }
    if (!bool(row.target_domain_cited)) {
      addCount(tagMap, "not cited");
      if (!examples.has("not cited")) examples.set("not cited", []);
      examples.get("not cited").push(row.query);
      actions.set("not cited", "Make the page source-ready with visible proof, FAQPage/Article schema, and clean source blocks.");
    }
  }
  return topCounts(tagMap, 20).map(([tag, count]) => ({
    tag,
    count,
    share: pct(count, mentionRows.length),
    exampleQueries: unique(examples.get(tag) || []).slice(0, 8),
    action: actions.get(tag) || recommendationForTag(tag),
  }));
}

function buildCompetitorOwnership(answerRows, competitorRows, battlecards) {
  const map = new Map();
  for (const row of answerRows) {
    if (!/competitor/i.test(row.outcome || "") && bool(row.brand_mentioned)) continue;
    const tags = detectTags(row.positioning_signals, row.snippet);
    for (const competitor of splitList(row.competitors).map(normalizeBrand)) {
      if (!competitor) continue;
      if (!map.has(competitor)) {
        map.set(competitor, {
          brand: competitor,
          rows: 0,
          replacementRows: 0,
          coMentionRows: 0,
          categories: [],
          providers: [],
          queries: [],
          tags: new Map(),
          pages: [],
          snippets: [],
          counter: counterForBrand(competitor),
        });
      }
      const item = map.get(competitor);
      item.rows += 1;
      if (/competitor/i.test(row.outcome || "")) item.replacementRows += 1;
      if (!/competitor/i.test(row.outcome || "")) item.coMentionRows += 1;
      item.categories.push(row.category);
      item.providers.push(providerName(row.provider));
      item.queries.push(row.query);
      item.pages.push(row.page_url || row.mapped_page);
      item.snippets.push(row.snippet);
      for (const tag of tags) addCount(item.tags, tag);
    }
  }
  for (const row of competitorRows) {
    const brand = normalizeBrand(row.brand);
    if (!brand) continue;
    if (!map.has(brand)) {
      map.set(brand, {
        brand,
        rows: 0,
        replacementRows: 0,
        coMentionRows: 0,
        categories: [],
        providers: [],
        queries: [],
        tags: new Map(),
        pages: [],
        snippets: [],
        counter: counterForBrand(brand),
      });
    }
    const item = map.get(brand);
    item.replacementRows = Math.max(item.replacementRows, toNumber(row.without_ibolt));
    item.coMentionRows = Math.max(item.coMentionRows, toNumber(row.with_ibolt));
    item.rows = Math.max(item.rows, toNumber(row.total_answers || row.appearances));
    item.categories.push(...splitList(row.categories).map((entry) => entry.replace(/\s+\d+$/, "")));
    item.providers.push(...splitList(row.providers).map((entry) => entry.replace(/\s+\d+$/, "")));
    item.queries.push(...splitList(row.lost_queries || row.common_queries).map((entry) => entry.replace(/\s+\d+$/, "")));
    item.counter = row.counter_positioning || item.counter;
  }
  for (const row of battlecards) {
    const brand = normalizeBrand(row.brand);
    if (!brand || !map.has(brand)) continue;
    const item = map.get(brand);
    item.replacementRows = Math.max(item.replacementRows, toNumber(row.without_ibolt));
    item.coMentionRows = Math.max(item.coMentionRows, toNumber(row.with_ibolt));
    item.rows = Math.max(item.rows, toNumber(row.appearances));
    item.categories.push(...splitList(row.categories).map((entry) => entry.replace(/\s+\d+$/, "")));
    item.queries.push(...splitList(row.common_queries).map((entry) => entry.replace(/\s+\d+$/, "")));
    item.counter = row.counter_positioning || item.counter;
  }
  return [...map.values()]
    .map((item) => ({
      brand: item.brand,
      rows: item.rows,
      replacementRows: item.replacementRows,
      coMentionRows: item.coMentionRows,
      categories: unique(item.categories).slice(0, 8),
      providers: unique(item.providers).slice(0, 6),
      queries: unique(item.queries).slice(0, 10),
      languageTags: topCounts(item.tags, 8).map(([tag, count]) => `${tag} ${count}`),
      counter: item.counter || counterForBrand(item.brand),
    }))
    .filter((item) => item.rows || item.replacementRows || item.coMentionRows)
    .sort((a, b) => b.replacementRows - a.replacementRows || b.rows - a.rows || a.brand.localeCompare(b.brand));
}

function buildProviderCategoryRows(answerRows, resultsRows) {
  const map = new Map();
  const sourceRows = answerRows.length ? answerRows : resultsRows;
  for (const row of sourceRows) {
    const provider = providerName(row.provider || row.provider_key);
    const category = row.category || "unknown";
    const key = `${provider}||${category}`;
    if (!map.has(key)) {
      map.set(key, {
        provider,
        category,
        answers: 0,
        mentions: 0,
        replacements: 0,
        citations: 0,
        competitors: [],
        tags: new Map(),
        exampleQueries: [],
      });
    }
    const item = map.get(key);
    item.answers += 1;
    const brandMentioned = bool(row.brand_mentioned) || toNumber(row.coverage_score) > 20 && /ibolt/i.test(row.snippet || row.analysis_notes || "");
    if (brandMentioned || /clean|co-mention/i.test(row.outcome || "")) item.mentions += 1;
    if (/competitor/i.test(row.outcome || "") || (row.brand_mentioned === "false" && row.competitors)) item.replacements += 1;
    if (bool(row.domain_cited) || bool(row.target_domain_cited) || toNumber(row.source_url_count) > 0) item.citations += 1;
    item.competitors.push(...splitList(row.competitors));
    for (const tag of detectTags(row.positioning_signals, row.snippet, row.analysis_notes, row.sentiment)) addCount(item.tags, tag);
    item.exampleQueries.push(row.query);
  }
  return [...map.values()]
    .map((item) => ({
      ...item,
      mentionRate: pct(item.mentions, item.answers),
      replacementRate: pct(item.replacements, item.answers),
      citationRate: pct(item.citations, item.answers),
      competitors: unique(item.competitors.map(normalizeBrand)).slice(0, 8),
      languageTags: topCounts(item.tags, 6).map(([tag, count]) => `${tag} ${count}`),
      exampleQueries: unique(item.exampleQueries).slice(0, 6),
    }))
    .sort((a, b) => b.replacementRate - a.replacementRate || b.answers - a.answers || a.provider.localeCompare(b.provider));
}

function buildExamples(answerRows, mentionRows, replacementSnippets) {
  const rows = [];
  for (const row of mentionRows.slice(0, 24)) {
    rows.push({
      type: row.co_mentioned_competitors ? "iBOLT co-mention" : "iBOLT mention",
      provider: providerName(row.provider),
      category: row.category,
      query: row.query,
      competitors: row.co_mentioned_competitors || "",
      language: splitList(row.positioning_tags).join("; ") || row.sentiment || "",
      action: row.action,
      snippet: row.snippet,
      answerFile: "",
    });
  }
  for (const row of replacementSnippets.slice(0, 24)) {
    rows.push({
      type: "competitor replacement",
      provider: providerName(row.provider),
      category: row.category,
      query: row.query,
      competitors: row.competitors,
      language: row.positioning_signals,
      action: row.recommended_action || row.next_action,
      snippet: row.snippet,
      answerFile: row.answer_file,
    });
  }
  if (!rows.length) {
    for (const row of answerRows.slice(0, 30)) {
      rows.push({
        type: row.outcome || "answer",
        provider: providerName(row.provider),
        category: row.category,
        query: row.query,
        competitors: row.competitors,
        language: row.positioning_signals,
        action: row.recommended_action || row.next_action,
        snippet: row.snippet,
        answerFile: row.answer_file,
      });
    }
  }
  return rows;
}

function barSvg({ title, rows, valueKey = "value", labelKey = "label", color = "#0f766e", width = 920 }) {
  const chartRows = rows.slice(0, 12);
  const rowHeight = 36;
  const height = 78 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => toNumber(row[valueKey])));
  const bars = chartRows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const value = toNumber(row[valueKey]);
    const barWidth = Math.max(3, Math.round((value / max) * (width - 390)));
    return `<g>
      <text x="20" y="${y + 17}" font-size="13" font-weight="900" fill="#111827">${escapeHtml(compact(row[labelKey], 38))}</text>
      <rect x="310" y="${y}" width="${width - 390}" height="22" rx="11" fill="#e5e7eb"/>
      <rect x="310" y="${y}" width="${barWidth}" height="22" rx="11" fill="${color}"/>
      <text x="${width - 58}" y="${y + 17}" font-size="13" font-weight="900" text-anchor="end" fill="#111827">${escapeHtml(value)}</text>
    </g>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="14" fill="#fff"/>
    <text x="20" y="32" font-size="19" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    ${bars}
  </svg>`;
}

function renderTable(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function renderHtml(data) {
  const languageTable = data.iboltLanguageRows.map((row) => [row.tag, row.count, `${row.share}%`, row.exampleQueries.join("; "), row.action]);
  const competitorTable = data.competitorRows.slice(0, 18).map((row) => [
    row.brand,
    row.replacementRows,
    row.coMentionRows,
    row.categories.join("; "),
    row.languageTags.join("; "),
    row.counter,
  ]);
  const providerTable = data.providerCategoryRows.slice(0, 24).map((row) => [
    row.provider,
    row.category,
    row.answers,
    `${row.mentionRate}%`,
    `${row.replacementRate}%`,
    row.competitors.join("; "),
    row.languageTags.join("; "),
  ]);
  const examplesTable = data.exampleRows.slice(0, 36).map((row) => [
    row.type,
    row.provider,
    row.category,
    row.query,
    row.competitors,
    row.language,
    row.action,
    compact(row.snippet, 260),
  ]);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Mention Narrative Drilldown</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1240px;margin:0 auto;padding:34px 24px 70px}
    h1{font-size:36px;margin:0 0 8px}
    h2{font-size:24px;margin:34px 0 12px}
    p,li{font-size:15px;line-height:1.55;color:#334155}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:18px 0}
    .cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:20px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:16px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}
    .value{font-size:28px;font-weight:900;margin:8px 0;color:#0f172a}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    svg{width:100%;height:auto;border:1px solid #dbe3ef;border-radius:14px}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    code{background:#e2e8f0;border-radius:5px;padding:2px 5px}
    @media(max-width:900px){.cards,.grid{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Mention Narrative Drilldown</h1>
  <p>Consolidates saved answer evidence into the plain-language question: how AI talks about iBOLT, who it mentions next to iBOLT, and what language competitors currently own.</p>

  <div class="note">
    <strong>Read:</strong> iBOLT gets useful specialist and durability language when it appears, but the same answer set often gives competitors the default recommendation slot. Citation work should follow mention and recommendation recovery because most losses are still replacement losses, not citation-only losses.
  </div>

  <section class="cards">
    <div class="card"><div class="label">Answers tested</div><div class="value">${data.summary.totalAnswers}</div><p>Saved provider answers in the baseline run.</p></div>
    <div class="card"><div class="label">iBOLT mentions</div><div class="value">${data.summary.mentions}</div><p>${data.summary.mentionRate}% of tested answers mention iBOLT.</p></div>
    <div class="card"><div class="label">Co-mentions</div><div class="value">${data.summary.coMentions}</div><p>Answers where iBOLT appears beside named competitors.</p></div>
    <div class="card"><div class="label">Replacements</div><div class="value">${data.summary.replacements}</div><p>Competitor answers without enough iBOLT inclusion.</p></div>
    <div class="card"><div class="label">Citations</div><div class="value">${data.summary.citations}</div><p>Answers citing iboltmounts.com or source URLs.</p></div>
  </section>

  <section class="grid">
    ${barSvg({ title: "iBOLT Mention Language", rows: data.iboltLanguageRows.map((row) => ({ label: row.tag, value: row.count })), color: "#0f766e" })}
    ${barSvg({ title: "Competitor Replacement Pressure", rows: data.competitorRows.map((row) => ({ label: row.brand, value: row.replacementRows })), color: "#b91c1c" })}
  </section>

  <h2>How AI Describes iBOLT</h2>
  ${renderTable(["Language pattern", "Rows", "Share", "Example queries", "Copy action"], languageTable)}

  <h2>Who iBOLT Is Mentioned Next To And Replaced By</h2>
  ${renderTable(["Competitor", "Replacement rows", "Co-mention rows", "Categories", "Language they own", "Counter-positioning"], competitorTable)}

  <h2>Provider And Category Narrative Risk</h2>
  ${renderTable(["Provider", "Category", "Answers", "Mention rate", "Replacement rate", "Competitors", "Language tags"], providerTable)}

  <h2>Evidence Examples</h2>
  ${renderTable(["Type", "Provider", "Category", "Query", "Competitors", "Language", "Action", "Snippet"], examplesTable)}
</main>
</body>
</html>`;
}

function renderMarkdown(data) {
  return `# iBOLT Mention Narrative Drilldown

## Summary

- Answers tested: ${data.summary.totalAnswers}
- iBOLT mentions: ${data.summary.mentions} (${data.summary.mentionRate}%)
- Co-mentions: ${data.summary.coMentions}
- Competitor replacements: ${data.summary.replacements}
- Citations: ${data.summary.citations}

## How AI Describes iBOLT

${data.iboltLanguageRows.map((row) => `- ${row.tag}: ${row.count} rows. Action: ${row.action}`).join("\n")}

## Competitors To Counter

${data.competitorRows.slice(0, 12).map((row) => `- ${row.brand}: ${row.replacementRows} replacement rows, ${row.coMentionRows} co-mention rows. Counter: ${row.counter}`).join("\n")}

## Read

iBOLT gets useful specialist and durability language when it appears, but competitors still own too many default recommendation slots. The next content work should recover mentions and top-three placements before treating citation rate as the main bottleneck.
`;
}

async function main() {
  const resultsRows = await readCsv("results.csv");
  const answerRows = await readCsv("answer-evidence-viewer/answer-evidence-ledger.csv");
  const mentionRows = await readCsv("mention-quality-audit/mention-quality-rows.csv");
  const iboltExamples = await readCsv("answer-language-evidence/ibolt-mention-examples.csv");
  const competitorNetwork = await readCsv("co-mention-network/competitor-network.csv");
  const competitorBattlecards = await readCsv("answer-language-evidence/competitor-language-battlecards.csv");
  const replacementSnippets = await readCsv("answer-snippet-evidence-appendix/competitor-replacement-snippets.csv");

  const totalAnswers = resultsRows.length || answerRows.length;
  const mentions = resultsRows.filter((row) => bool(row.brand_mentioned)).length || mentionRows.length;
  const citations = resultsRows.filter((row) => bool(row.domain_cited)).length
    || answerRows.filter((row) => bool(row.target_domain_cited) || toNumber(row.source_url_count) > 0).length;
  const replacements = answerRows.filter((row) => /competitor/i.test(row.outcome || "")).length
    || resultsRows.filter((row) => row.brand_mentioned === "false" && row.competitors).length;
  const coMentions = mentionRows.filter((row) => splitList(row.co_mentioned_competitors).length).length
    || iboltExamples.filter((row) => splitList(row.co_mentioned).length).length;

  const allMentionRows = mentionRows.length ? mentionRows : iboltExamples.map((row) => ({
    ...row,
    positioning_tags: row.language,
    co_mentioned_competitors: row.co_mentioned,
    target_domain_cited: "false",
    unmatched_product_names: "",
    snippet: row.evidence,
  }));

  const iboltLanguageRows = buildLanguagePatterns(allMentionRows);
  const competitorRows = buildCompetitorOwnership(answerRows, competitorNetwork, competitorBattlecards);
  const providerCategoryRows = buildProviderCategoryRows(answerRows, resultsRows);
  const exampleRows = buildExamples(answerRows, allMentionRows, replacementSnippets);

  const summary = {
    totalAnswers,
    mentions,
    mentionRate: pct(mentions, totalAnswers),
    coMentions,
    replacements,
    citations,
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({ summary, iboltLanguageRows, competitorRows, providerCategoryRows, exampleRows }));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({ summary, iboltLanguageRows, competitorRows, providerCategoryRows, exampleRows }));
  await writeFile(path.join(outDir, "mention-narrative-summary.csv"), csv([
    ["metric", "value", "note"],
    ["answers_tested", summary.totalAnswers, "Saved provider answers in the baseline run."],
    ["ibolt_mentions", summary.mentions, `${summary.mentionRate}% of tested answers mention iBOLT.`],
    ["co_mentions", summary.coMentions, "Answers where iBOLT appears beside a competitor."],
    ["competitor_replacements", summary.replacements, "Answers where competitors occupy the recommendation space."],
    ["citations", summary.citations, "Answers citing the target domain or source URLs."],
  ]));
  await writeFile(path.join(outDir, "ibolt-language-patterns.csv"), csv([
    ["language_pattern", "rows", "share_pct", "example_queries", "copy_action"],
    ...iboltLanguageRows.map((row) => [row.tag, row.count, row.share, row.exampleQueries.join("; "), row.action]),
  ]));
  await writeFile(path.join(outDir, "competitor-language-ownership.csv"), csv([
    ["brand", "replacement_rows", "co_mention_rows", "categories", "providers", "language_tags", "example_queries", "counter_positioning"],
    ...competitorRows.map((row) => [
      row.brand,
      row.replacementRows,
      row.coMentionRows,
      row.categories.join("; "),
      row.providers.join("; "),
      row.languageTags.join("; "),
      row.queries.join("; "),
      row.counter,
    ]),
  ]));
  await writeFile(path.join(outDir, "provider-category-narrative.csv"), csv([
    ["provider", "category", "answers", "mention_rate", "replacement_rate", "citation_rate", "competitors", "language_tags", "example_queries"],
    ...providerCategoryRows.map((row) => [
      row.provider,
      row.category,
      row.answers,
      row.mentionRate,
      row.replacementRate,
      row.citationRate,
      row.competitors.join("; "),
      row.languageTags.join("; "),
      row.exampleQueries.join("; "),
    ]),
  ]));
  await writeFile(path.join(outDir, "narrative-example-ledger.csv"), csv([
    ["type", "provider", "category", "query", "competitors", "language", "action", "snippet", "answer_file"],
    ...exampleRows.map((row) => [
      row.type,
      row.provider,
      row.category,
      row.query,
      row.competitors,
      row.language,
      row.action,
      compact(row.snippet, 500),
      row.answerFile,
    ]),
  ]));

  console.log(`Wrote ${outDir}`);
  console.log(`Answers: ${summary.totalAnswers}`);
  console.log(`Mentions: ${summary.mentions}`);
  console.log(`Competitor replacements: ${summary.replacements}`);
  console.log(`Competitors classified: ${competitorRows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
