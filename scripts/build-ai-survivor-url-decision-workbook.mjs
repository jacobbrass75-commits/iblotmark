#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const benchmarkDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("content-output/openrouter-ai-benchmark-2026-06-17-17-11-06");
const outDir = path.join(benchmarkDir, "survivor-url-decision-workbook");

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

function normalizeUrl(value) {
  return String(value ?? "")
    .trim()
    .replace(/^http:\/\//i, "https://")
    .replace(/\/+$/g, "")
    .toLowerCase();
}

function toNumber(value) {
  if (typeof value === "number") return value;
  const match = String(value ?? "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function short(value, length = 130) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
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

function joinList(values, limit = 18) {
  const unique = uniq(values);
  const shown = unique.slice(0, limit);
  const suffix = unique.length > shown.length ? `; +${unique.length - shown.length} more` : "";
  return `${shown.join("; ")}${suffix}`;
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row) || "unknown";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function countList(values) {
  const counts = new Map();
  for (const value of values.map((item) => String(item ?? "").trim()).filter(Boolean)) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function countSummary(values, limit = 8) {
  return countList(values)
    .slice(0, limit)
    .map(([value, count]) => `${value} ${count}`)
    .join("; ");
}

function retestKey(row) {
  return [
    row.provider,
    row.wave,
    row.prompt,
    normalizeUrl(row.page_url),
  ].join("|");
}

function makeUrlSet(rows) {
  const urls = [];
  for (const row of rows) {
    urls.push(row.recommended_survivor_url, row.benchmark_pressure_url);
    urls.push(...splitList(row.merge_from_urls));
  }
  return new Set(urls.map(normalizeUrl).filter(Boolean));
}

function decisionLane(rows) {
  const types = countList(rows.map((row) => row.consolidation_type));
  const [topType] = types[0] || ["canonical family review"];
  if (/safe duplicate/i.test(topType)) return "safe duplicate review";
  return topType || "canonical family review";
}

function reviewStatus(rows, requestCount) {
  const flags = joinList(rows.flatMap((row) => splitList(row.survivor_review_flag)), 5);
  if (/do not auto-redirect|manual review|topic family not exact duplicate|benchmark pressure is on another URL/i.test(flags)) {
    return "human survivor decision required";
  }
  if (requestCount > 0) return "merge-ready after content preservation";
  return "low-risk consolidation review";
}

function redirectAdvice(rows) {
  const raw = joinList(rows.map((row) => row.redirect_action), 6);
  if (/Do not auto-redirect/i.test(raw)) {
    return "Do not redirect yet. Confirm survivor URL, merge unique answer blocks, products, FAQs, and benchmark prompts first.";
  }
  return raw || "Hold redirects until the survivor page has the preserved answer blocks, product modules, internal links, and schema.";
}

function firstMove(rows, actionRows) {
  const actionMove = actionRows.map((row) => row.first_move).find(Boolean);
  if (actionMove) return actionMove;
  const prompts = joinList(rows.flatMap((row) => splitList(row.prompts_to_preserve)), 4);
  return `Confirm survivor URL, preserve prompts: ${prompts || "mapped benchmark prompts"}, then merge products, comparison language, FAQ/schema, and internal links.`;
}

function releaseGate(requestCount) {
  if (requestCount > 0) {
    return "Retest only after survivor URL is live with quick answer, comparison block, product module, FAQ/schema, and canonical/internal-link cleanup.";
  }
  return "Do not retest until the survivor edit is published and source-readiness checks pass.";
}

function successMetric(rows, requestRows) {
  const expected = requestRows.map((row) => row.expected_metric).find(Boolean);
  if (expected) return expected;
  const competitorOnly = rows.reduce((sum, row) => sum + toNumber(row.competitor_only_answers), 0);
  const zeroMentions = rows.reduce((sum, row) => sum + toNumber(row.zero_mention_queries), 0);
  if (competitorOnly || zeroMentions) {
    return "Competitor-only answers become iBOLT-included, non-branded mentions improve, and iBOLT moves into top-3 recommendations.";
  }
  return "Survivor page remains stable and becomes citation-ready.";
}

function barSvg({ title, rows, width = 960, rowHeight = 34, color = "#0f766e" }) {
  const chartRows = rows.slice(0, 14);
  const height = 78 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => row.value));
  const body = chartRows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const barWidth = Math.round((row.value / max) * (width - 390));
    return `<g>
      <text x="22" y="${y + 17}" font-size="13" font-weight="800" fill="#111827">${escapeHtml(short(row.label, 44))}</text>
      <rect x="338" y="${y}" width="${width - 390}" height="21" rx="10" fill="#e5e7eb"/>
      <rect x="338" y="${y}" width="${barWidth}" height="21" rx="10" fill="${row.color || color}"/>
      <text x="${width - 24}" y="${y + 16}" font-size="13" font-weight="900" text-anchor="end" fill="#111827">${escapeHtml(row.value)}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#ffffff"/>
    <text x="22" y="34" font-size="20" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    ${body}
  </svg>`;
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
  const decisionRows = data.topDecisions.map((row) => [
    row.rank,
    row.priority_score,
    row.review_status,
    row.category,
    link(row.survivor_url, row.survivor_title),
    short(row.merge_from_titles, 120),
    row.priority_retest_requests,
    short(row.prompts_to_preserve, 170),
    short(row.competitors_to_cover, 100),
    short(row.release_gate, 150),
  ]);
  const redirectRows = data.redirectHoldRows.slice(0, 30).map((row) => [
    row.rank,
    row.hold_action,
    link(row.merge_from_url, row.merge_from_title),
    link(row.survivor_url, row.survivor_title),
    row.reason,
  ]);
  const coverageRows = data.retestCoverageRows.slice(0, 24).map((row) => [
    row.rank,
    link(row.survivor_url, row.survivor_title),
    row.priority_retest_requests,
    row.providers,
    row.waves,
    short(row.prompts, 180),
    row.gate,
  ]);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Survivor URL Decision Workbook</title>
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
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
    .chart{background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:10px;overflow:auto}
    .chart svg{width:100%;height:auto;display:block}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 22px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    a{color:#0f766e;overflow-wrap:anywhere}
    code{background:#e2e8f0;border-radius:5px;padding:2px 5px}
    @media(max-width:980px){.cards,.grid{grid-template-columns:1fr}h1{font-size:31px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Survivor URL Decision Workbook</h1>
  <p>This workbook turns duplicate/canonical evidence into reviewable survivor URL decisions before the next AI visibility retest.</p>

  <div class="note warn">
    <strong>Why this matters:</strong> ${escapeHtml(data.summary.blocked_requests)} priority provider requests are currently tied to pages that require consolidation or survivor decisions. Retesting before these survivor pages are merged would measure the wrong URLs.
  </div>

  <section class="cards">
    ${card("Survivor clusters", data.summary.survivor_clusters, "Recommended survivor URL groups.")}
    ${card("Canonical rows", data.summary.canonical_rows, "Rows from the canonical consolidation queue.")}
    ${card("Manual review", data.summary.manual_review_clusters, "Clusters needing human URL decision.")}
    ${card("Priority retests", data.summary.priority_retest_requests, "Provider requests mapped to survivor clusters.")}
    ${card("Blocked requests", data.summary.blocked_requests, "Requests that should wait for survivor merge.")}
  </section>

  <section class="grid">
    <div class="chart"><img alt="Survivor decision priority" src="survivor-decision-priority.svg"/></div>
    <div class="chart"><img alt="Retest requests by survivor" src="retest-requests-by-survivor.svg"/></div>
  </section>

  <h2>Decision Workbook</h2>
  ${renderTable(["Rank", "Priority", "Review", "Category", "Survivor URL", "Merge From", "Retests", "Prompts To Preserve", "Competitors", "Release Gate"], decisionRows)}

  <h2>Retest Coverage By Survivor</h2>
  ${renderTable(["Rank", "Survivor URL", "Requests", "Providers", "Waves", "Prompts", "Gate"], coverageRows)}

  <h2>Redirect Hold List</h2>
  <p>These pages should not be redirected, unpublished, or rewritten until useful sections are preserved on the survivor page.</p>
  ${renderTable(["Rank", "Hold Action", "Merge From", "Survivor", "Reason"], redirectRows)}
</main>
</body>
</html>`;
}

function renderMarkdown(data) {
  return `# iBOLT Survivor URL Decision Workbook

## Summary

- Survivor clusters: ${data.summary.survivor_clusters}
- Canonical rows: ${data.summary.canonical_rows}
- Manual-review clusters: ${data.summary.manual_review_clusters}
- Priority retest requests mapped to survivor clusters: ${data.summary.priority_retest_requests}
- Blocked priority requests until survivor merge: ${data.summary.blocked_requests}

## Top Survivor Decisions

${data.topDecisions.map((row) => `- ${row.rank}. ${row.survivor_title}: priority ${row.priority_score}, ${row.priority_retest_requests} retests, ${row.review_status}. Preserve: ${short(row.prompts_to_preserve, 180)}`).join("\n")}

## Redirect Rule

Do not redirect or unpublish duplicate/supporting pages until the survivor URL has the useful answer blocks, products, comparison language, FAQs, schema, and exact benchmark prompts.

## Generated Files

- survivor-decision-workbook.csv
- first-20-survivor-decisions.csv
- survivor-cluster-retest-coverage.csv
- redirect-hold-list.csv
- survivor-url-decision-data.json
- survivor-decision-priority.svg
- retest-requests-by-survivor.svg
`;
}

async function main() {
  const canonicalRows = await readCsv("canonical-consolidation-plan/canonical-consolidation-queue.csv");
  const ticketRows = await readCsv("survivor-edit-tickets/survivor-edit-ticket-index.csv");
  const pageDecisionRows = await readCsv("page-decision-map/page-decision-map.csv");
  const pageRetestRows = await readCsv("page-decision-retest-map/page-decision-retest-map.csv");
  const pageRetestSummaryRows = await readCsv("page-decision-retest-map/page-level-retest-summary.csv");
  const actionRows = await readCsv("all-blog-action-control-sheet/all-blog-action-control-sheet.csv");

  const pageDecisionByUrl = new Map(pageDecisionRows.map((row) => [normalizeUrl(row.url), row]));
  const actionByUrl = new Map(actionRows.map((row) => [normalizeUrl(row.url), row]));
  const ticketByUrl = new Map(ticketRows.map((row) => [normalizeUrl(row.page_url), row]));
  const pageRetestSummaryByUrl = new Map(pageRetestSummaryRows.map((row) => [normalizeUrl(row.url), row]));
  const canonicalGroups = groupBy(canonicalRows, (row) => normalizeUrl(row.recommended_survivor_url));
  const canonicalUrlSet = new Set();
  const assignedRetestKeys = new Set();

  const workbookRows = [];
  for (const [survivorUrlKey, rows] of canonicalGroups.entries()) {
    const urlSet = makeUrlSet(rows);
    for (const url of urlSet) canonicalUrlSet.add(url);
    const retestRows = pageRetestRows.filter((row) => {
      const key = retestKey(row);
      if (row.decision !== "Consolidate first" || !urlSet.has(normalizeUrl(row.page_url)) || assignedRetestKeys.has(key)) return false;
      assignedRetestKeys.add(key);
      return true;
    });
    const summaryRows = [...urlSet].map((url) => pageRetestSummaryByUrl.get(url)).filter(Boolean);
    const actionMatches = [...urlSet].map((url) => actionByUrl.get(url)).filter(Boolean);
    const decisionMatches = [...urlSet].map((url) => pageDecisionByUrl.get(url)).filter(Boolean);
    const ticket = ticketByUrl.get(survivorUrlKey) || {};
    const priority = rows.reduce((sum, row) => sum + toNumber(row.priority), 0)
      + actionMatches.reduce((sum, row) => sum + Math.round(toNumber(row.priority) / 3), 0)
      + retestRows.length * 8;
    const requestCount = retestRows.length;
    const prompts = joinList([
      ...rows.flatMap((row) => splitList(row.prompts_to_preserve)),
      ...retestRows.map((row) => row.prompt),
      ...summaryRows.flatMap((row) => splitList(row.prompts)),
      ...splitList(ticket.prompts_to_preserve),
    ], 32);
    const competitors = joinList([
      ...rows.flatMap((row) => splitList(row.competitors_to_cover)),
      ...retestRows.flatMap((row) => splitList(row.competitors)),
      ...decisionMatches.flatMap((row) => splitList(row.competitors)),
      ...splitList(ticket.competitors),
    ], 24);
    const products = joinList([
      ...rows.flatMap((row) => splitList(row.product_modules_to_keep)),
      ...retestRows.flatMap((row) => splitList(row.products_to_feature)),
      ...decisionMatches.flatMap((row) => splitList(row.products_to_feature)),
      ...splitList(ticket.product_modules),
    ], 22);
    const mergeFromTitles = joinList(rows.flatMap((row) => splitList(row.merge_from_titles)), 18);
    const mergeFromUrls = joinList(rows.flatMap((row) => splitList(row.merge_from_urls)), 18);
    const pressureTitles = joinList(rows.map((row) => row.benchmark_pressure_title), 10);
    const pressureUrls = joinList(rows.map((row) => row.benchmark_pressure_url), 10);
    const row = {
      rank: 0,
      priority_score: priority,
      decision_lane: decisionLane(rows),
      review_status: reviewStatus(rows, requestCount),
      category: joinList(rows.flatMap((item) => splitList(item.category)), 8),
      survivor_title: rows[0]?.recommended_survivor_title || ticket.page_title || "Unknown survivor",
      survivor_url: rows[0]?.recommended_survivor_url || "",
      merge_from_titles: mergeFromTitles,
      merge_from_urls: mergeFromUrls,
      benchmark_pressure_titles: pressureTitles,
      benchmark_pressure_urls: pressureUrls,
      benchmark_pressure: rows.reduce((sum, item) => sum + toNumber(item.benchmark_pressure), 0),
      query_count: rows.reduce((sum, item) => sum + toNumber(item.query_count), 0),
      zero_mention_queries: rows.reduce((sum, item) => sum + toNumber(item.zero_mention_queries), 0),
      competitor_only_answers: rows.reduce((sum, item) => sum + toNumber(item.competitor_only_answers), 0),
      prompts_to_preserve: prompts,
      competitors_to_cover: competitors,
      product_modules_to_keep: products,
      missing_structure: joinList(rows.flatMap((item) => splitList(item.missing_structure)), 16),
      priority_retest_requests: requestCount,
      providers: countSummary(retestRows.map((item) => item.provider), 6) || joinList(summaryRows.map((item) => item.providers), 6),
      waves: countSummary(retestRows.map((item) => item.wave), 8) || joinList(summaryRows.map((item) => item.waves), 8),
      prompt_types: countSummary(retestRows.map((item) => item.prompt_type), 8),
      first_move: firstMove(rows, actionMatches),
      redirect_advice: redirectAdvice(rows),
      release_gate: releaseGate(requestCount),
      success_metric: successMetric(rows, retestRows),
      related_decision_pages: joinList(decisionMatches.map((item) => item.title), 10),
      source_rows: rows.length,
    };
    workbookRows.push(row);
  }

  const supplementalRetestGroups = groupBy(
    pageRetestRows.filter((row) => {
      const key = retestKey(row);
      return row.decision === "Consolidate first" && !assignedRetestKeys.has(key);
    }),
    (row) => normalizeUrl(row.page_url),
  );

  for (const [urlKey, retestRows] of supplementalRetestGroups.entries()) {
    for (const row of retestRows) assignedRetestKeys.add(retestKey(row));
    const decisionRow = pageDecisionByUrl.get(urlKey) || {};
    const actionRow = actionByUrl.get(urlKey) || {};
    const summaryRow = pageRetestSummaryByUrl.get(urlKey) || {};
    const ticket = ticketByUrl.get(urlKey) || {};
    const priority = Math.round(toNumber(decisionRow.priority || actionRow.priority) / 2) + retestRows.length * 9;
    workbookRows.push({
      rank: 0,
      priority_score: priority,
      decision_lane: "consolidate first from retest map",
      review_status: "human survivor decision required",
      category: joinList([decisionRow.category, actionRow.category, ...retestRows.map((item) => item.category)], 8),
      survivor_title: decisionRow.title || actionRow.title || ticket.page_title || retestRows[0]?.closest_post || "Unresolved survivor candidate",
      survivor_url: decisionRow.url || actionRow.url || ticket.page_url || retestRows[0]?.page_url || "",
      merge_from_titles: "",
      merge_from_urls: "",
      benchmark_pressure_titles: retestRows[0]?.closest_post || "",
      benchmark_pressure_urls: retestRows[0]?.page_url || "",
      benchmark_pressure: toNumber(decisionRow.page_priority || actionRow.priority),
      query_count: uniq(retestRows.map((item) => item.prompt)).length,
      zero_mention_queries: toNumber(actionRow.zero_mention_queries),
      competitor_only_answers: toNumber(actionRow.competitor_only_answers),
      prompts_to_preserve: joinList([
        ...retestRows.map((item) => item.prompt),
        ...splitList(actionRow.retest_prompts),
        ...splitList(ticket.prompts_to_preserve),
        ...splitList(summaryRow.prompts),
      ], 32),
      competitors_to_cover: joinList([
        ...retestRows.flatMap((item) => splitList(item.competitors)),
        ...splitList(actionRow.competitors),
        ...splitList(ticket.competitors),
      ], 24),
      product_modules_to_keep: joinList([
        ...retestRows.flatMap((item) => splitList(item.products_to_feature)),
        ...splitList(actionRow.products_to_feature),
        ...splitList(ticket.product_modules),
      ], 22),
      missing_structure: actionRow.top_fix || "",
      priority_retest_requests: retestRows.length,
      providers: countSummary(retestRows.map((item) => item.provider), 6),
      waves: countSummary(retestRows.map((item) => item.wave), 8),
      prompt_types: countSummary(retestRows.map((item) => item.prompt_type), 8),
      first_move: actionRow.first_move || decisionRow.first_move || "Confirm whether this URL is the survivor or a merge-from page, then preserve benchmark prompts and product modules before retesting.",
      redirect_advice: "Do not redirect yet. This page is in the priority retest map but lacks a canonical queue survivor row, so the survivor URL must be confirmed manually.",
      release_gate: releaseGate(retestRows.length),
      success_metric: successMetric([], retestRows),
      related_decision_pages: decisionRow.title || actionRow.title || "",
      source_rows: 0,
    });
  }

  workbookRows.sort((a, b) => b.priority_score - a.priority_score || b.priority_retest_requests - a.priority_retest_requests);
  workbookRows.forEach((row, index) => {
    row.rank = index + 1;
  });

  const redirectHoldRows = [];
  for (const row of workbookRows) {
    const titles = splitList(row.merge_from_titles);
    const urls = splitList(row.merge_from_urls);
    urls.forEach((url, index) => {
      redirectHoldRows.push({
        rank: row.rank,
        hold_action: /safe duplicate/i.test(row.decision_lane) ? "confirm then redirect or unpublish" : "hold redirect",
        merge_from_title: titles[index] || titles[0] || "Merge-from page",
        merge_from_url: url,
        survivor_title: row.survivor_title,
        survivor_url: row.survivor_url,
        reason: row.redirect_advice,
      });
    });
  }

  const retestCoverageRows = workbookRows
    .filter((row) => row.priority_retest_requests > 0)
    .map((row) => ({
      rank: row.rank,
      survivor_title: row.survivor_title,
      survivor_url: row.survivor_url,
      priority_retest_requests: row.priority_retest_requests,
      providers: row.providers,
      waves: row.waves,
      prompt_types: row.prompt_types,
      prompts: row.prompts_to_preserve,
      gate: row.release_gate,
    }));

  const manualReviewClusters = workbookRows.filter((row) => /human survivor decision required/i.test(row.review_status)).length;
  const blockedRequests = workbookRows
    .filter((row) => /human survivor decision|required|merge/i.test(row.review_status))
    .reduce((sum, row) => sum + toNumber(row.priority_retest_requests), 0);
  const summary = {
    generated_at: new Date().toISOString(),
    survivor_clusters: workbookRows.length,
    canonical_rows: canonicalRows.length,
    manual_review_clusters: manualReviewClusters,
    safe_duplicate_clusters: workbookRows.filter((row) => /safe duplicate/i.test(row.decision_lane)).length,
    priority_retest_requests: workbookRows.reduce((sum, row) => sum + toNumber(row.priority_retest_requests), 0),
    blocked_requests: blockedRequests,
    redirect_hold_rows: redirectHoldRows.length,
    categories: joinList(workbookRows.flatMap((row) => splitList(row.category)), 12),
  };

  const prioritySvg = barSvg({
    title: "Survivor decision priority",
    rows: workbookRows.map((row) => ({
      label: row.survivor_title,
      value: row.priority_score,
      color: /human survivor/i.test(row.review_status) ? "#f97316" : "#0f766e",
    })),
  });
  const retestSvg = barSvg({
    title: "Priority retest requests by survivor",
    rows: retestCoverageRows.map((row) => ({
      label: row.survivor_title,
      value: row.priority_retest_requests,
      color: "#2563eb",
    })),
  });

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "survivor-decision-workbook.csv"), csv([
    [
      "rank",
      "priority_score",
      "decision_lane",
      "review_status",
      "category",
      "survivor_title",
      "survivor_url",
      "merge_from_titles",
      "merge_from_urls",
      "benchmark_pressure_titles",
      "benchmark_pressure_urls",
      "benchmark_pressure",
      "query_count",
      "zero_mention_queries",
      "competitor_only_answers",
      "priority_retest_requests",
      "providers",
      "waves",
      "prompts_to_preserve",
      "competitors_to_cover",
      "product_modules_to_keep",
      "missing_structure",
      "first_move",
      "redirect_advice",
      "release_gate",
      "success_metric",
      "related_decision_pages",
      "source_rows",
    ],
    ...workbookRows.map((row) => [
      row.rank,
      row.priority_score,
      row.decision_lane,
      row.review_status,
      row.category,
      row.survivor_title,
      row.survivor_url,
      row.merge_from_titles,
      row.merge_from_urls,
      row.benchmark_pressure_titles,
      row.benchmark_pressure_urls,
      row.benchmark_pressure,
      row.query_count,
      row.zero_mention_queries,
      row.competitor_only_answers,
      row.priority_retest_requests,
      row.providers,
      row.waves,
      row.prompts_to_preserve,
      row.competitors_to_cover,
      row.product_modules_to_keep,
      row.missing_structure,
      row.first_move,
      row.redirect_advice,
      row.release_gate,
      row.success_metric,
      row.related_decision_pages,
      row.source_rows,
    ]),
  ]));
  await writeFile(path.join(outDir, "first-20-survivor-decisions.csv"), csv([
    ["rank", "priority_score", "review_status", "survivor_title", "survivor_url", "priority_retest_requests", "first_move", "release_gate"],
    ...workbookRows.slice(0, 20).map((row) => [
      row.rank,
      row.priority_score,
      row.review_status,
      row.survivor_title,
      row.survivor_url,
      row.priority_retest_requests,
      row.first_move,
      row.release_gate,
    ]),
  ]));
  await writeFile(path.join(outDir, "survivor-cluster-retest-coverage.csv"), csv([
    ["rank", "survivor_title", "survivor_url", "priority_retest_requests", "providers", "waves", "prompt_types", "prompts", "gate"],
    ...retestCoverageRows.map((row) => [
      row.rank,
      row.survivor_title,
      row.survivor_url,
      row.priority_retest_requests,
      row.providers,
      row.waves,
      row.prompt_types,
      row.prompts,
      row.gate,
    ]),
  ]));
  await writeFile(path.join(outDir, "redirect-hold-list.csv"), csv([
    ["rank", "hold_action", "merge_from_title", "merge_from_url", "survivor_title", "survivor_url", "reason"],
    ...redirectHoldRows.map((row) => [
      row.rank,
      row.hold_action,
      row.merge_from_title,
      row.merge_from_url,
      row.survivor_title,
      row.survivor_url,
      row.reason,
    ]),
  ]));
  await writeFile(path.join(outDir, "survivor-url-decision-data.json"), JSON.stringify({ summary, workbookRows, redirectHoldRows, retestCoverageRows }, null, 2));
  await writeFile(path.join(outDir, "survivor-decision-priority.svg"), prioritySvg);
  await writeFile(path.join(outDir, "retest-requests-by-survivor.svg"), retestSvg);
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({
    summary,
    topDecisions: workbookRows.slice(0, 24),
    redirectHoldRows,
    retestCoverageRows,
  }));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({
    summary,
    topDecisions: workbookRows.slice(0, 12),
    redirectHoldRows,
    retestCoverageRows,
  }));

  console.log(`Wrote ${outDir}`);
  console.log(`Survivor clusters: ${summary.survivor_clusters}`);
  console.log(`Priority retest requests mapped: ${summary.priority_retest_requests}`);
  console.log(`Blocked until survivor merge: ${summary.blocked_requests}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
