import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reviewDir = path.join(
  repoRoot,
  "content-output",
  "forklift-mount-history-series-2026-08-25",
  "shopify-review",
);
const manifestPath = path.join(reviewDir, "review-manifest.json");
const draftResultsPath = path.join(reviewDir, "shopify-draft-results.json");
const backupDir = path.join(reviewDir, "publish-backups");
const envPath = path.join(repoRoot, ".env");
const shouldPublish = process.argv.includes("--publish");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv(envPath);

const shop = (process.env.SHOPIFY_SHOP || "iboltmounts").replace(/\.myshopify\.com$/i, "");
const token = process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN || "";
const apiVersion = process.env.SHOPIFY_API_VERSION || "2026-04";
const blogId = Number(process.env.SHOPIFY_NEWS_BLOG_ID || 104843772196);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const draftResults = JSON.parse(fs.readFileSync(draftResultsPath, "utf8"));

if (!token) throw new Error("Shopify access token is not configured.");
if (!Number.isFinite(blogId)) throw new Error("SHOPIFY_NEWS_BLOG_ID must be numeric.");

function reviewHandle(article) {
  return article.contentAction === "NEW"
    ? article.handle
    : `${article.handle}-review-draft-2026-08-25`;
}

function count(text, pattern) {
  return (String(text || "").match(pattern) || []).length;
}

function bodyChecks(article, body) {
  const checks = {
    faqAccordions: count(body, /<details\b[^>]*class=["'][^"']*ibolt-faq-row/gi),
    faqSchemaItems: count(body, /"@type"\s*:\s*"Question"/g),
    uploadPlaceholders: count(body, /__UPLOAD_TO_SHOPIFY_CDN__/g),
    localhostReferences: count(body, /localhost|127\.0\.0\.1/g),
  };
  if (article.handle === "best-forklift-tablet-mounts-warehouses") {
    checks.comparisonCards = count(body, /class=["'][^"']*ibolt-comparison-card/gi);
    checks.tables = count(body, /<table\b/gi);
  }
  if (article.handle.includes("forklift-mount-solutions-supporting-efficiency")) {
    checks.hasNewHero = body.includes("forklift-mount-evolution-hero-v2.png");
  }
  return checks;
}

function assertBodyReady(article, body) {
  const checks = bodyChecks(article, body);
  if (checks.faqAccordions !== 4 || checks.faqSchemaItems !== 4) {
    throw new Error(`${article.handle}: expected four FAQ accordions and four FAQ schema questions.`);
  }
  if (checks.uploadPlaceholders || checks.localhostReferences) {
    throw new Error(`${article.handle}: body contains an unsafe local or upload placeholder URL.`);
  }
  if (checks.comparisonCards !== undefined && (checks.comparisonCards !== 7 || checks.tables !== 0)) {
    throw new Error(`${article.handle}: responsive comparison card checks failed.`);
  }
  if (checks.hasNewHero === false) throw new Error(`${article.handle}: new v2 hero is missing.`);
  return checks;
}

async function rest(method, endpoint, body) {
  const response = await fetch(`https://${shop}.myshopify.com/admin/api/${apiVersion}/${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text.slice(0, 500) }; }
  if (!response.ok) {
    throw new Error(`Shopify REST ${method} ${endpoint} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function graphql(query, variables) {
  const response = await fetch(`https://${shop}.myshopify.com/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    throw new Error(`Shopify GraphQL failed: ${JSON.stringify(payload.errors || payload)}`);
  }
  return payload.data;
}

async function listAllArticles() {
  const found = [];
  let endpoint = `blogs/${blogId}/articles.json?limit=250&published_status=any&fields=id,title,handle,published_at,tags,image,admin_graphql_api_id`;
  while (endpoint) {
    const result = await rest("GET", endpoint);
    found.push(...(result.articles || []));
    endpoint = null;
  }
  return found;
}

async function fetchArticle(id) {
  const result = await rest(
    "GET",
    `blogs/${blogId}/articles/${id}.json?fields=id,title,handle,author,body_html,summary_html,published_at,created_at,updated_at,tags,image,admin_graphql_api_id`,
  );
  return result.article;
}

async function fetchMetafields(id) {
  const result = await rest("GET", `articles/${id}/metafields.json?limit=250`);
  return result.metafields || [];
}

async function syncSeoMetafields(id, article) {
  const existing = await fetchMetafields(id);
  const wanted = [
    ["title_tag", article.metaTitle],
    ["description_tag", article.metaDescription],
  ];
  for (const [key, value] of wanted) {
    const current = existing.find((field) => field.namespace === "global" && field.key === key);
    if (current?.value === value) continue;
    if (current) {
      await rest("PUT", `metafields/${current.id}.json`, {
        metafield: { id: current.id, value, type: "single_line_text_field" },
      });
    } else {
      await rest("POST", `articles/${id}/metafields.json`, {
        metafield: {
          namespace: "global",
          key,
          value,
          type: "single_line_text_field",
        },
      });
    }
  }
}

async function updateArticle(gid, input) {
  const mutation = `mutation UpdateArticle($id: ID!, $article: ArticleUpdateInput!) {
    articleUpdate(id: $id, article: $article) {
      article { id title handle isPublished publishedAt }
      userErrors { code field message }
    }
  }`;
  const data = await graphql(mutation, { id: gid, article: input });
  if (data.articleUpdate.userErrors.length) {
    throw new Error(`Article update failed: ${JSON.stringify(data.articleUpdate.userErrors)}`);
  }
  return data.articleUpdate.article;
}

function articleImage(image) {
  if (!image?.src) return undefined;
  return { url: image.src, altText: image.alt || "" };
}

function draftIdFor(article) {
  const row = draftResults.results.find((item) => item.title === article.title);
  if (!row?.articleId) throw new Error(`Missing approved draft ID for ${article.title}.`);
  return Number(row.articleId);
}

async function buildPreflight() {
  const inventory = await listAllArticles();
  const byHandle = new Map(inventory.map((article) => [article.handle, article]));
  const rows = [];

  for (const article of manifest.articles) {
    const draftSummary = byHandle.get(reviewHandle(article));
    const expectedDraftId = draftIdFor(article);
    if (!draftSummary || Number(draftSummary.id) !== expectedDraftId) {
      throw new Error(`${article.title}: approved draft ID/handle mismatch.`);
    }
    const draft = await fetchArticle(draftSummary.id);
    if (draft.published_at) throw new Error(`${article.title}: approved review draft is unexpectedly published.`);
    if (draft.title !== article.title) throw new Error(`${article.title}: draft title changed after approval.`);
    const checks = assertBodyReady(article, draft.body_html);
    const draftMetafields = await fetchMetafields(draft.id);
    const targetSummary = article.contentAction === "NEW" ? draftSummary : byHandle.get(article.handle);
    if (!targetSummary) throw new Error(`${article.title}: canonical target is missing.`);
    if (article.contentAction === "REFRESH" && !targetSummary.published_at) {
      throw new Error(`${article.title}: canonical refresh target is not currently live.`);
    }
    const target = article.contentAction === "NEW" ? draft : await fetchArticle(targetSummary.id);
    const targetMetafields = article.contentAction === "NEW" ? draftMetafields : await fetchMetafields(target.id);
    rows.push({ article, draft, draftMetafields, target, targetMetafields, checks });
  }
  return rows;
}

function safeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function writeBackup(rows) {
  fs.mkdirSync(backupDir, { recursive: true });
  const file = path.join(backupDir, `publish-preflight-${safeTimestamp()}.json`);
  const payload = {
    createdAt: new Date().toISOString(),
    shop,
    blogId,
    note: "Pre-publication backup of the approved drafts and canonical targets.",
    rows: rows.map(({ article, draft, draftMetafields, target, targetMetafields, checks }) => ({
      plan: { title: article.title, contentAction: article.contentAction, canonicalHandle: article.handle },
      checks,
      draft,
      draftMetafields,
      target,
      targetMetafields,
    })),
  };
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

async function publish(rows) {
  const results = [];
  for (const row of rows) {
    const { article, draft, target } = row;
    const input = article.contentAction === "NEW"
      ? { isPublished: true }
      : {
          title: draft.title,
          body: draft.body_html,
          summary: draft.summary_html,
          image: articleImage(draft.image),
          isPublished: true,
        };
    if (!input.image) delete input.image;
    const updated = await updateArticle(target.admin_graphql_api_id, input);
    await rest("PUT", `blogs/${blogId}/articles/${target.id}.json`, {
      article: { id: target.id, tags: "" },
    });
    await syncSeoMetafields(target.id, article);
    results.push({
      title: article.title,
      contentAction: article.contentAction,
      articleId: Number(updated.id.split("/").at(-1)),
      handle: article.handle,
      publishedAt: updated.publishedAt,
      liveUrl: `https://iboltmounts.com/blogs/news/${article.handle}`,
      reviewDraftId: article.contentAction === "REFRESH" ? draft.id : null,
    });
  }
  return results;
}

async function verify(rows, results) {
  const output = [];
  for (const result of results) {
    const article = manifest.articles.find((item) => item.title === result.title);
    const live = await fetchArticle(result.articleId);
    const checks = assertBodyReady(article, live.body_html);
    const liveMetafields = await fetchMetafields(live.id);
    const seo = Object.fromEntries(
      liveMetafields
        .filter((field) => field.namespace === "global" && ["title_tag", "description_tag"].includes(field.key))
        .map((field) => [field.key, field.value]),
    );
    const response = await fetch(result.liveUrl, { redirect: "follow" });
    const reviewStillHidden = result.reviewDraftId
      ? !(await fetchArticle(result.reviewDraftId)).published_at
      : true;
    output.push({
      ...result,
      published: Boolean(live.published_at),
      publicHttpStatus: response.status,
      finalPublicUrl: response.url,
      heroUrl: live.image?.src || null,
      checks,
      seoTitle: seo.title_tag === article.metaTitle,
      seoDescription: seo.description_tag === article.metaDescription,
      reviewStillHidden,
      bodySha256: crypto.createHash("sha256").update(live.body_html || "").digest("hex"),
    });
  }
  const failed = output.filter((item) => (
    !item.published
    || item.publicHttpStatus !== 200
    || !item.seoTitle
    || !item.seoDescription
    || !item.reviewStillHidden
  ));
  if (failed.length) throw new Error(`Post-publication verification failed: ${JSON.stringify(failed)}`);
  const file = path.join(reviewDir, "shopify-publish-results.json");
  fs.writeFileSync(file, `${JSON.stringify({ publishedAt: new Date().toISOString(), results: output }, null, 2)}\n`);
  return { file, output };
}

const rows = await buildPreflight();
const preflight = rows.map(({ article, draft, target, checks }) => ({
  title: article.title,
  action: article.contentAction === "NEW" ? "publish approved draft" : "refresh canonical live article",
  approvedDraftId: draft.id,
  canonicalTargetId: target.id,
  canonicalHandle: article.handle,
  targetCurrentlyPublished: Boolean(target.published_at),
  checks,
}));

console.log(JSON.stringify({ mode: shouldPublish ? "publish" : "preflight", shop, blogId, preflight }, null, 2));

if (!shouldPublish) process.exit(0);

const backup = writeBackup(rows);
const results = await publish(rows);
const verified = await verify(rows, results);
console.log(JSON.stringify({ backup, resultsFile: verified.file, results: verified.output }, null, 2));
