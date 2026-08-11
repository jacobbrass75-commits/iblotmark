#!/usr/bin/env node

import "dotenv/config";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { marked } from "marked";

const SOURCE_DIR = path.resolve(
  process.argv.find((arg) => arg.startsWith("--source="))?.slice("--source=".length)
    || "content-output/top-10-category-program-2026-08-05/drafts",
);
const OUTPUT_PATH = path.resolve(
  process.argv.find((arg) => arg.startsWith("--output="))?.slice("--output=".length)
    || "content-output/top-10-category-program-2026-08-05/shopify-live-publish-manifest.json",
);
const LIVE = process.argv.includes("--publish-live");
const UPDATE_EXISTING_ONLY = process.argv.includes("--update-existing-only");
const SHOP = process.env.SHOPIFY_SHOP || "iboltmounts";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const BLOG_ID = Number(process.env.SHOPIFY_NEWS_BLOG_ID || 104843772196);
const BLOG_HANDLE = "news";
const CAMPAIGN_TAG = "top-10-category-program-2026-08-05";
const BACKUP_DIR = path.resolve(
  process.argv.find((arg) => arg.startsWith("--backup-dir="))?.slice("--backup-dir=".length)
    || "content-output/top-10-category-program-2026-08-05/shopify-backups",
);

if (!SHOP) throw new Error("SHOPIFY_SHOP is required.");
if (!TOKEN) throw new Error("SHOPIFY_ACCESS_TOKEN is required.");
if (!Number.isFinite(BLOG_ID)) throw new Error("A numeric Shopify News blog ID is required.");

marked.setOptions({ gfm: true, breaks: false });

async function shopify(method, endpoint, body) {
  const response = await fetch(`https://${SHOP}.myshopify.com/admin/api/${API_VERSION}/${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!response.ok) {
    throw new Error(`Shopify ${method} ${endpoint} failed: ${response.status} ${text.slice(0, 1000)}`);
  }
  return { json, headers: Object.fromEntries(response.headers.entries()) };
}

async function listArticles() {
  const articles = [];
  let endpoint = `blogs/${BLOG_ID}/articles.json?limit=250&published_status=any`;
  while (endpoint) {
    const result = await shopify("GET", endpoint);
    articles.push(...(result.json.articles || []));
    const link = result.headers.link || "";
    const nextUrl = link.split(",").map((part) => part.trim()).find((part) => /rel="next"/.test(part))?.match(/<([^>]+)>/)?.[1];
    endpoint = nextUrl ? new URL(nextUrl).pathname.split(`/admin/api/${API_VERSION}/`)[1] + new URL(nextUrl).search : "";
  }
  return articles;
}

function parseDraft(markdown, filename) {
  const metaTitle = markdown.match(/^Meta Title:\s*(.+)$/m)?.[1]?.trim() || "";
  const metaDescription = markdown.match(/^Meta Description:\s*(.+)$/m)?.[1]?.trim() || "";
  const slug = markdown.match(/^Slug:\s*(.+)$/m)?.[1]?.trim() || filename.replace(/\.md$/, "");
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || metaTitle;
  const firstImage = markdown.match(/<img\s+[^>]*src="([^"]+)"/i)?.[1] || "";
  const bodyMarkdown = markdown
    .replace(/^Meta Title:.*\n?/m, "")
    .replace(/^Meta Description:.*\n?/m, "")
    .replace(/^Slug:.*\n?/m, "")
    .replace(/^#\s+.*\n?/m, "")
    .trim();
  let bodyHtml = marked.parse(bodyMarkdown);
  bodyHtml = bodyHtml
    .replace(/<table>/g, '<div style="overflow-x:auto;margin:24px 0 36px"><table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.4">')
    .replace(/<\/table>/g, "</table></div>")
    .replace(/<th>/g, '<th style="background:#1a1a1a;color:#fff;text-align:left;padding:12px 10px">')
    .replace(/<td>/g, '<td style="border-bottom:1px solid #dedede;padding:11px 10px;vertical-align:top">')
    .replace(/<img\s+([^>]*?)>/gi, (_match, attrs) => {
      const withoutStyle = attrs.replace(/\sstyle="[^"]*"/gi, "").replace(/\sloading="[^"]*"/gi, "");
      return `<img ${withoutStyle} loading="lazy" style="display:block;max-width:560px;width:100%;height:auto;margin:28px auto 8px;border-radius:4px">`;
    });
  bodyHtml += buildArticleStructuredData(markdown, title, slug);
  return { filename, metaTitle, metaDescription, slug, title, firstImage, bodyHtml };
}

function plainText(value) {
  return String(value || "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_`]/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractRankings(markdown) {
  const tableLinks = new Map();
  for (const match of markdown.matchAll(/^\|\s*(\d+)\s*\|\s*\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gm)) {
    tableLinks.set(Number(match[1]), { name: plainText(match[2]), url: match[3] });
  }
  const headings = [...markdown.matchAll(/^###\s+(\d+)\.\s+(.+)$/gm)];
  const items = [];
  for (let index = 0; index < headings.length; index += 1) {
    const match = headings[index];
    const position = Number(match[1]);
    if (position < 1 || position > 10) continue;
    const heading = match[2].trim();
    const headingLink = heading.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    const sectionStart = (match.index || 0) + match[0].length;
    const sectionEnd = headings[index + 1]?.index ?? markdown.length;
    const section = markdown.slice(sectionStart, sectionEnd);
    const sectionUrl = section.match(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/)?.[1]
      || section.match(/href="(https?:\/\/[^"#]+)"/)?.[1]
      || "";
    const tableLink = tableLinks.get(position);
    const url = headingLink?.[2] || sectionUrl || tableLink?.url || "";
    if (url) items.push({ position, name: plainText(headingLink?.[1] || tableLink?.name || heading), url });
  }
  return items.sort((a, b) => a.position - b.position);
}

function extractFaqs(markdown) {
  const faqHeading = markdown.match(/^## FAQ\s*$/m);
  if (!faqHeading) return [];
  const tail = markdown.slice((faqHeading.index || 0) + faqHeading[0].length).trimStart();
  const nextHeadingIndex = tail.search(/^##\s+/m);
  const section = nextHeadingIndex >= 0 ? tail.slice(0, nextHeadingIndex) : tail;
  const faqs = [];
  for (const match of section.matchAll(/^\*\*(.+?\?)\*\*\s+(.+)$/gm)) {
    faqs.push({ question: plainText(match[1]), answer: plainText(match[2]) });
  }
  return faqs;
}

function schemaScript(schema) {
  const json = JSON.stringify(schema).replace(/</g, "\\u003c");
  return `\n<script type="application/ld+json">${json}</script>`;
}

function buildArticleStructuredData(markdown, title, slug) {
  const canonical = `https://iboltmounts.com/blogs/${BLOG_HANDLE}/${slug}`;
  const rankings = extractRankings(markdown);
  const faqs = extractFaqs(markdown);
  let html = "";
  if (rankings.length === 10) {
    html += schemaScript({
      "@context": "https://schema.org",
      "@type": "ItemList",
      "@id": `${canonical}#comparison`,
      name: title,
      numberOfItems: rankings.length,
      itemListOrder: "https://schema.org/ItemListOrderAscending",
      itemListElement: rankings.map((item) => ({
        "@type": "ListItem",
        position: item.position,
        name: item.name,
        url: item.url,
      })),
    });
  }
  if (faqs.length >= 2) {
    html += schemaScript({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "@id": `${canonical}#faq`,
      mainEntity: faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    });
  }
  return html;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function articlePayload(article) {
  return {
    article: {
      title: article.title,
      author: "iBOLT Mounts",
      body_html: article.bodyHtml,
      summary_html: `<p>${escapeHtml(article.metaDescription)}</p>`,
      published: true,
      handle: article.slug,
      tags: "",
      ...(article.firstImage ? { image: { src: article.firstImage, alt: article.title } } : {}),
      metafields: [
        { namespace: "global", key: "title_tag", value: article.metaTitle, type: "single_line_text_field" },
        { namespace: "global", key: "description_tag", value: article.metaDescription, type: "single_line_text_field" },
      ],
    },
  };
}

async function verifyPublic(article) {
  const publicUrl = `https://iboltmounts.com/blogs/${BLOG_HANDLE}/${article.handle}`;
  let lastStatus = 0;
  let lastTitleMatch = false;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(publicUrl, { redirect: "follow" });
    const html = await response.text();
    lastStatus = response.status;
    lastTitleMatch = html.toLowerCase().includes(String(article.title || "").toLowerCase());
    if (response.ok && lastTitleMatch) return { publicUrl, status: response.status, titleMatch: true, attempt };
    await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
  }
  return { publicUrl, status: lastStatus, titleMatch: lastTitleMatch, attempt: 4 };
}

async function saveManifest(manifest) {
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function saveLiveBackup(drafts, byHandle) {
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const backupPath = path.join(BACKUP_DIR, `before-competitor-update-${stamp}.json`);
  const snapshots = [];
  for (const draft of drafts) {
    const existing = byHandle.get(draft.slug);
    if (!existing) continue;
    const [articleResult, metafieldResult] = await Promise.all([
      shopify("GET", `blogs/${BLOG_ID}/articles/${existing.id}.json`),
      shopify("GET", `articles/${existing.id}/metafields.json`),
    ]);
    snapshots.push({
      sourceFile: draft.filename,
      article: articleResult.json.article,
      metafields: metafieldResult.json.metafields || [],
    });
  }
  await mkdir(BACKUP_DIR, { recursive: true });
  await writeFile(backupPath, `${JSON.stringify({
    shop: SHOP,
    blogId: BLOG_ID,
    createdAt: new Date().toISOString(),
    articleCount: snapshots.length,
    snapshots,
  }, null, 2)}\n`, "utf8");
  return backupPath;
}

async function main() {
  const files = (await readdir(SOURCE_DIR)).filter((name) => /^top-10-.*\.md$/.test(name)).sort();
  const drafts = [];
  for (const filename of files) drafts.push(parseDraft(await readFile(path.join(SOURCE_DIR, filename), "utf8"), filename));

  const existingArticles = await listArticles();
  const byHandle = new Map(existingArticles.map((article) => [article.handle, article]));
  const collisions = drafts
    .filter((draft) => byHandle.has(draft.slug))
    .map((draft) => {
      const existing = byHandle.get(draft.slug);
      return {
        slug: draft.slug,
        articleId: existing.id,
        title: existing.title,
        publishedAt: existing.published_at || null,
        ownedByCampaign: String(existing.tags || "").split(",").map((tag) => tag.trim()).includes(CAMPAIGN_TAG),
      };
    });
  const unsafeCollisions = collisions.filter((item) => !item.ownedByCampaign);
  const missingExistingHandles = drafts.filter((draft) => !byHandle.has(draft.slug)).map((draft) => draft.slug);

  const manifest = {
    mode: LIVE ? "publish-live" : "dry-run",
    shop: SHOP,
    blogId: BLOG_ID,
    blogHandle: BLOG_HANDLE,
    campaignTag: CAMPAIGN_TAG,
    startedAt: new Date().toISOString(),
    sourceDir: path.relative(process.cwd(), SOURCE_DIR),
    articleCount: drafts.length,
    draftDiagnostics: drafts.map((draft) => ({
      slug: draft.slug,
      metaTitleLength: draft.metaTitle.length,
      metaDescriptionLength: draft.metaDescription.length,
      hasComparisonItemList: /"@type":"ItemList"/.test(draft.bodyHtml),
      hasFaqPage: /"@type":"FAQPage"/.test(draft.bodyHtml),
    })),
    existingArticleCount: existingArticles.length,
    collisions,
    unsafeCollisions,
    updateExistingOnly: UPDATE_EXISTING_ONLY,
    missingExistingHandles,
    results: [],
  };

  if (!LIVE) {
    manifest.finishedAt = new Date().toISOString();
    await saveManifest(manifest);
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }
  if (unsafeCollisions.length) {
    throw new Error(`Refusing to overwrite ${unsafeCollisions.length} existing non-campaign handles: ${unsafeCollisions.map((item) => item.slug).join(", ")}`);
  }
  if (UPDATE_EXISTING_ONLY && missingExistingHandles.length) {
    throw new Error(`Refusing to create replacement articles because these live campaign handles are missing: ${missingExistingHandles.join(", ")}`);
  }

  manifest.backupPath = path.relative(process.cwd(), await saveLiveBackup(drafts, byHandle));
  await saveManifest(manifest);

  for (const draft of drafts) {
    const startedAt = new Date().toISOString();
    try {
      const existing = byHandle.get(draft.slug);
      let action;
      let article;
      if (existing) {
        const payload = articlePayload(draft);
        payload.article.id = existing.id;
        const updated = await shopify("PUT", `blogs/${BLOG_ID}/articles/${existing.id}.json`, payload);
        article = updated.json.article;
        action = "updated";
      } else {
        const created = await shopify("POST", `blogs/${BLOG_ID}/articles.json`, articlePayload(draft));
        article = created.json.article;
        action = "created";
      }
      const fetched = await shopify("GET", `blogs/${BLOG_ID}/articles/${article.id}.json`);
      const verified = fetched.json.article;
      const publicVerification = await verifyPublic(verified);
      const result = {
        success: Boolean(verified.published_at) && publicVerification.status === 200 && publicVerification.titleMatch,
        action,
        slug: draft.slug,
        articleId: verified.id,
        title: verified.title,
        handle: verified.handle,
        publishedAt: verified.published_at || null,
        bodyHtmlBytes: Buffer.byteLength(verified.body_html || ""),
        imageUrl: verified.image?.src || null,
        publicUrl: publicVerification.publicUrl,
        publicStatus: publicVerification.status,
        publicTitleMatch: publicVerification.titleMatch,
        adminUrl: `https://admin.shopify.com/store/${SHOP}/articles/${verified.id}`,
        startedAt,
        finishedAt: new Date().toISOString(),
      };
      manifest.results.push(result);
      console.log(`[${result.success ? "published" : "verify-failed"}] ${draft.slug} ${result.publicUrl}`);
    } catch (error) {
      manifest.results.push({
        success: false,
        slug: draft.slug,
        error: error instanceof Error ? error.message : String(error),
        startedAt,
        finishedAt: new Date().toISOString(),
      });
      console.error(`[failed] ${draft.slug}: ${manifest.results.at(-1).error}`);
    }
    await saveManifest(manifest);
  }

  manifest.finishedAt = new Date().toISOString();
  manifest.succeeded = manifest.results.filter((item) => item.success).length;
  manifest.failed = manifest.results.filter((item) => !item.success).length;
  await saveManifest(manifest);
  console.log(JSON.stringify({
    outputPath: path.relative(process.cwd(), OUTPUT_PATH),
    succeeded: manifest.succeeded,
    failed: manifest.failed,
    results: manifest.results.map(({ success, title, publicUrl, adminUrl, error }) => ({ success, title, publicUrl, adminUrl, error })),
  }, null, 2));
  if (manifest.failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
