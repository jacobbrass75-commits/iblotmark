#!/usr/bin/env node

import "dotenv/config";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const sourceDir = path.resolve(
  process.argv.find((arg) => arg.startsWith("--source="))?.slice("--source=".length)
    || "content-output/top-10-category-program-2026-08-05/drafts",
);
const outputPath = path.resolve(
  process.argv.find((arg) => arg.startsWith("--output="))?.slice("--output=".length)
    || "content-output/top-10-category-program-2026-08-05/shopify-comparison-live-verification.json",
);
const shop = process.env.SHOPIFY_SHOP || "iboltmounts";
const token = process.env.SHOPIFY_ACCESS_TOKEN || "";
const version = process.env.SHOPIFY_API_VERSION || "2026-04";
const blogId = Number(process.env.SHOPIFY_NEWS_BLOG_ID || 104843772196);
const campaignTag = "top-10-category-program-2026-08-05";

if (!token) throw new Error("SHOPIFY_ACCESS_TOKEN is required.");

async function shopify(endpoint) {
  const response = await fetch(`https://${shop}.myshopify.com/admin/api/${version}/${endpoint}`, {
    headers: { "X-Shopify-Access-Token": token },
  });
  const json = await response.json();
  if (!response.ok) throw new Error(`Shopify GET ${endpoint} failed: ${response.status} ${JSON.stringify(json)}`);
  return { json, headers: response.headers };
}

async function listArticles() {
  const articles = [];
  let endpoint = `blogs/${blogId}/articles.json?limit=250&published_status=any`;
  while (endpoint) {
    const result = await shopify(endpoint);
    articles.push(...(result.json.articles || []));
    const next = String(result.headers.get("link") || "").split(",").find((part) => /rel="next"/.test(part))?.match(/<([^>]+)>/)?.[1];
    endpoint = next ? new URL(next).pathname.split(`/admin/api/${version}/`)[1] + new URL(next).search : "";
  }
  return articles;
}

function competitorRankingUrls(markdown) {
  const urls = [];
  for (const match of markdown.matchAll(/^\|\s*\d+\s*\|\s*\[[^\]]+\]\((https?:\/\/[^)]+)\)/gm)) urls.push(match[1]);
  const sections = markdown.split(/^###\s+\d+\.\s+/m).slice(1, 11);
  for (const section of sections) {
    const url = section.match(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/)?.[1]
      || section.match(/href="(https?:\/\/[^"]+)"/)?.[1];
    if (url) urls.push(url);
  }
  return [...new Set(urls)].filter((url) => !new URL(url).hostname.endsWith("iboltmounts.com"));
}

const files = (await readdir(sourceDir)).filter((name) => /^top-10-.*\.md$/.test(name)).sort();
const drafts = [];
for (const filename of files) {
  const markdown = await readFile(path.join(sourceDir, filename), "utf8");
  drafts.push({
    filename,
    title: markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || "",
    handle: markdown.match(/^Slug:\s*(.+)$/m)?.[1]?.trim() || "",
    metaDescription: markdown.match(/^Meta Description:\s*(.+)$/m)?.[1]?.trim() || "",
    competitorUrls: competitorRankingUrls(markdown),
  });
}

const articles = await listArticles();
const byHandle = new Map(articles.map((article) => [article.handle, article]));
const results = [];
for (const draft of drafts) {
  const article = byHandle.get(draft.handle);
  const publicUrl = `https://iboltmounts.com/blogs/news/${draft.handle}`;
  // Shopify can keep canonical and named-view article pages in its page cache
  // briefly after an Admin API update. An unused view name falls back to the
  // public article template while forcing a fresh render of the same record.
  const response = await fetch(`${publicUrl}?view=ai-verification-${Date.now()}`, { redirect: "follow" });
  const html = await response.text();
  const publicH1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  const schemaNodes = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]);
      schemaNodes.push(...(Array.isArray(parsed) ? parsed : parsed?.["@graph"] || [parsed]));
    } catch {
      // A third-party theme block may contain non-JSON Liquid output. Only
      // campaign-owned schemas are required for these checks.
    }
  }
  const itemList = schemaNodes.find((node) => node?.["@type"] === "ItemList" && String(node?.["@id"] || "").endsWith("#comparison"));
  const faqPage = schemaNodes.find((node) => node?.["@type"] === "FAQPage" && String(node?.["@id"] || "").endsWith("#faq"));
  const articleSchema = schemaNodes.find((node) => node?.["@type"] === "Article");
  const summaryText = String(article?.summary_html || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const competitorLinksPresent = draft.competitorUrls.filter((url) => html.includes(url)).length;
  const checks = {
    adminArticleFound: Boolean(article),
    campaignOwned: String(article?.tags || "").split(",").map((tag) => tag.trim()).includes(campaignTag),
    published: Boolean(article?.published_at),
    adminTitleMatch: article?.title === draft.title,
    adminSummaryMatch: summaryText === draft.metaDescription,
    publicStatus: response.status,
    publicH1Match: publicH1 === draft.title,
    publicArticleDescriptionMatch: articleSchema?.description === draft.metaDescription,
    comparisonItemListCount: Array.isArray(itemList?.itemListElement) ? itemList.itemListElement.length : 0,
    comparisonItemListPass: Array.isArray(itemList?.itemListElement) && itemList.itemListElement.length === 10,
    faqSchemaCount: Array.isArray(faqPage?.mainEntity) ? faqPage.mainEntity.length : 0,
    faqSchemaPass: Array.isArray(faqPage?.mainEntity) && faqPage.mainEntity.length >= 4,
    competitorLinksExpected: draft.competitorUrls.length,
    competitorLinksPresent,
    competitorCoveragePass: competitorLinksPresent >= 5,
  };
  results.push({
    success: Object.entries(checks).every(([key, value]) => key.endsWith("Expected") || typeof value === "number" ? key !== "publicStatus" || value === 200 : value === true),
    filename: draft.filename,
    articleId: article?.id || null,
    handle: draft.handle,
    title: draft.title,
    publicH1,
    publicUrl,
    adminUrl: article ? `https://admin.shopify.com/store/${shop}/articles/${article.id}` : null,
    updatedAt: article?.updated_at || null,
    checks,
  });
}

const redirectResult = await shopify(`redirects.json?limit=250&path=${encodeURIComponent("/blogs/news/best-barcode-scanner-mounts-warehouses")}`);
const expectedRedirect = (redirectResult.json.redirects || []).find((item) => (
  item.path === "/blogs/news/best-barcode-scanner-mounts-warehouses"
    && item.target === "/blogs/news/barcode-scanner-mounts-spec-comparison"
));

const report = {
  checkedAt: new Date().toISOString(),
  shop,
  blogId,
  articleCount: results.length,
  succeeded: results.filter((item) => item.success).length,
  failed: results.filter((item) => !item.success).length,
  barcodeLegacyRedirectVerified: Boolean(expectedRedirect),
  barcodeLegacyRedirect: expectedRedirect || null,
  results,
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  outputPath: path.relative(process.cwd(), outputPath),
  succeeded: report.succeeded,
  failed: report.failed,
  barcodeLegacyRedirectVerified: report.barcodeLegacyRedirectVerified,
  results: results.map(({ success, title, publicUrl, checks }) => ({ success, title, publicUrl, checks })),
}, null, 2));
if (report.failed || !report.barcodeLegacyRedirectVerified) process.exitCode = 1;
