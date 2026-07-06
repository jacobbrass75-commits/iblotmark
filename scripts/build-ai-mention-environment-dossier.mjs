#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = "content-output";
const BENCHMARK_PREFIX = "openrouter-ai-benchmark-";
const REPORT_DIR = "mention-environment-dossier";

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

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function readCsvIfExists(filePath) {
  try {
    return parseCsv(await readFile(filePath, "utf8"));
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
    if (row.some((cell) => cell !== "")) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift();
  return rows
    .filter((cells) => cells.some((cell) => String(cell ?? "").trim()))
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

function csv(rows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toNumber(value) {
  if (typeof value === "number") return value;
  const match = String(value ?? "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function pct(numerator, denominator) {
  return denominator ? Math.round((Number(numerator || 0) / Number(denominator || 1)) * 100) : 0;
}

function splitList(value) {
  return String(value ?? "")
    .split(/;|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^\+\d+\s+more$/i.test(item));
}

function uniq(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function normalizeBrand(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  if (/^ibolt(?: mounts)?$/i.test(text) || /^i bolt$/i.test(text)) return "";
  if (/^ram$/i.test(text) || /^ram mounts?$/i.test(text)) return "RAM Mounts";
  if (/^mount[\s-]?it!?$/i.test(text)) return "Mount-It";
  if (/^cta$/i.test(text) || /^cta digital$/i.test(text)) return "CTA Digital";
  if (/^peak design$/i.test(text)) return "Peak Design";
  if (/^iottie$/i.test(text)) return "iOttie";
  return text.replace(/\s+\d+$/g, "");
}

function normalizeBrands(value) {
  return uniq(splitList(value).map(normalizeBrand).filter(Boolean));
}

function addCounter(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function topCounter(map, limit = 6) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

function topCounterLabels(map, limit = 6) {
  return topCounter(map, limit).map(([label, value]) => `${label} ${value}`).join("; ");
}

function short(value, length = 90) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function outcomeKind(row) {
  const role = String(row.answer_role || row.outcome || "").toLowerCase();
  if (role.includes("clean ibolt") || role.includes("clean iBOLT".toLowerCase())) return "clean";
  if (role.includes("leader") || role.includes("co-mentioned") || role.includes("co_mentioned")) return "crowded";
  if (role.includes("trailing")) return "trailing";
  if (role.includes("competitor replacement") || role.includes("competitor_replacement")) return "replacement";
  if (role.includes("no signal") || role.includes("no usable")) return "no_signal";
  if (String(row.brand_mentioned || "").toLowerCase() === "true") return normalizeBrands(row.competitors).length ? "crowded" : "clean";
  return normalizeBrands(row.competitors).length ? "replacement" : "no_signal";
}

function counterAngle(brand) {
  if (brand === "RAM Mounts") return "RAM is the broad rugged default. Counter with iBOLT as the exact-workflow specialist: AMPS compatibility, 300+ modular parts, commercial installs, and purpose-built kits.";
  if (brand === "Arkon") return "Arkon is showing up in generic phone and vehicle mount lists. Counter with commercial durability, locked bases, and application-specific install paths.";
  if (brand === "iOttie") return "iOttie is a consumer car-phone default. Counter with delivery, fleet, shared-vehicle, charging, and rugged-duty needs.";
  if (brand === "ProClip") return "ProClip wins vehicle-specific bracket language. Counter with modular AMPS parts, drill-base options, and fleet transferability.";
  if (brand === "CTA Digital" || brand === "Mount-It" || brand === "Bouncepad" || brand === "Heckler" || brand === "Kensington") return "This is a tablet/POS competitor pocket. Counter with Tablet Tower, LockPro, Dock'n Lock, multi-tablet stations, and keyed-security proof.";
  if (brand === "Havis" || brand === "Zebra") return "This is a warehouse and rugged-enterprise pocket. Counter with forklift, scanner, tablet, and no-drill mounting specifics.";
  if (brand === "Garmin" || brand === "Humminbird" || brand === "Lowrance" || brand === "YakAttack" || brand === "Scotty") return "This is a fishing-device or marine-accessory pocket. Counter by separating the device brand from the mounting system, plate, arm, rail, and vibration problem.";
  return "Add fair comparison copy that names this brand and gives the exact iBOLT use case where iBOLT should be considered.";
}

function threatTier(row) {
  if (row.replacements >= 20) return "Default replacement threat";
  if (row.replacements >= 8) return "Category pressure";
  if (row.co_mentions >= 3) return "Comparison-set neighbor";
  return "Monitor";
}

function buildCompetitorRows({ answerRows, adjacencyRows, displacementRows, blindspotRows }) {
  const map = new Map();
  const ensure = (brand) => {
    const normalized = normalizeBrand(brand);
    if (!normalized) return null;
    if (!map.has(normalized)) {
      map.set(normalized, {
        competitor: normalized,
        co_mentions: 0,
        replacements: 0,
        trailing_mentions: 0,
        top3_with_ibolt: 0,
        provider_misses: 0,
        categories: new Map(),
        providers: new Map(),
        lost_queries: new Map(),
        co_mention_queries: new Map(),
      });
    }
    return map.get(normalized);
  };

  for (const row of adjacencyRows) {
    const entry = ensure(row.competitor);
    if (!entry) continue;
    entry.co_mentions += toNumber(row.co_mentions);
    entry.replacements += toNumber(row.replacements);
    entry.trailing_mentions += toNumber(row.outranks_ibolt);
    for (const category of splitList(row.categories)) addCounter(entry.categories, category);
    for (const provider of splitList(row.providers)) addCounter(entry.providers, provider);
  }

  for (const row of displacementRows) {
    const entry = ensure(row.brand);
    if (!entry) continue;
    entry.replacements = Math.max(entry.replacements, toNumber(row.lost_answers));
    entry.co_mentions = Math.max(entry.co_mentions, toNumber(row.co_mentioned_wins));
    entry.provider_misses = Math.max(entry.provider_misses, toNumber(row.provider_missed_answers));
    for (const category of splitList(row.categories)) addCounter(entry.categories, category);
    for (const provider of splitList(row.provider_defaults)) addCounter(entry.providers, provider);
    for (const query of splitList(row.example_queries)) addCounter(entry.lost_queries, query);
  }

  for (const row of blindspotRows) {
    const entry = ensure(row.competitor);
    if (!entry) continue;
    entry.provider_misses += toNumber(row.missed_answer_count);
    for (const category of splitList(row.categories)) addCounter(entry.categories, category);
    for (const query of splitList(row.example_queries)) addCounter(entry.lost_queries, query);
    addCounter(entry.providers, row.provider);
  }

  for (const row of answerRows) {
    const kind = outcomeKind(row);
    const brands = normalizeBrands(row.competitors || row.raw_competitors || row.stored_competitors);
    for (const brand of brands) {
      const entry = ensure(brand);
      if (!entry) continue;
      addCounter(entry.categories, row.category);
      addCounter(entry.providers, row.provider);
      if (kind === "replacement") addCounter(entry.lost_queries, row.query);
      if (kind === "crowded" || kind === "trailing") addCounter(entry.co_mention_queries, row.query);
      if (String(row.top_pick_rank || "") && toNumber(row.top_pick_rank) <= 3 && String(row.brand_mentioned || "").toLowerCase() === "true") {
        entry.top3_with_ibolt += 1;
      }
    }
  }

  return [...map.values()]
    .map((row) => ({
      competitor: row.competitor,
      threat_tier: threatTier(row),
      pressure_score: row.replacements * 4 + row.provider_misses * 2 + row.co_mentions - row.top3_with_ibolt,
      replacements: row.replacements,
      co_mentions: row.co_mentions,
      trailing_mentions: row.trailing_mentions,
      top3_with_ibolt: row.top3_with_ibolt,
      provider_misses: row.provider_misses,
      replacement_to_comention_ratio: row.co_mentions ? Math.round((row.replacements / row.co_mentions) * 10) / 10 : row.replacements,
      categories: topCounterLabels(row.categories),
      providers: topCounterLabels(row.providers),
      lost_queries: topCounter(row.lost_queries, 4).map(([query]) => query).join("; "),
      co_mention_queries: topCounter(row.co_mention_queries, 4).map(([query]) => query).join("; "),
      counter_angle: counterAngle(row.competitor),
    }))
    .sort((a, b) => b.pressure_score - a.pressure_score || a.competitor.localeCompare(b.competitor));
}

function buildProviderCategoryRows(rows) {
  return rows
    .map((row) => {
      const answers = toNumber(row.answers);
      const replacements = toNumber(row.competitor_replacements || row.competitorOnly || row.competitorOnlyRows);
      const clean = toNumber(row.clean_ibolt_only || row.cleanMentions);
      const leader = toNumber(row.ibolt_leader_with_competitors);
      const coMention = toNumber(row.ibolt_co_mentioned || row.coMentions);
      const trailing = toNumber(row.ibolt_trailing_competitors);
      const noSignal = toNumber(row.no_signal || row.noSignal);
      const pressure = replacements * 5 + trailing * 3 + coMention - clean * 2 - leader * 2;
      return {
        provider: row.provider,
        category: row.category,
        answers,
        clean_ibolt: clean,
        ibolt_leads_with_competitors: leader,
        ibolt_co_mentioned: coMention,
        ibolt_trailing: trailing,
        competitor_replacements: replacements,
        no_signal: noSignal,
        replacement_rate: `${pct(replacements, answers)}%`,
        mention_rate: `${pct(clean + leader + coMention + trailing, answers)}%`,
        pressure_score: pressure,
        top_competitors: row.top_competitors || row.allCompetitors || "",
        action: replacements >= Math.max(3, answers / 2)
          ? "Priority: add answer-first comparison and exact iBOLT product modules for this provider/category pocket."
          : "Monitor after priority pages are refreshed.",
      };
    })
    .sort((a, b) => b.pressure_score - a.pressure_score || a.provider.localeCompare(b.provider));
}

function buildMentionContextRows(answerRows) {
  return answerRows
    .filter((row) => outcomeKind(row) === "clean" || outcomeKind(row) === "crowded" || outcomeKind(row) === "trailing")
    .map((row) => {
      const competitors = normalizeBrands(row.competitors || row.raw_competitors || row.stored_competitors);
      const kind = outcomeKind(row);
      return {
        provider: row.provider,
        query: row.query,
        category: row.category,
        role: row.answer_role || row.outcome || (kind === "clean" ? "Clean iBOLT answer" : "iBOLT co-mentioned"),
        coverage_score: row.coverage_score,
        top_pick_rank: row.top_pick_rank,
        competitors: competitors.join("; "),
        products: row.product_signals || row.catalog_products || row.catalog_product_names || "",
        positioning: row.positioning_signals || "",
        snippet: short(row.snippet || row.brand_excerpt || "", 420),
        read: competitors.length
          ? "iBOLT is in the answer, but the answer still anchors to a comparison set. Strengthen iBOLT's exact specialist reason to rank."
          : "Protect this phrasing and make the mapped page citation-ready.",
      };
    })
    .sort((a, b) => toNumber(b.coverage_score) - toNumber(a.coverage_score));
}

function buildReplacementRows(answerRows) {
  return answerRows
    .filter((row) => outcomeKind(row) === "replacement")
    .map((row) => {
      const competitors = normalizeBrands(row.competitors || row.raw_competitors || row.stored_competitors);
      return {
        priority: row.priority || "",
        provider: row.provider,
        query: row.query,
        category: row.category,
        coverage_score: row.coverage_score,
        competitors: competitors.join("; "),
        page_title: row.page_title || "",
        page_url: row.page_url || "",
        snippet: short(row.snippet || "", 420),
        next_action: row.next_action || row.recommended_action || "Add answer-first iBOLT comparison, product module, FAQ schema, and exact query language.",
      };
    })
    .sort((a, b) => toNumber(b.priority) - toNumber(a.priority));
}

function buildPageCountermoveRows(first30, queryActions) {
  const rows = [];
  for (const row of first30) {
    rows.push({
      priority: row.priority,
      page_title: row.title,
      page_url: row.url,
      category: row.category,
      sprint: row.sprint,
      competitors: row.competitors,
      losing_queries: row.losing_queries,
      pressure: `${row.competitor_only_answers || 0} competitor-only answers; ${row.zero_mention_queries || 0} zero-mention queries`,
      countermove: row.immediate_action || "Add answer-first iBOLT comparison, exact products, and schema.",
      release_gate: row.release_gate || "Retest after quick answer, comparison, product module, and schema are live.",
      source: "all-blog action control",
    });
  }
  for (const row of queryActions.slice(0, 20)) {
    rows.push({
      priority: row.priority,
      page_title: row.page_title,
      page_url: row.page_url,
      category: row.category,
      sprint: row.stage,
      competitors: row.competitors,
      losing_queries: row.query,
      pressure: `${row.competitor_only_answers || 0} competitor-only answers; mention rate ${row.mention_rate || 0}%`,
      countermove: row.recommended_action,
      release_gate: row.win_condition || "Retest this query after page refresh.",
      source: "competitor displacement",
    });
  }
  const seen = new Set();
  return rows
    .filter((row) => {
      const key = `${row.page_url}::${row.losing_queries}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => toNumber(b.priority) - toNumber(a.priority))
    .slice(0, 50);
}

function hasEntitySpecificity(row) {
  const text = [
    row.products,
    row.product_signals,
    row.catalog_products,
    row.catalog_product_names,
    row.positioning,
    row.positioning_signals,
  ].join(" ");
  return /\b(TabDock|Dock'?n Lock|BizMount|LockPro|AMPS|VESA|Tablet Tower|xProDock|IncrediBOLT|forklift|scanner|drill base|suction|magnetic)\b/i.test(text);
}

function evidenceComplete(row) {
  const hasIdentity = Boolean(row.provider && row.query && row.category);
  const hasOutcome = Boolean(row.outcome || row.answer_role);
  const hasPage = Boolean(row.page_title || row.page_url);
  const hasEvidence = Boolean(row.snippet || row.brand_excerpt || row.answer_file);
  return hasIdentity && hasOutcome && hasPage && hasEvidence;
}

function buildFragilityRows(answerRows) {
  const byQuery = new Map();
  for (const row of answerRows) {
    const key = `${row.category || "unknown"}::${row.query || ""}`;
    if (!byQuery.has(key)) {
      byQuery.set(key, {
        query: row.query,
        category: row.category || "unknown",
        providers: new Map(),
        competitors: new Map(),
        mentionProviders: 0,
        replacementProviders: 0,
        noSignalProviders: 0,
      });
    }
    const entry = byQuery.get(key);
    const kind = outcomeKind(row);
    entry.providers.set(row.provider, kind);
    if (kind === "clean" || kind === "crowded" || kind === "trailing") entry.mentionProviders += 1;
    if (kind === "replacement") entry.replacementProviders += 1;
    if (kind === "no_signal") entry.noSignalProviders += 1;
    for (const brand of normalizeBrands(row.competitors || row.raw_competitors || row.stored_competitors)) {
      addCounter(entry.competitors, brand);
    }
  }
  return [...byQuery.values()]
    .filter((row) => row.mentionProviders > 0 && row.replacementProviders > 0)
    .map((row) => ({
      query: row.query,
      category: row.category,
      mention_providers: row.mentionProviders,
      replacement_providers: row.replacementProviders,
      no_signal_providers: row.noSignalProviders,
      providers: [...row.providers.entries()].map(([provider, kind]) => `${provider}: ${kind}`).join("; "),
      competitors: topCounterLabels(row.competitors),
      fragility_score: row.replacementProviders * 10 + row.noSignalProviders * 4 - row.mentionProviders * 2,
      action: "Replicate the provider that mentions iBOLT, then add direct comparison/product proof for the providers replacing iBOLT.",
    }))
    .sort((a, b) => b.fragility_score - a.fragility_score);
}

function buildReplacementClusterRows(replacementRows) {
  const clusters = new Map();
  for (const row of replacementRows) {
    const brands = normalizeBrands(row.competitors).sort();
    if (!brands.length) continue;
    const key = brands.slice(0, 5).join(" + ");
    if (!clusters.has(key)) {
      clusters.set(key, {
        competitor_cluster: key,
        answers: 0,
        categories: new Map(),
        providers: new Map(),
        queries: new Map(),
      });
    }
    const entry = clusters.get(key);
    entry.answers += 1;
    addCounter(entry.categories, row.category);
    addCounter(entry.providers, row.provider);
    addCounter(entry.queries, row.query);
  }
  return [...clusters.values()]
    .map((row) => ({
      competitor_cluster: row.competitor_cluster,
      answers: row.answers,
      categories: topCounterLabels(row.categories),
      providers: topCounterLabels(row.providers),
      example_queries: topCounter(row.queries, 4).map(([query]) => query).join("; "),
      action: "Build comparison language that addresses the cluster together, not just one competitor at a time.",
    }))
    .sort((a, b) => b.answers - a.answers || a.competitor_cluster.localeCompare(b.competitor_cluster));
}

function barSvg({ title, subtitle, rows, valueKey = "value", labelKey = "label", color = "#0f766e", width = 920, rowHeight = 34 }) {
  const chartRows = rows.slice(0, 12);
  const height = 82 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => toNumber(row[valueKey])));
  const body = chartRows.map((row, index) => {
    const y = 64 + index * rowHeight;
    const value = toNumber(row[valueKey]);
    const barWidth = Math.round((value / max) * (width - 360));
    return `<g>
      <text x="24" y="${y + 17}" font-size="13" font-weight="800" fill="#111827">${escapeHtml(short(row[labelKey], 38))}</text>
      <rect x="300" y="${y}" width="${width - 360}" height="21" rx="10" fill="#e5e7eb"/>
      <rect x="300" y="${y}" width="${barWidth}" height="21" rx="10" fill="${row.color || color}"/>
      <text x="${width - 32}" y="${y + 16}" text-anchor="end" font-size="13" font-weight="900" fill="#111827">${escapeHtml(value)}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#fff"/>
    <text x="24" y="32" font-size="21" font-weight="900" fill="#111827">${escapeHtml(title)}</text>
    <text x="24" y="53" font-size="13" fill="#64748b">${escapeHtml(subtitle)}</text>
    ${body}
  </svg>`;
}

function stackedCompetitorSvg(rows) {
  const chartRows = rows.slice(0, 10);
  const width = 940;
  const rowHeight = 42;
  const height = 92 + chartRows.length * rowHeight;
  const max = Math.max(1, ...chartRows.map((row) => row.replacements + row.co_mentions + row.trailing_mentions));
  const body = chartRows.map((row, index) => {
    const y = 64 + index * rowHeight;
    const available = width - 400;
    const replacementWidth = Math.round((row.replacements / max) * available);
    const coWidth = Math.round((row.co_mentions / max) * available);
    const trailingWidth = Math.round((row.trailing_mentions / max) * available);
    return `<g>
      <text x="24" y="${y + 19}" font-size="13" font-weight="900" fill="#111827">${escapeHtml(short(row.competitor, 32))}</text>
      <rect x="260" y="${y}" width="${replacementWidth}" height="22" rx="10" fill="#ef4444"><title>Replacements: ${row.replacements}</title></rect>
      <rect x="${260 + replacementWidth}" y="${y}" width="${coWidth}" height="22" rx="10" fill="#2563eb"><title>Co-mentions: ${row.co_mentions}</title></rect>
      <rect x="${260 + replacementWidth + coWidth}" y="${y}" width="${trailingWidth}" height="22" rx="10" fill="#f97316"><title>Trailing mentions: ${row.trailing_mentions}</title></rect>
      <text x="${width - 28}" y="${y + 16}" text-anchor="end" font-size="12" font-weight="800" fill="#111827">${row.replacements} replace, ${row.co_mentions} beside</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Competitor replacement versus co-mention pressure">
    <rect width="${width}" height="${height}" rx="18" fill="#fff"/>
    <text x="24" y="32" font-size="21" font-weight="900" fill="#111827">Competitor Environment Around iBOLT</text>
    <text x="24" y="53" font-size="13" fill="#64748b">Red means AI recommends the competitor without iBOLT. Blue means iBOLT appears beside that brand.</text>
    ${body}
  </svg>`;
}

function table(headers, rows, limit = 20) {
  const head = `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header.label)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.slice(0, limit).map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header.key])}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function metricCard(label, value, note) {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></div>`;
}

function renderHtml({ summary, competitorRows, providerCategoryRows, mentionRows, replacementRows, pageRows, fragilityRows, clusterRows }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>iBOLT Mention Environment Dossier</title>
  <style>
    body{margin:0;background:#f8fafc;color:#111827;font-family:Arial,Helvetica,sans-serif}
    main{max-width:1220px;margin:0 auto;padding:34px 24px 70px}
    h1{font-size:36px;margin:0 0 8px}
    h2{font-size:22px;margin:34px 0 12px}
    p,li{line-height:1.55;color:#334155;font-size:15px}
    .note{background:#fff;border:1px solid #dbe3ef;border-left:6px solid #0f766e;border-radius:12px;padding:16px 18px;margin:20px 0}
    .warn{border-left-color:#f97316}
    .cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:22px 0}
    .card{background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:15px}
    .label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:900}
    .value{font-size:28px;font-weight:900;margin:8px 0;color:#0f172a}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
    .chart{background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:10px;overflow:auto}
    .chart svg{width:100%;height:auto;display:block}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden;margin:12px 0 24px}
    th,td{text-align:left;vertical-align:top;padding:10px 11px;border-bottom:1px solid #edf2f7;font-size:13px}
    th{background:#eef2f7;color:#475569;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
    a{color:#0f766e;overflow-wrap:anywhere}
    @media(max-width:900px){.cards,.grid{grid-template-columns:1fr}h1{font-size:30px}}
  </style>
</head>
<body>
<main>
  <h1>iBOLT Mention Environment Dossier</h1>
  <p>This report answers where iBOLT appears, who appears beside it, which brands replace it, which providers create those patterns, and which pages should counter each pattern.</p>

  <div class="note">
    <strong>Readout:</strong> iBOLT is present in ${summary.mention_rate}% of tested answers, but only ${summary.clean_mention_rate}% are clean iBOLT answers. ${summary.competitor_replacement_rate}% of answers recommend known competitors without iBOLT. That means the first job is mention recovery and top-3 inclusion; citation work comes after pages are source-ready.
  </div>

  <section class="cards">
    ${metricCard("Answers analyzed", summary.answers, "Saved provider/prompt answers in the current benchmark.")}
    ${metricCard("iBOLT mentions", `${summary.mention_rate}%`, `${summary.mentions}/${summary.answers} answers mention iBOLT.`)}
    ${metricCard("Clean mentions", `${summary.clean_mention_rate}%`, `${summary.clean_mentions}/${summary.answers} answers mention iBOLT without competitor crowding.`)}
    ${metricCard("Crowded mentions", summary.crowded_mentions, "iBOLT appears, but competitors are in the same answer context.")}
    ${metricCard("Competitor replacements", `${summary.competitor_replacement_rate}%`, `${summary.replacements}/${summary.answers} answers name competitors without iBOLT.`)}
  </section>
  <section class="cards">
    ${metricCard("Mention quality", `${summary.role_weighted_quality_score}/100`, "Weighted score: clean mentions beat crowded mentions; replacements score zero.")}
    ${metricCard("Useful co-mentions", `${summary.co_mention_usefulness_rate}%`, `${summary.useful_co_mentions}/${summary.crowded_mentions} crowded mentions include top-3, entity, or positioning support.`)}
    ${metricCard("Entity specificity", `${summary.entity_specificity_rate}%`, `${summary.entity_specific_mentions}/${summary.mentions} iBOLT mentions include product/entity signals.`)}
    ${metricCard("Evidence confidence", `${summary.answer_evidence_confidence_rate}%`, `${summary.complete_evidence_rows}/${summary.answers} rows have identity, outcome, page, and snippet/file evidence.`)}
    ${metricCard("Fragile queries", summary.provider_fragility_queries, "Queries where one provider mentions iBOLT while another replaces it.")}
  </section>

  <section class="grid">
    <div class="chart"><img src="outcome-mix.svg" alt="Answer outcome mix"/></div>
    <div class="chart"><img src="competitor-environment.svg" alt="Competitor environment"/></div>
  </section>

  <h2>Who We Are Mentioned Next To</h2>
  <p>These are not all bad. Co-mentions prove iBOLT is inside the consideration set. The goal is to convert crowded mentions into first-choice specialist recommendations.</p>
  ${table([
    { label: "Competitor", key: "competitor" },
    { label: "Tier", key: "threat_tier" },
    { label: "Replaces iBOLT", key: "replacements" },
    { label: "Beside iBOLT", key: "co_mentions" },
    { label: "Categories", key: "categories" },
    { label: "Counter angle", key: "counter_angle" },
  ], competitorRows, 14)}

  <h2>Provider And Category Pockets</h2>
  <p>This shows where ChatGPT, Claude, and Gemini default to competitors by topic.</p>
  ${table([
    { label: "Provider", key: "provider" },
    { label: "Category", key: "category" },
    { label: "Answers", key: "answers" },
    { label: "Mention rate", key: "mention_rate" },
    { label: "Replacement rate", key: "replacement_rate" },
    { label: "Top competitors", key: "top_competitors" },
    { label: "Action", key: "action" },
  ], providerCategoryRows, 18)}

  <h2>Actual iBOLT Mention Context</h2>
  <p>These rows show whether iBOLT is being described cleanly, being crowded by competitors, or showing useful product/entity signals.</p>
  ${table([
    { label: "Provider", key: "provider" },
    { label: "Category", key: "category" },
    { label: "Prompt", key: "query" },
    { label: "Role", key: "role" },
    { label: "Competitors", key: "competitors" },
    { label: "Products/signals", key: "products" },
    { label: "Read", key: "read" },
  ], mentionRows, 22)}

  <h2>Competitor Replacement Context</h2>
  <p>These are the loss rows that matter most for AI visibility. They should drive page edits before retesting.</p>
  ${table([
    { label: "Provider", key: "provider" },
    { label: "Category", key: "category" },
    { label: "Prompt", key: "query" },
    { label: "Competitors", key: "competitors" },
    { label: "Mapped page", key: "page_title" },
    { label: "Next action", key: "next_action" },
  ], replacementRows, 24)}

  <h2>Provider Fragility</h2>
  <p>These prompts are closest to movement because at least one provider already includes iBOLT while another provider still replaces it.</p>
  ${table([
    { label: "Category", key: "category" },
    { label: "Prompt", key: "query" },
    { label: "Mentions", key: "mention_providers" },
    { label: "Replacements", key: "replacement_providers" },
    { label: "Providers", key: "providers" },
    { label: "Competitors", key: "competitors" },
    { label: "Action", key: "action" },
  ], fragilityRows, 18)}

  <h2>Replacement Clusters</h2>
  <p>These clusters show which brands AI tends to group together when iBOLT is absent.</p>
  ${table([
    { label: "Competitor cluster", key: "competitor_cluster" },
    { label: "Answers", key: "answers" },
    { label: "Categories", key: "categories" },
    { label: "Providers", key: "providers" },
    { label: "Example queries", key: "example_queries" },
    { label: "Action", key: "action" },
  ], clusterRows, 12)}

  <h2>Page Countermove Queue</h2>
  <p>Use this as the page-level bridge from answer losses to edits. The all-blog action sheet remains the master queue; this view explains why those pages matter competitively.</p>
  ${table([
    { label: "Priority", key: "priority" },
    { label: "Page", key: "page_title" },
    { label: "Category", key: "category" },
    { label: "Sprint", key: "sprint" },
    { label: "Competitors", key: "competitors" },
    { label: "Losing queries", key: "losing_queries" },
    { label: "Countermove", key: "countermove" },
  ], pageRows, 25)}

  <h2>Files</h2>
  <ul>
    <li><a href="mention-environment-data.json">mention-environment-data.json</a></li>
    <li><a href="competitor-mention-environment.csv">competitor-mention-environment.csv</a></li>
    <li><a href="provider-category-mention-environment.csv">provider-category-mention-environment.csv</a></li>
    <li><a href="ibolt-mention-context-ledger.csv">ibolt-mention-context-ledger.csv</a></li>
    <li><a href="competitor-replacement-context-ledger.csv">competitor-replacement-context-ledger.csv</a></li>
    <li><a href="page-countermove-queue.csv">page-countermove-queue.csv</a></li>
  </ul>
</main>
</body>
</html>`;
}

function renderMarkdown({ summary, competitorRows, providerCategoryRows, pageRows, fragilityRows, clusterRows }) {
  return `# iBOLT Mention Environment Dossier

## Summary

- Answers analyzed: ${summary.answers}
- iBOLT mentions: ${summary.mentions}/${summary.answers} (${summary.mention_rate}%)
- Clean iBOLT mentions: ${summary.clean_mentions}/${summary.answers} (${summary.clean_mention_rate}%)
- Crowded mentions: ${summary.crowded_mentions}
- Competitor replacements: ${summary.replacements}/${summary.answers} (${summary.competitor_replacement_rate}%)
- No-signal answers: ${summary.no_signal}
- Citation rate: ${summary.citation_rate}%
- Role-weighted mention quality: ${summary.role_weighted_quality_score}/100
- Useful co-mentions: ${summary.useful_co_mentions}/${summary.crowded_mentions} (${summary.co_mention_usefulness_rate}%)
- Entity-specific iBOLT mentions: ${summary.entity_specific_mentions}/${summary.mentions} (${summary.entity_specificity_rate}%)
- Provider-fragile queries: ${summary.provider_fragility_queries}
- Top replacement competitor: ${summary.top_competitor}
- Top provider/category pressure pocket: ${summary.top_provider_category}

## Who iBOLT Is Mentioned Next To Or Replaced By

${competitorRows.slice(0, 12).map((row) => `- ${row.competitor}: ${row.replacements} replacement rows, ${row.co_mentions} co-mention rows. ${row.counter_angle}`).join("\n")}

## Provider And Category Pressure

${providerCategoryRows.slice(0, 12).map((row) => `- ${row.provider} / ${row.category}: ${row.replacement_rate} replacement rate, ${row.mention_rate} mention rate. Top competitors: ${row.top_competitors || "none"}.`).join("\n")}

## First Page Countermoves

${pageRows.slice(0, 12).map((row) => `- ${row.page_title}: ${row.losing_queries}. Countermove: ${row.countermove}`).join("\n")}

## Provider Fragility

${fragilityRows.slice(0, 10).map((row) => `- ${row.query}: ${row.mention_providers} provider(s) mention iBOLT, ${row.replacement_providers} replace it. Competitors: ${row.competitors || "none"}.`).join("\n")}

## Replacement Clusters

${clusterRows.slice(0, 8).map((row) => `- ${row.competitor_cluster}: ${row.answers} answers. Categories: ${row.categories}.`).join("\n")}

## Generated Files

- competitor-mention-environment.csv
- provider-category-mention-environment.csv
- ibolt-mention-context-ledger.csv
- competitor-replacement-context-ledger.csv
- page-countermove-queue.csv
- provider-fragility-ledger.csv
- replacement-cluster-density.csv
- outcome-mix.svg
- competitor-environment.svg
`;
}

async function main() {
  const benchmarkDir = process.argv[2] ? path.resolve(process.argv[2]) : await latestDir(BENCHMARK_PREFIX);
  const outDir = path.join(benchmarkDir, REPORT_DIR);
  await mkdir(outDir, { recursive: true });

  const answerEvidence = await readJsonIfExists(path.join(benchmarkDir, "answer-evidence-viewer", "answer-evidence-viewer-data.json"), { summary: {}, evidenceRows: [] });
  const coMention = await readJsonIfExists(path.join(benchmarkDir, "co-mention-network", "co-mention-network-data.json"), { summary: {}, competitorRows: [], providerCategoryRows: [], mentionRows: [] });
  const displacement = await readJsonIfExists(path.join(benchmarkDir, "competitor-displacement-map", "competitor-displacement-data.json"), { summary: {}, competitorRows: [], queryActions: [] });
  const blindspots = await readJsonIfExists(path.join(benchmarkDir, "provider-blindspots", "provider-blindspot-data.json"), { summary: {}, competitorRows: [] });
  const actionControl = await readJsonIfExists(path.join(benchmarkDir, "all-blog-action-control-sheet", "all-blog-action-control-data.json"), { summary: {}, first30: [] });
  const roleLedger = await readCsvIfExists(path.join(benchmarkDir, "entity-adjacency-report", "answer-role-ledger.csv"));
  const adjacencyRows = await readCsvIfExists(path.join(benchmarkDir, "entity-adjacency-report", "competitor-adjacency-matrix.csv"));
  const roleProviderRows = await readCsvIfExists(path.join(benchmarkDir, "entity-adjacency-report", "provider-category-role-matrix.csv"));

  const answerRows = answerEvidence.evidenceRows?.length ? answerEvidence.evidenceRows : roleLedger;
  const answers = answerRows.length || answerEvidence.summary.totalAnswers || coMention.summary.totalAnswers || 0;
  const cleanMentions = answerRows.filter((row) => outcomeKind(row) === "clean").length;
  const crowdedMentions = answerRows.filter((row) => outcomeKind(row) === "crowded" || outcomeKind(row) === "trailing").length;
  const replacements = answerRows.filter((row) => outcomeKind(row) === "replacement").length || answerEvidence.summary.competitorReplacements || coMention.summary.competitorOnlyRows || 0;
  const noSignal = answerRows.filter((row) => outcomeKind(row) === "no_signal").length || answerEvidence.summary.noSignal || 0;
  const mentions = cleanMentions + crowdedMentions;

  const competitorRows = buildCompetitorRows({
    answerRows,
    adjacencyRows,
    displacementRows: displacement.competitorRows || [],
    blindspotRows: blindspots.competitorRows || [],
  });
  const providerCategoryRows = buildProviderCategoryRows(roleProviderRows.length ? roleProviderRows : coMention.providerCategoryRows || []);
  const mentionRows = buildMentionContextRows(answerRows);
  const replacementRows = buildReplacementRows(answerRows);
  const pageRows = buildPageCountermoveRows(actionControl.first30 || [], displacement.queryActions || []);
  const fragilityRows = buildFragilityRows(answerRows);
  const clusterRows = buildReplacementClusterRows(replacementRows);
  const usefulCoMentions = mentionRows.filter((row) => normalizeBrands(row.competitors).length && (toNumber(row.top_pick_rank) <= 3 || hasEntitySpecificity(row))).length;
  const entitySpecificMentions = mentionRows.filter(hasEntitySpecificity).length;
  const completeEvidenceRows = answerRows.filter(evidenceComplete).length;
  const roleWeightedQualityScore = answers
    ? Math.round(((cleanMentions * 5 + crowdedMentions * 3 + noSignal) / (answers * 5)) * 100)
    : 0;
  const counterPositioningCoverage = replacementRows.length
    ? pct(replacementRows.filter((row) => row.next_action && row.page_url).length, replacementRows.length)
    : 0;

  const summary = {
    generated_at: new Date().toISOString(),
    benchmark_dir: benchmarkDir,
    answers,
    mentions,
    mention_rate: pct(mentions, answers),
    clean_mentions: cleanMentions,
    clean_mention_rate: pct(cleanMentions, answers),
    crowded_mentions: crowdedMentions,
    crowded_mention_share_of_mentions: pct(crowdedMentions, mentions),
    replacements,
    competitor_replacement_rate: pct(replacements, answers),
    no_signal: noSignal,
    no_signal_rate: pct(noSignal, answers),
    citation_rate: toNumber(answerEvidence.summary.citationRate || coMention.summary.citationRate || displacement.summary.citationRate || 0),
    role_weighted_quality_score: roleWeightedQualityScore,
    useful_co_mentions: usefulCoMentions,
    co_mention_usefulness_rate: pct(usefulCoMentions, crowdedMentions),
    entity_specific_mentions: entitySpecificMentions,
    entity_specificity_rate: pct(entitySpecificMentions, mentions),
    complete_evidence_rows: completeEvidenceRows,
    answer_evidence_confidence_rate: pct(completeEvidenceRows, answers),
    provider_fragility_queries: fragilityRows.length,
    replacement_cluster_count: clusterRows.length,
    counter_positioning_coverage: counterPositioningCoverage,
    competitors_tracked: competitorRows.length,
    provider_category_pockets: providerCategoryRows.length,
    top_competitor: competitorRows[0]?.competitor || "",
    top_competitor_replacements: competitorRows[0]?.replacements || 0,
    top_provider_category: providerCategoryRows[0] ? `${providerCategoryRows[0].provider} / ${providerCategoryRows[0].category}` : "",
    top_provider_category_replacement_rate: providerCategoryRows[0]?.replacement_rate || "",
    page_countermoves: pageRows.length,
    citation_outreach_candidates: actionControl.summary?.citationOutreachCandidates || 0,
  };

  await writeFile(path.join(outDir, "mention-environment-data.json"), JSON.stringify({
    summary,
    competitorRows,
    providerCategoryRows,
    mentionRows,
    replacementRows,
    pageRows,
    fragilityRows,
    clusterRows,
  }, null, 2));
  await writeFile(path.join(outDir, "environment-executive-metrics.csv"), csv([
    ["metric", "value", "note"],
    ["answers_analyzed", summary.answers, "Saved provider/prompt answer rows."],
    ["mention_rate", `${summary.mention_rate}%`, "All answers where iBOLT appears."],
    ["clean_mention_rate", `${summary.clean_mention_rate}%`, "Answers where iBOLT appears without competitor crowding."],
    ["competitor_replacement_rate", `${summary.competitor_replacement_rate}%`, "Answers where known competitors appear without iBOLT."],
    ["role_weighted_quality_score", summary.role_weighted_quality_score, "Weighted answer quality score out of 100."],
    ["co_mention_usefulness_rate", `${summary.co_mention_usefulness_rate}%`, "Crowded mentions with useful top-3, entity, or positioning support."],
    ["entity_specificity_rate", `${summary.entity_specificity_rate}%`, "iBOLT mentions with product/entity signals."],
    ["answer_evidence_confidence_rate", `${summary.answer_evidence_confidence_rate}%`, "Rows with identity, outcome, page, and snippet/file evidence."],
    ["provider_fragility_queries", summary.provider_fragility_queries, "Queries where providers disagree between iBOLT mention and competitor replacement."],
    ["replacement_cluster_count", summary.replacement_cluster_count, "Distinct competitor groups replacing iBOLT."],
    ["counter_positioning_coverage", `${summary.counter_positioning_coverage}%`, "Replacement rows with mapped page and next action."],
  ]));
  await writeFile(path.join(outDir, "competitor-mention-environment.csv"), csv([
    ["competitor", "threat_tier", "pressure_score", "replacements", "co_mentions", "trailing_mentions", "top3_with_ibolt", "provider_misses", "replacement_to_comention_ratio", "categories", "providers", "lost_queries", "co_mention_queries", "counter_angle"],
    ...competitorRows.map((row) => [row.competitor, row.threat_tier, row.pressure_score, row.replacements, row.co_mentions, row.trailing_mentions, row.top3_with_ibolt, row.provider_misses, row.replacement_to_comention_ratio, row.categories, row.providers, row.lost_queries, row.co_mention_queries, row.counter_angle]),
  ]));
  await writeFile(path.join(outDir, "provider-category-mention-environment.csv"), csv([
    ["provider", "category", "answers", "clean_ibolt", "ibolt_leads_with_competitors", "ibolt_co_mentioned", "ibolt_trailing", "competitor_replacements", "no_signal", "mention_rate", "replacement_rate", "pressure_score", "top_competitors", "action"],
    ...providerCategoryRows.map((row) => [row.provider, row.category, row.answers, row.clean_ibolt, row.ibolt_leads_with_competitors, row.ibolt_co_mentioned, row.ibolt_trailing, row.competitor_replacements, row.no_signal, row.mention_rate, row.replacement_rate, row.pressure_score, row.top_competitors, row.action]),
  ]));
  await writeFile(path.join(outDir, "ibolt-mention-context-ledger.csv"), csv([
    ["provider", "query", "category", "role", "coverage_score", "top_pick_rank", "competitors", "products", "positioning", "snippet", "read"],
    ...mentionRows.map((row) => [row.provider, row.query, row.category, row.role, row.coverage_score, row.top_pick_rank, row.competitors, row.products, row.positioning, row.snippet, row.read]),
  ]));
  await writeFile(path.join(outDir, "competitor-replacement-context-ledger.csv"), csv([
    ["priority", "provider", "query", "category", "coverage_score", "competitors", "page_title", "page_url", "snippet", "next_action"],
    ...replacementRows.map((row) => [row.priority, row.provider, row.query, row.category, row.coverage_score, row.competitors, row.page_title, row.page_url, row.snippet, row.next_action]),
  ]));
  await writeFile(path.join(outDir, "page-countermove-queue.csv"), csv([
    ["priority", "page_title", "page_url", "category", "sprint", "competitors", "losing_queries", "pressure", "countermove", "release_gate", "source"],
    ...pageRows.map((row) => [row.priority, row.page_title, row.page_url, row.category, row.sprint, row.competitors, row.losing_queries, row.pressure, row.countermove, row.release_gate, row.source]),
  ]));
  await writeFile(path.join(outDir, "provider-fragility-ledger.csv"), csv([
    ["query", "category", "mention_providers", "replacement_providers", "no_signal_providers", "providers", "competitors", "fragility_score", "action"],
    ...fragilityRows.map((row) => [row.query, row.category, row.mention_providers, row.replacement_providers, row.no_signal_providers, row.providers, row.competitors, row.fragility_score, row.action]),
  ]));
  await writeFile(path.join(outDir, "replacement-cluster-density.csv"), csv([
    ["competitor_cluster", "answers", "categories", "providers", "example_queries", "action"],
    ...clusterRows.map((row) => [row.competitor_cluster, row.answers, row.categories, row.providers, row.example_queries, row.action]),
  ]));

  const outcomeRows = [
    { label: "Competitor replacements", value: summary.replacements, color: "#ef4444" },
    { label: "Crowded iBOLT mentions", value: summary.crowded_mentions, color: "#2563eb" },
    { label: "Clean iBOLT mentions", value: summary.clean_mentions, color: "#0f766e" },
    { label: "No useful signal", value: summary.no_signal, color: "#64748b" },
  ];
  await writeFile(path.join(outDir, "outcome-mix.svg"), barSvg({
    title: "Answer Outcome Mix",
    subtitle: "Where iBOLT wins cleanly, appears beside competitors, or gets replaced.",
    rows: outcomeRows,
  }));
  await writeFile(path.join(outDir, "competitor-environment.svg"), stackedCompetitorSvg(competitorRows));
  await writeFile(path.join(outDir, "REPORT.html"), renderHtml({ summary, competitorRows, providerCategoryRows, mentionRows, replacementRows, pageRows, fragilityRows, clusterRows }));
  await writeFile(path.join(outDir, "REPORT.md"), renderMarkdown({ summary, competitorRows, providerCategoryRows, pageRows, fragilityRows, clusterRows }));

  console.log(`Wrote ${outDir}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
