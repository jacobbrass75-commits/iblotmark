import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const SHOPIFY_SHOP = (process.env.SHOPIFY_SHOP || "iboltmounts").replace(/\.myshopify\.com$/i, "");
const SHOPIFY_TOKEN =
  process.env.SHOPIFY_ACCESS_TOKEN ||
  process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const STORE_ORIGIN = process.env.IBOLT_STORE_ORIGIN || "https://iboltmounts.com";

const APPLY = process.argv.includes("--apply");
const INCLUDE_PAGES = !process.argv.includes("--articles-only");

if (!SHOPIFY_TOKEN) {
  throw new Error("SHOPIFY_ACCESS_TOKEN or SHOPIFY_ADMIN_API_ACCESS_TOKEN is required.");
}

const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join("content-output", "remove-ai-search-sections", runStamp);
fs.mkdirSync(outputDir, { recursive: true });

const SECTION_HEADINGS = [
  "What AI Search Systems Need To Understand",
  "Why This Page Is Built For AI Search",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shopifyAdminUrl(endpoint) {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return `https://${SHOPIFY_SHOP}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/${endpoint}`;
}

async function shopifyFetch(method, endpoint, body) {
  const response = await fetch(shopifyAdminUrl(endpoint), {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_TOKEN,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Shopify ${method} ${endpoint} failed: ${response.status} ${text.slice(0, 800)}`);
  }

  return {
    data: text ? JSON.parse(text) : {},
    link: response.headers.get("link") || "",
  };
}

function nextPageUrl(linkHeader) {
  if (!linkHeader) return null;
  const match = linkHeader
    .split(",")
    .map((part) => part.trim())
    .find((part) => /rel="next"/.test(part))
    ?.match(/<([^>]+)>/);
  return match?.[1] || null;
}

async function paginate(endpoint, key) {
  const rows = [];
  let next = endpoint;
  while (next) {
    const { data, link } = await shopifyFetch("GET", next);
    rows.push(...(data[key] || []));
    next = nextPageUrl(link);
    await sleep(150);
  }
  return rows;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function headingPattern(heading) {
  const flexibleHeading = escapeRegExp(heading).replaceAll("\\ ", "\\s+");
  return new RegExp(
    String.raw`\s*<h2\b[^>]*>\s*${flexibleHeading}\s*<\/h2>\s*[\s\S]*?(?=\s*<h2\b|$)`,
    "gi",
  );
}

function stripSections(html) {
  let next = String(html || "");
  const removed = [];

  for (const heading of SECTION_HEADINGS) {
    const pattern = headingPattern(heading);
    next = next.replace(pattern, (match) => {
      removed.push({
        heading,
        characters: match.length,
        preview: match.replace(/\s+/g, " ").trim().slice(0, 220),
      });
      return "\n";
    });
  }

  return {
    html: next.replace(/\n{3,}/g, "\n\n").trim(),
    removed,
  };
}

function hasTargetSection(html) {
  return SECTION_HEADINGS.some((heading) => headingPattern(heading).test(String(html || "")));
}

function safeName(item) {
  return String(item.title || item.handle || item.id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function listTargets() {
  const blogs = await paginate("blogs.json?limit=250", "blogs");
  const targets = [];

  for (const blog of blogs) {
    const articles = await paginate(
      `blogs/${blog.id}/articles.json?limit=250&fields=id,title,handle,body_html,published_at,updated_at,author`,
      "articles",
    );
    for (const article of articles) {
      if (!hasTargetSection(article.body_html)) continue;
      targets.push({
        type: "article",
        blog,
        item: article,
        publicUrl: `${STORE_ORIGIN}/blogs/${blog.handle}/${article.handle}`,
      });
    }
  }

  if (INCLUDE_PAGES) {
    const pages = await paginate("pages.json?limit=250&fields=id,title,handle,body_html,published_at,updated_at,author", "pages");
    for (const page of pages) {
      if (!hasTargetSection(page.body_html)) continue;
      targets.push({
        type: "page",
        item: page,
        publicUrl: `${STORE_ORIGIN}/pages/${page.handle}`,
      });
    }
  }

  return targets;
}

async function updateTarget(target, cleanedHtml) {
  if (target.type === "article") {
    const article = target.item;
    return shopifyFetch("PUT", `blogs/${target.blog.id}/articles/${article.id}.json`, {
      article: {
        id: article.id,
        title: article.title,
        handle: article.handle,
        author: article.author,
        body_html: cleanedHtml,
        published_at: article.published_at,
      },
    });
  }

  const page = target.item;
  return shopifyFetch("PUT", `pages/${page.id}.json`, {
    page: {
      id: page.id,
      title: page.title,
      handle: page.handle,
      author: page.author,
      body_html: cleanedHtml,
      published_at: page.published_at,
    },
  });
}

const targets = await listTargets();
const results = [];

for (const target of targets) {
  const item = target.item;
  const { html, removed } = stripSections(item.body_html);
  const basename = `${target.type}-${item.id}-${safeName(item)}`;

  fs.writeFileSync(path.join(outputDir, `${basename}.before.html`), item.body_html || "");
  fs.writeFileSync(path.join(outputDir, `${basename}.after.html`), html);

  const result = {
    type: target.type,
    id: item.id,
    blogId: target.blog?.id || null,
    title: item.title,
    handle: item.handle,
    publicUrl: target.publicUrl,
    removed,
    beforeLength: String(item.body_html || "").length,
    afterLength: html.length,
    updated: false,
  };

  if (APPLY && removed.length > 0) {
    const update = await updateTarget(target, html);
    result.updated = true;
    result.shopifyUpdatedAt = update.data.article?.updated_at || update.data.page?.updated_at || null;
    await sleep(250);
  }

  results.push(result);
}

const remaining = await listTargets();
const summary = {
  mode: APPLY ? "apply" : "dry-run",
  outputDir,
  checkedAt: new Date().toISOString(),
  matchedBefore: targets.length,
  updated: results.filter((result) => result.updated).length,
  matchedAfter: remaining.length,
  results,
  remaining: remaining.map((target) => ({
    type: target.type,
    id: target.item.id,
    title: target.item.title,
    publicUrl: target.publicUrl,
  })),
};

fs.writeFileSync(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
