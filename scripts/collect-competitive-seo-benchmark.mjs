import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import Papa from "papaparse";

const CAPTURED_AT = new Date().toISOString();
const OUTPUT_DIR = path.resolve(
  process.argv[2] || `research/competitive-seo-benchmark/${CAPTURED_AT.slice(0, 10)}`,
);
const SAMPLE_SIZE = 25;
const SITES = [
  { brand: "iBOLT", domain: "iboltmounts.com", baseUrl: "https://iboltmounts.com" },
  { brand: "RAM Mounts", domain: "rammount.com", baseUrl: "https://rammount.com" },
  { brand: "Arkon Mounts", domain: "arkon.com", baseUrl: "https://arkon.com" },
];

function decodeXml(value = "") {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function decodeHtml(value = "") {
  return decodeXml(value)
    .replaceAll("&nbsp;", " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mean(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function csv(rows) {
  return `${Papa.unparse(rows, { quotes: true, newline: "\n" })}\n`;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function collectAiHistory() {
  const contentRoot = path.resolve("content-output");
  const directories = (await readdir(contentRoot, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isDirectory() &&
        /^(?:ai-benchmark|openrouter-ai-benchmark|openrouter-expanded-ai-benchmark)-\d{4}-\d{2}-\d{2}/.test(
          entry.name,
        ),
    )
    .map((entry) => entry.name)
    .sort();
  const resultRows = [];
  const officialSummaries = [];
  for (const directory of directories) {
    const resultsPath = path.join(contentRoot, directory, "results.csv");
    const summaryPath = path.join(contentRoot, directory, "summary.json");
    const runDate = directory.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || "";
    const cohort = directory.startsWith("openrouter-expanded")
      ? "expanded"
      : directory.startsWith("openrouter-ai")
        ? "openrouter_baseline"
        : "app_baseline";
    try {
      const parsedSummary = JSON.parse(await readFile(summaryPath, "utf8"));
      const current = parsedSummary.current || parsedSummary.summary || {};
      const run = current.run || {};
      for (const provider of current.providerSummaries || run.summary?.providerSummaries || []) {
        officialSummaries.push({
          run_date: runDate,
          run_directory: directory,
          cohort,
          provider: provider.provider || "",
          result_count: toNumber(run.resultCount),
          completed_count: toNumber(provider.completedCount),
          distinct_query_count: toNumber(provider.queriesEvaluated),
          avg_coverage_score: toNumber(provider.avgScore),
          ibolt_mention_rate_pct: toNumber(provider.mentionRate),
          iboltmounts_citation_rate_pct: toNumber(provider.citationRate),
          ibolt_top_three_rate_pct: toNumber(provider.topThreeRate),
          source_file: summaryPath,
        });
      }
    } catch {
      // Ignore dry runs without a completed summary.
    }
    try {
      const parsed = Papa.parse(await readFile(resultsPath, "utf8"), {
        header: true,
        skipEmptyLines: true,
      });
      if (!parsed.meta.fields?.includes("provider")) continue;
      for (const row of parsed.data) {
        const evidence = `${row.competitors || ""};${row.analysis_notes || ""};${row.raw_response_excerpt || ""}`;
        resultRows.push({
          run_date: runDate,
          run_directory: directory,
          cohort,
          provider: row.provider || "",
          model: row.model || "",
          query: row.query || "",
          category: row.category || "",
          status: row.status || "",
          coverage_score: toNumber(row.coverage_score),
          ibolt_mentioned: /^(?:true|1)$/i.test(row.brand_mentioned || ""),
          iboltmounts_domain_cited: /^(?:true|1)$/i.test(row.domain_cited || ""),
          top_pick_rank: toNumber(row.top_pick_rank),
          ram_mentioned: /\bRAM(?:\s+Mounts?)?\b/i.test(evidence),
          arkon_mentioned: /\bArkon\b/i.test(evidence),
          competitors_detected: row.competitors || "",
          source_file: resultsPath,
        });
      }
    } catch {
      // Dry runs and the older app benchmark may not have a results.csv.
    }
  }
  const grouped = new Map();
  for (const row of resultRows) {
    const key = [row.run_date, row.run_directory, row.cohort, row.provider, row.model].join("\u0000");
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  const calculatedSummaries = [...grouped.values()].map((rows) => {
    const completed = rows.filter((row) => row.status === "completed");
    return {
      run_date: rows[0].run_date,
      run_directory: rows[0].run_directory,
      cohort: rows[0].cohort,
      provider: rows[0].provider,
      model: rows[0].model,
      result_count: rows.length,
      completed_count: completed.length,
      distinct_query_count: new Set(completed.map((row) => row.query)).size,
      avg_coverage_score: Math.round(mean(completed.map((row) => row.coverage_score)) || 0),
      ibolt_mention_rate_pct: Math.round(100 * mean(completed.map((row) => Number(row.ibolt_mentioned))) || 0),
      iboltmounts_citation_rate_pct: Math.round(
        100 * mean(completed.map((row) => Number(row.iboltmounts_domain_cited))) || 0,
      ),
      ibolt_top_three_rate_pct: Math.round(
        100 *
          mean(
            completed.map((row) =>
              Number(row.ibolt_mentioned && row.top_pick_rank !== null && row.top_pick_rank <= 3),
            ),
          ) || 0,
      ),
      ram_mention_rate_pct: Math.round(100 * mean(completed.map((row) => Number(row.ram_mentioned))) || 0),
      arkon_mention_rate_pct: Math.round(100 * mean(completed.map((row) => Number(row.arkon_mentioned))) || 0),
      source_file: rows[0].source_file,
      comparability_note:
        rows[0].cohort === "expanded"
          ? "Compare only when prompt cohort/query set matches; expanded runs changed query mix."
          : "Baseline cohort; provider and scoring definitions must also match.",
    };
  });
  const summaryRows = officialSummaries.map((official) => {
    const calculated = calculatedSummaries.find(
      (row) => row.run_directory === official.run_directory && row.provider === official.provider,
    );
    return {
      ...official,
      model: calculated?.model || "",
      ram_mention_rate_pct: calculated?.ram_mention_rate_pct ?? "",
      arkon_mention_rate_pct: calculated?.arkon_mention_rate_pct ?? "",
      query_result_source_file: calculated?.source_file || "",
      comparability_note:
        official.cohort === "expanded"
          ? "Compare only when prompt cohort/query set matches; expanded runs changed query mix."
          : "Baseline cohort; provider and scoring definitions must also match.",
    };
  });
  return { summaryRows, resultRows };
}

async function fetchText(url, options = {}) {
  const started = performance.now();
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "iBolt-competitive-benchmark/1.0 (+https://iboltmounts.com)",
      accept: options.accept || "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(options.timeoutMs || 45_000),
  });
  const text = await response.text();
  return {
    requestedUrl: url,
    finalUrl: response.url,
    status: response.status,
    ok: response.ok,
    elapsedMs: Math.round(performance.now() - started),
    bytes: Buffer.byteLength(text),
    contentType: response.headers.get("content-type") || "",
    text,
  };
}

function extractLocEntries(xml) {
  return [...xml.matchAll(/<url>\s*([\s\S]*?)<\/url>/gi)].map((match) => {
    const block = match[1];
    return {
      url: decodeXml(block.match(/<loc>([\s\S]*?)<\/loc>/i)?.[1]?.trim() || ""),
      lastmod: block.match(/<lastmod>([\s\S]*?)<\/lastmod>/i)?.[1]?.trim() || null,
      imageCount: [...block.matchAll(/<image:image>/gi)].length,
    };
  });
}

function extractSitemapUrls(xml) {
  return [...xml.matchAll(/<sitemap>\s*([\s\S]*?)<\/sitemap>/gi)]
    .map((match) => decodeXml(match[1].match(/<loc>([\s\S]*?)<\/loc>/i)?.[1]?.trim() || ""))
    .filter(Boolean);
}

function pageType(url) {
  if (url.includes("/products/")) return "product";
  if (url.includes("/collections/")) return "collection";
  if (url.includes("/blogs/")) return "blog";
  if (url.includes("/pages/")) return "page";
  if (url.includes("agentic_discovery")) return "agentic_discovery";
  return "other";
}

function attr(tag, name) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] || "";
}

function cleanText(html) {
  return decodeHtml(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(html, matcher) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const key = attr(tag, "name") || attr(tag, "property");
    if (matcher.test(key)) return decodeHtml(attr(tag, "content"));
  }
  return "";
}

function analyzeHtml(url, response) {
  const html = response.text;
  const title = decodeHtml(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || "");
  const metaDescription = metaContent(html, /^description$/i);
  const h1 = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((match) => cleanText(match[1]));
  const canonicalTag = [...html.matchAll(/<link\b[^>]*>/gi)].find((match) => /\brel=["'][^"']*canonical/i.test(match[0]))?.[0] || "";
  const canonical = decodeHtml(attr(canonicalTag, "href"));
  const jsonLd = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1]);
  const schemaTypes = [...new Set(
    jsonLd.flatMap((block) => [...block.matchAll(/"@type"\s*:\s*"([^"]+)"/gi)].map((match) => match[1])),
  )].sort();
  const imageTags = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
  const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].map((match) => decodeHtml(match[1]));
  const host = new URL(url).hostname.replace(/^www\./, "");
  const internalLinks = links.filter((href) => {
    if (href.startsWith("/") || href.startsWith("#")) return true;
    try {
      return new URL(href, url).hostname.replace(/^www\./, "") === host;
    } catch {
      return false;
    }
  });
  const mainMatch = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const text = cleanText(mainMatch?.[1] || html);
  const words = text.match(/\b[\p{L}\p{N}][\p{L}\p{N}'’.-]*\b/gu) || [];
  const visibleDate = text.match(/\b(?:Last Updated|Updated|Published)(?:\s*(?:on|:))?\s+([A-Z][a-z]+\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})/i)?.[1] || null;
  return {
    url,
    finalUrl: response.finalUrl,
    status: response.status,
    elapsedMs: response.elapsedMs,
    bytes: response.bytes,
    title,
    titleLength: title.length,
    metaDescription,
    metaDescriptionLength: metaDescription.length,
    canonical,
    h1Count: h1.length,
    h1: h1.join(" | "),
    wordCount: words.length,
    schemaTypes: schemaTypes.join(";"),
    hasArticleSchema: schemaTypes.some((type) => /Article/i.test(type)),
    hasFaqSchema: schemaTypes.some((type) => /FAQPage/i.test(type)),
    hasBreadcrumbSchema: schemaTypes.some((type) => /BreadcrumbList/i.test(type)),
    hasProductSchema: schemaTypes.some((type) => /Product/i.test(type)),
    imageCount: imageTags.length,
    imagesWithAlt: imageTags.filter((tag) => attr(tag, "alt").trim()).length,
    internalLinkCount: internalLinks.length,
    externalLinkCount: links.length - internalLinks.length,
    visibleDate,
  };
}

async function collectSite(site) {
  let rdap = null;
  try {
    const result = await fetchText(`https://rdap.verisign.com/com/v1/domain/${site.domain}`, {
      accept: "application/rdap+json,application/json",
    });
    const parsed = JSON.parse(result.text);
    const registrationDate =
      parsed.events?.find((event) => event.eventAction === "registration")?.eventDate || null;
    const expirationDate =
      parsed.events?.find((event) => event.eventAction === "expiration")?.eventDate || null;
    rdap = {
      sourceUrl: result.finalUrl,
      status: result.status,
      registrationDate,
      expirationDate,
      domainAgeYears: registrationDate
        ? Math.round(((Date.parse(CAPTURED_AT) - Date.parse(registrationDate)) / (365.25 * 86_400_000)) * 10) / 10
        : null,
      nameserverCount: parsed.nameservers?.length || 0,
    };
  } catch (error) {
    rdap = { status: 0, error: String(error) };
  }
  const rootSitemap = await fetchText(`${site.baseUrl}/sitemap.xml`, { accept: "application/xml,text/xml" });
  const childUrls = extractSitemapUrls(rootSitemap.text);
  const childResults = [];
  for (const sitemapUrl of childUrls) {
    const result = await fetchText(sitemapUrl, { accept: "application/xml,text/xml", timeoutMs: 90_000 });
    childResults.push({
      url: sitemapUrl,
      status: result.status,
      elapsedMs: result.elapsedMs,
      bytes: result.bytes,
      entries: extractLocEntries(result.text),
    });
  }
  const allEntries = childResults.flatMap((result) => result.entries);
  const blogEntries = allEntries
    .filter((entry) => pageType(entry.url) === "blog")
    .sort((a, b) => String(b.lastmod || "").localeCompare(String(a.lastmod || "")));
  const sampleEntries = blogEntries.slice(0, SAMPLE_SIZE);
  const samplePages = [];
  for (const entry of sampleEntries) {
    try {
      samplePages.push({ ...entry, ...analyzeHtml(entry.url, await fetchText(entry.url)) });
    } catch (error) {
      samplePages.push({ ...entry, status: 0, error: String(error) });
    }
  }
  const homepage = analyzeHtml(site.baseUrl, await fetchText(site.baseUrl));
  const discoveryChecks = [];
  for (const pathname of ["/robots.txt", "/agents.md", "/llms.txt", "/.well-known/ucp"]) {
    try {
      const result = await fetchText(`${site.baseUrl}${pathname}`, { accept: "*/*" });
      discoveryChecks.push({
        pathname,
        status: result.status,
        finalUrl: result.finalUrl,
        bytes: result.bytes,
        elapsedMs: result.elapsedMs,
        mentionsSitemap: /sitemap/i.test(result.text),
        mentionsAgent: /agent|ucp|mcp/i.test(result.text),
      });
    } catch (error) {
      discoveryChecks.push({ pathname, status: 0, error: String(error) });
    }
  }
  const validDates = allEntries.map((entry) => Date.parse(entry.lastmod || "")).filter(Number.isFinite);
  const now = Date.parse(CAPTURED_AT);
  const counts = Object.fromEntries(
    ["product", "collection", "page", "blog", "agentic_discovery", "other"].map((type) => [
      type,
      allEntries.filter((entry) => pageType(entry.url) === type).length,
    ]),
  );
  const validSample = samplePages.filter((page) => page.status === 200);
  return {
    ...site,
    capturedAt: CAPTURED_AT,
    rdap,
    rootSitemap: {
      status: rootSitemap.status,
      finalUrl: rootSitemap.finalUrl,
      elapsedMs: rootSitemap.elapsedMs,
      bytes: rootSitemap.bytes,
      childSitemapCount: childUrls.length,
    },
    childSitemaps: childResults.map(({ entries, ...result }) => ({ ...result, urlCount: entries.length })),
    sitemap: {
      totalUrls: allEntries.length,
      counts,
      urlsModifiedLast30Days: validDates.filter((date) => now - date <= 30 * 86_400_000).length,
      urlsModifiedLast90Days: validDates.filter((date) => now - date <= 90 * 86_400_000).length,
      latestLastmod: validDates.length ? new Date(Math.max(...validDates)).toISOString() : null,
    },
    homepage,
    discoveryChecks,
    blogSample: samplePages,
    blogSampleSummary: {
      requested: SAMPLE_SIZE,
      successful: validSample.length,
      medianWordCount: median(validSample.map((page) => page.wordCount)),
      meanWordCount: Math.round(mean(validSample.map((page) => page.wordCount)) || 0),
      medianTitleLength: median(validSample.map((page) => page.titleLength)),
      medianMetaDescriptionLength: median(validSample.map((page) => page.metaDescriptionLength)),
      articleSchemaRate: Math.round(100 * mean(validSample.map((page) => Number(page.hasArticleSchema))) || 0),
      faqSchemaRate: Math.round(100 * mean(validSample.map((page) => Number(page.hasFaqSchema))) || 0),
      breadcrumbSchemaRate: Math.round(100 * mean(validSample.map((page) => Number(page.hasBreadcrumbSchema))) || 0),
      canonicalRate: Math.round(100 * mean(validSample.map((page) => Number(Boolean(page.canonical)))) || 0),
      singleH1Rate: Math.round(100 * mean(validSample.map((page) => Number(page.h1Count === 1))) || 0),
      imageAltCoverageRate: Math.round(
        100 *
          (validSample.reduce((sum, page) => sum + page.imagesWithAlt, 0) /
            Math.max(1, validSample.reduce((sum, page) => sum + page.imageCount, 0))),
      ),
      meanInternalLinks: Math.round(mean(validSample.map((page) => page.internalLinkCount)) || 0),
      meanExternalLinks: Math.round(mean(validSample.map((page) => page.externalLinkCount)) || 0),
      medianResponseMs: median(validSample.map((page) => page.elapsedMs)),
    },
  };
}

await mkdir(OUTPUT_DIR, { recursive: true });
const siteResults = [];
for (const site of SITES) {
  console.log(`Collecting ${site.brand}...`);
  siteResults.push(await collectSite(site));
}
const aiHistory = await collectAiHistory();

const historicalLedgerPath = path.resolve(
  "content-output/openrouter-ai-benchmark-2026-06-17-17-11-06/benchmark-history/completed-benchmark-ledger.csv",
);
let historicalAiBenchmarks = [];
try {
  const parsed = Papa.parse(await readFile(historicalLedgerPath, "utf8"), { header: true, skipEmptyLines: true });
  historicalAiBenchmarks = parsed.data;
} catch {
  historicalAiBenchmarks = [];
}

const summaryRows = siteResults.map((site) => ({
  captured_at: site.capturedAt,
  brand: site.brand,
  domain: site.domain,
  domain_registration_date: site.rdap?.registrationDate || "",
  domain_age_years: site.rdap?.domainAgeYears ?? "",
  sitemap_total_urls: site.sitemap.totalUrls,
  sitemap_product_urls: site.sitemap.counts.product,
  sitemap_collection_urls: site.sitemap.counts.collection,
  sitemap_page_urls: site.sitemap.counts.page,
  sitemap_blog_urls: site.sitemap.counts.blog,
  urls_modified_last_30_days: site.sitemap.urlsModifiedLast30Days,
  urls_modified_last_90_days: site.sitemap.urlsModifiedLast90Days,
  latest_lastmod: site.sitemap.latestLastmod,
  blog_sample_size: site.blogSampleSummary.successful,
  blog_median_word_count: site.blogSampleSummary.medianWordCount,
  blog_mean_word_count: site.blogSampleSummary.meanWordCount,
  article_schema_rate_pct: site.blogSampleSummary.articleSchemaRate,
  faq_schema_rate_pct: site.blogSampleSummary.faqSchemaRate,
  breadcrumb_schema_rate_pct: site.blogSampleSummary.breadcrumbSchemaRate,
  canonical_rate_pct: site.blogSampleSummary.canonicalRate,
  single_h1_rate_pct: site.blogSampleSummary.singleH1Rate,
  image_alt_coverage_rate_pct: site.blogSampleSummary.imageAltCoverageRate,
  mean_internal_links: site.blogSampleSummary.meanInternalLinks,
  mean_external_links: site.blogSampleSummary.meanExternalLinks,
  blog_median_response_ms: site.blogSampleSummary.medianResponseMs,
  homepage_status: site.homepage.status,
  homepage_title_length: site.homepage.titleLength,
  homepage_meta_description_length: site.homepage.metaDescriptionLength,
  homepage_h1_count: site.homepage.h1Count,
  homepage_schema_types: site.homepage.schemaTypes,
  robots_status: site.discoveryChecks.find((item) => item.pathname === "/robots.txt")?.status || 0,
  agents_md_status: site.discoveryChecks.find((item) => item.pathname === "/agents.md")?.status || 0,
  llms_txt_status: site.discoveryChecks.find((item) => item.pathname === "/llms.txt")?.status || 0,
  ucp_status: site.discoveryChecks.find((item) => item.pathname === "/.well-known/ucp")?.status || 0,
}));

const pageRows = siteResults.flatMap((site) =>
  site.blogSample.map((page) => ({
    captured_at: site.capturedAt,
    brand: site.brand,
    domain: site.domain,
    sitemap_lastmod: page.lastmod,
    ...page,
  })),
);

const output = {
  schemaVersion: 1,
  capturedAt: CAPTURED_AT,
  method: {
    description:
      "First-party technical/content benchmark using each Shopify domain's public sitemap, homepage, discovery files, and the 25 most recently modified sitemap blog URLs.",
    sampleSizePerDomain: SAMPLE_SIZE,
    userAgent: "iBolt-competitive-benchmark/1.0 (+https://iboltmounts.com)",
    wordCount:
      "Unicode token count from visible text inside <main> where present, otherwise visible page text; scripts, styles, noscript, SVG, and tags removed.",
    limitations: [
      "Sitemap counts are published/crawlable URL inventory, not search-engine index counts.",
      "Response time is a single full-response fetch from the runner location and is not Core Web Vitals.",
      "Recent-lastmod metrics reflect sitemap lastmod values and may include template or metadata updates.",
      "No backlink/domain-authority or keyword-volume API was available.",
      "No current model API key was available; historical AI benchmark runs are preserved but not rerun here.",
    ],
  },
  historicalAiBenchmarkLedgerSource: historicalLedgerPath,
  historicalAiBenchmarks,
  aiHistorySummary: aiHistory.summaryRows,
  summaryRows,
  sites: siteResults,
};

await Promise.all([
  writeFile(path.join(OUTPUT_DIR, "competitive-seo-benchmark.json"), `${JSON.stringify(output, null, 2)}\n`),
  writeFile(path.join(OUTPUT_DIR, "site-summary.csv"), csv(summaryRows)),
  writeFile(path.join(OUTPUT_DIR, "blog-page-sample.csv"), csv(pageRows)),
  writeFile(path.join(OUTPUT_DIR, "historical-ai-benchmark-ledger.csv"), csv(historicalAiBenchmarks)),
  writeFile(path.join(OUTPUT_DIR, "ai-benchmark-history-long.csv"), csv(aiHistory.summaryRows)),
  writeFile(path.join(OUTPUT_DIR, "ai-benchmark-query-results.csv"), csv(aiHistory.resultRows)),
]);
console.log(`Wrote benchmark data to ${OUTPUT_DIR}`);
