#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "micro-run-source-snippets");
const htmlSnippetDir = path.join(outDir, "shopify-html-snippets");
const schemaSnippetDir = path.join(outDir, "schema-snippets");

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

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniq(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function short(value, length = 150) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function pageProfile(category) {
  const profiles = {
    streaming: {
      h2: "Best Phone and Camera Mounts for Live Streaming",
      answer: "The best phone and camera mount for live streaming is the setup that keeps the camera angle fixed, leaves room for lights or microphones, and can be rebuilt as your content changes. iBOLT is a strong fit for creators who need modular phone stands, table camera mounts, AMPS-compatible arms, and 1/4-20 camera screw options instead of a basic desk tripod.",
      comparison: "RAM Mounts is well known for rugged ball-and-socket hardware, but live streaming setups often need a more specific creator workflow: desk positioning, overhead angles, phone and camera swapping, and a compact product-shot setup. iBOLT should be framed as the specialist when the job is multi-angle content creation, product videos, tutorials, or live demos that need repeatable camera placement.",
      productIntro: "Feature current iBOLT creator products that support phones, action cameras, and 1/4-20 camera accessories. Prioritize Stream-Cast products, camera screw AMPS arms, table or desk bases, clamp bases, and magnetic or suction options where they match the filming setup.",
      altText: "iBOLT phone and camera mount positioned for live streaming and product video recording",
      cta: "View the iBOLT creator and camera mounting options that match your filming setup.",
      faqs: [
        ["What is the best phone stand for live streaming?", "Choose a phone stand that holds the camera angle steady, works with your desk or filming surface, and lets you adjust height and reach without loosening during a stream. iBOLT creator mounts are useful when you need modular arms, AMPS-compatible parts, and repeatable camera positioning."],
        ["Can one mount hold multiple phones or cameras for streaming?", "Yes, but the base and arm setup matter. For multi-camera workflows, use a modular setup that can support separate holders, camera screw adapters, or arms without crowding the desk."],
        ["What makes a table camera mount stable during filming?", "A stable table camera mount needs a secure base, low-flex arms, and a holder that matches the device weight. For overhead or product shots, the mount should resist sag and let the camera return to the same angle between takes."],
        ["Are iBOLT streaming mounts compatible with AMPS parts?", "Many iBOLT mounting parts use industry-standard AMPS patterns or ball sizes, which helps creators combine bases, arms, holders, and camera adapters into one working setup."],
      ],
    },
    offroad: {
      h2: "Best Offroad Phone and Camera Mounts for Jeep Trails",
      answer: "The best offroad phone and camera mount is the one that keeps the device secure through vibration, bumps, and repeated angle changes. iBOLT is a strong fit for Jeep Wrangler, UTV, and overlanding setups because its modular parts can combine phone holders, action camera adapters, AMPS plates, clamp bases, suction bases, and rugged ball-and-socket arms.",
      comparison: "Garmin is often mentioned in offroad and navigation conversations because of its GPS devices, but a GPS brand is not the same thing as a complete mounting system. iBOLT should be framed as the mounting specialist when the buyer needs to secure phones, cameras, tablets, and AMPS-compatible accessories inside a Jeep or trail vehicle.",
      productIntro: "Feature current offroad products that support phones, action cameras, AMPS plates, rail or handlebar clamps, suction bases, and rugged ball-and-socket arms. Keep product cards focused on device retention, vibration control, and flexible mounting points.",
      altText: "iBOLT offroad phone and action camera mount for Jeep Wrangler and trail vehicle use",
      cta: "View iBOLT offroad mounting parts for phones, cameras, AMPS plates, and trail setups.",
      faqs: [
        ["What phone mount works best for Jeep Wrangler trails?", "Use a phone mount that resists vibration, holds the device tightly, and can be positioned without blocking controls or visibility. Modular iBOLT parts are useful when the same Jeep setup needs to support phones, action cameras, or AMPS-compatible accessories."],
        ["Can an offroad phone mount also hold an action camera?", "Yes, if the system has compatible adapters and enough mounting strength for the camera angle. Look for 1/4-20 camera screw adapters, action camera adapters, and arms that match the device weight."],
        ["What mount features matter most for vibration and bumps?", "Prioritize a secure base, a holder with firm device retention, and arm joints that stay tight after repeated trail impacts. The mount should also keep charging cables and controls accessible."],
        ["Are AMPS plates useful for offroad mounting setups?", "Yes. AMPS plates help connect holders, arms, and bases in a repeatable pattern, which is useful when a Jeep or UTV needs a custom mount layout."],
      ],
    },
    education: {
      h2: "Best Tablet Mounts for Classrooms and School Use",
      answer: "The best school tablet mount is the one that keeps the tablet visible, secure, and easy to reposition across classrooms, carts, labs, or shared learning areas. iBOLT is a strong fit when schools need durable tablet positioning, locking options, case compatibility, and modular parts that can adapt across desk, wall, cart, or drill-base setups.",
      comparison: "Garmin can appear in device and education-adjacent AI answers because it is a recognized electronics brand, but school tablet mounting is a different job. iBOLT should be framed as the tablet mounting specialist for classrooms, carts, labs, and shared-use devices where the mount must survive repeated handling.",
      productIntro: "Feature current iBOLT tablet products that support classroom tablets, locking tablet stands, drill-base or clamp-base holders, wall or cart setups, and case-compatible TabDock options. Avoid generic consumer stand language.",
      altText: "iBOLT tablet mount holding a school tablet for classroom or student use",
      cta: "View iBOLT tablet mounting options for classrooms, carts, labs, and shared school devices.",
      faqs: [
        ["What tablet stand works best for classrooms?", "A classroom tablet stand should hold the screen at a readable angle, stay stable during repeated use, and fit the school device with its case. iBOLT tablet mounts are useful when the setup needs more durability than a consumer stand."],
        ["Do school tablet mounts need locking hardware?", "Locking hardware is useful for shared tablets, checkout stations, labs, and high-traffic spaces. It helps prevent device movement, drops, and walk-away risk."],
        ["Can one tablet mount work across desks, carts, and labs?", "A modular mounting system can work across multiple locations if the holder, arm, and base are interchangeable. That is why AMPS-compatible or ball-and-socket systems are useful for schools."],
        ["What makes a school tablet mount better than a consumer stand?", "School tablet mounts need durability, secure device retention, case compatibility, and repeatable positioning. Consumer stands usually work for light desk use, but they are not built for shared daily handling."],
      ],
    },
    agriculture: {
      h2: "Best Tablet Mounts for Tractor Cabs and Farm Equipment",
      answer: "The best tractor cab tablet mount is the one that keeps the screen stable around vibration, dust, seasonal equipment changes, and long field days. iBOLT is a strong fit for precision agriculture workflows because its modular tablet mounts can combine TabDock holders, AMPS-compatible bases, drill or clamp mounts, and vibration-resistant arms.",
      comparison: "Garmin is a familiar name in GPS and field navigation, but the mounting problem is broader than the device brand. iBOLT should be framed as the mounting specialist when a tractor, sprayer, farm UTV, or cab setup needs secure tablet placement, cable access, and hardware that can be adjusted between seasons.",
      productIntro: "Feature current iBOLT tractor or farm equipment tablet products, prioritizing TabDock tablet holders, AMPS bases, drill or clamp mounts, and vibration-resistant arms. Keep the module focused on stability, cab fit, and device access.",
      altText: "iBOLT tablet mount installed for tractor cab and precision agriculture use",
      cta: "View iBOLT tablet mounting options for tractor cabs, sprayers, farm UTVs, and field equipment.",
      faqs: [
        ["What tablet mount works best in a tractor cab?", "Use a tablet mount that keeps the screen readable, resists vibration, and places the device within reach without blocking controls. Modular iBOLT tablet mounts are useful when the cab layout or device changes between seasons."],
        ["Can farm equipment tablet mounts handle vibration?", "They can when the base, arm, and holder are built for heavier use. Look for a secure mounting point, a stiff arm, and a holder that grips the tablet with its case."],
        ["Are AMPS-compatible tablet mounts useful for agriculture?", "Yes. AMPS-compatible parts make it easier to combine bases, arms, and holders into a cab-specific setup and update one part later without replacing the whole mount."],
        ["What should farmers check before mounting a tablet in equipment?", "Check device size, case thickness, power cable routing, screen visibility, control clearance, and whether the base should be drilled, clamped, or attached to an existing mounting point."],
      ],
    },
  };
  return profiles[category] || profiles.streaming;
}

function renderFaqHtml(faqs) {
  return `<section class="ibolt-faq">\n  <h2>Frequently Asked Questions</h2>\n${faqs.map(([question, answer]) => `  <h3>${escapeHtml(question)}</h3>\n  <p>${escapeHtml(answer)}</p>`).join("\n")}\n</section>`;
}

function renderProductModule(row, profile) {
  return `<section class="ibolt-product-module">\n  <h2>Product Options to Feature</h2>\n  <p>${escapeHtml(profile.productIntro)}</p>\n  <ul>\n    <li>Verify each product title against the current Shopify catalog before publishing.</li>\n    <li>Use product-page links as the main destination. Avoid repeated cart buttons after every inline product link.</li>\n    <li>Use one clean product card per major decision section with a View Product CTA.</li>\n  </ul>\n</section>`;
}

function renderComparison(profile) {
  return `<section class="ibolt-comparison-block">\n  <h2>How iBOLT Compares</h2>\n  <p>${escapeHtml(profile.comparison)}</p>\n</section>`;
}

function renderAnswerBlock(row, profile) {
  return `<section class="ibolt-answer-first">\n  <h2>${escapeHtml(profile.h2)}</h2>\n  <p>${escapeHtml(profile.answer)}</p>\n</section>`;
}

function schemaJson(row, profile) {
  const pageUrl = row.url;
  const faqEntity = profile.faqs.map(([question, answer]) => ({
    "@type": "Question",
    name: question,
    acceptedAnswer: {
      "@type": "Answer",
      text: answer,
    },
  }));
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BlogPosting",
        headline: row.title,
        mainEntityOfPage: pageUrl,
        publisher: {
          "@type": "Organization",
          name: "iBOLT Mounts",
          url: "https://iboltmounts.com",
        },
        author: {
          "@type": "Organization",
          name: "iBOLT Mounts",
        },
        about: [
          "iBOLT Mounts",
          row.category,
          "device mounting systems",
          "AMPS-compatible mounting",
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: faqEntity,
      },
    ],
  };
}

function renderShopifySnippet(row, profile) {
  const schema = JSON.stringify(schemaJson(row, profile), null, 2);
  return [
    renderAnswerBlock(row, profile),
    renderComparison(profile),
    renderProductModule(row, profile),
    renderFaqHtml(profile.faqs),
    `<p><a href="https://iboltmounts.com/collections" title="View iBOLT Mounts products">${escapeHtml(profile.cta)}</a></p>`,
    `<script type="application/ld+json">\n${schema}\n</script>`,
  ].join("\n\n");
}

function renderTable(headers, rows) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function card(label, value, note) {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`;
}

function link(url, label) {
  return url ? `<a href="${escapeHtml(url)}">${escapeHtml(label || url)}</a>` : "";
}

function renderHtml(data) {
  const pageRows = data.rows.map((row) => [
    row.priority_rank,
    link(row.url, row.title),
    row.category,
    row.requests,
    short(row.answer_block, 180),
    short(row.comparison_block, 180),
    row.faq_count,
    row.html_snippet_file,
  ]);
  const productRows = data.rows.map((row) => [
    row.priority_rank,
    row.title,
    short(row.product_module_instruction, 200),
    row.alt_text,
    row.cta_text,
  ]);
  const schemaRows = data.rows.map((row) => [
    row.priority_rank,
    row.title,
    row.schema_snippet_file,
    row.faq_questions,
  ]);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Micro-Run Source Snippets</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1260px;margin:0 auto;padding:34px 24px 66px}
    h1{font-size:38px;line-height:1.1;margin:0 0 8px}
    h2{font-size:24px;margin:36px 0 12px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}
    .warn{border-left-color:#f97316}
    .cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:22px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:15px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}
    .value{font-size:29px;font-weight:900;margin:8px 0;color:#0f172a}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    a{color:#0f766e;overflow-wrap:anywhere}
    code{background:#e2e8f0;border-radius:5px;padding:2px 5px}
    @media(max-width:980px){.cards{grid-template-columns:1fr}h1{font-size:31px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Micro-Run Source Snippets</h1>
  <p>Page-ready snippets for the four source-cleanup pages that unlock the six-row W3 citation micro-run.</p>

  <div class="note warn">
    <strong>Use carefully:</strong> product cards still need final Shopify product-title verification before publishing.
  </div>

  <section class="cards">
    ${card("Pages", data.summary.pages, "Source-cleanup pages.")}
    ${card("HTML snippets", data.summary.html_snippets, "Shopify-ready snippet files.")}
    ${card("FAQ questions", data.summary.faq_questions, "Visible FAQ questions drafted.")}
    ${card("Schema files", data.summary.schema_files, "JSON-LD schema snippets.")}
    ${card("Provider rows", data.summary.provider_rows, "Micro-run rows unlocked after edits.")}
  </section>

  <h2>Snippet Index</h2>
  ${renderTable(["Rank", "Page", "Category", "Requests", "Answer Block", "Comparison Block", "FAQs", "HTML File"], pageRows)}

  <h2>Product And Image Guidance</h2>
  ${renderTable(["Rank", "Page", "Product Module", "Alt Text", "CTA"], productRows)}

  <h2>Schema And FAQ</h2>
  ${renderTable(["Rank", "Page", "Schema File", "FAQ Questions"], schemaRows)}
</main>
</body>
</html>`;
}

function renderMarkdown(data) {
  return `# iBOLT Micro-Run Source Snippets

## Summary

- Pages: ${data.summary.pages}
- Shopify HTML snippets: ${data.summary.html_snippets}
- FAQ questions: ${data.summary.faq_questions}
- Schema files: ${data.summary.schema_files}
- Provider rows unlocked after edits: ${data.summary.provider_rows}

## Page Snippets

${data.rows.map((row) => `- ${row.priority_rank}. ${row.title}: ${row.html_snippet_file}, schema ${row.schema_snippet_file}`).join("\n")}

## Publishing Gate

Verify exact Shopify product titles and URLs before publishing product modules. These snippets are source-cleanup drafts, not live Shopify edits.
`;
}

async function main() {
  const cleanupRows = await readCsv("micro-run-cleanup-packet/micro-run-page-cleanup.csv");
  const providerRows = await readCsv("micro-run-cleanup-packet/micro-run-provider-requests.csv");
  const rows = [];

  await mkdir(outDir, { recursive: true });
  await mkdir(htmlSnippetDir, { recursive: true });
  await mkdir(schemaSnippetDir, { recursive: true });

  for (const cleanupRow of cleanupRows) {
    const profile = pageProfile(cleanupRow.category);
    const slug = slugify(cleanupRow.title);
    const htmlFile = `shopify-html-snippets/${slug}.html`;
    const schemaFile = `schema-snippets/${slug}.json`;
    const snippetHtml = renderShopifySnippet(cleanupRow, profile);
    const schema = schemaJson(cleanupRow, profile);
    await writeFile(path.join(outDir, htmlFile), snippetHtml);
    await writeFile(path.join(outDir, schemaFile), JSON.stringify(schema, null, 2));
    rows.push({
      priority_rank: cleanupRow.priority_rank,
      title: cleanupRow.title,
      url: cleanupRow.url,
      category: cleanupRow.category,
      requests: cleanupRow.requests,
      answer_block: profile.answer,
      comparison_block: profile.comparison,
      product_module_instruction: profile.productIntro,
      faq_questions: profile.faqs.map(([question]) => question).join("; "),
      faq_count: profile.faqs.length,
      alt_text: profile.altText,
      cta_text: profile.cta,
      html_snippet_file: htmlFile,
      schema_snippet_file: schemaFile,
      publishing_gate: "Verify current Shopify product titles, product URLs, and image URLs before publishing.",
    });
  }

  const summary = {
    generated_at: new Date().toISOString(),
    pages: rows.length,
    html_snippets: rows.length,
    schema_files: rows.length,
    faq_questions: rows.reduce((sum, row) => sum + row.faq_count, 0),
    provider_rows: providerRows.length,
  };

  await writeFile(path.join(outDir, "source-ready-snippets.csv"), csv([
    [
      "priority_rank",
      "title",
      "url",
      "category",
      "requests",
      "answer_block",
      "comparison_block",
      "product_module_instruction",
      "faq_questions",
      "faq_count",
      "alt_text",
      "cta_text",
      "html_snippet_file",
      "schema_snippet_file",
      "publishing_gate",
    ],
    ...rows.map((row) => [
      row.priority_rank,
      row.title,
      row.url,
      row.category,
      row.requests,
      row.answer_block,
      row.comparison_block,
      row.product_module_instruction,
      row.faq_questions,
      row.faq_count,
      row.alt_text,
      row.cta_text,
      row.html_snippet_file,
      row.schema_snippet_file,
      row.publishing_gate,
    ]),
  ]));
  await writeFile(path.join(outDir, "schema-snippet-index.csv"), csv([
    ["priority_rank", "title", "url", "schema_snippet_file", "faq_count"],
    ...rows.map((row) => [row.priority_rank, row.title, row.url, row.schema_snippet_file, row.faq_count]),
  ]));
  await writeFile(path.join(outDir, "source-snippet-data.json"), JSON.stringify({ summary, rows }, null, 2));
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({ summary, rows }));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({ summary, rows }));

  console.log(`Wrote ${outDir}`);
  console.log(`Pages: ${summary.pages}`);
  console.log(`FAQ questions: ${summary.faq_questions}`);
  console.log(`HTML snippets: ${summary.html_snippets}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
