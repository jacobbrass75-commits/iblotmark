import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = path.join(repoRoot, "content-output", "ibolt-brand-story-series-2026-07-15", "shopify-review");
const manifestPath = path.join(packageDir, "shopify-review-manifest.json");
const schedulePath = path.join(packageDir, "shopify-publication-schedule.json");
const statePath = path.join(packageDir, "shopify-publication-state.json");
const envPath = path.join(repoRoot, ".env");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv(envPath);

const shop = (process.env.SHOPIFY_SHOP || "iboltmounts").replace(/\.myshopify\.com$/i, "");
const token = process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN || "";
const version = process.env.SHOPIFY_API_VERSION || "2026-04";
const blogId = Number(process.env.SHOPIFY_NEWS_BLOG_ID || 104843772196);
const blogGid = `gid://shopify/Blog/${blogId}`;
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const schedule = JSON.parse(fs.readFileSync(schedulePath, "utf8"));
const articlesBySequence = new Map(manifest.articles.map((article) => [article.sequence, article]));

if (!token) throw new Error("Shopify access token is not configured.");

function targetHandle(article) {
  if (!article.target_url) return article.handle;
  return new URL(article.target_url).pathname.split("/").filter(Boolean).at(-1);
}

function firstImage(article) {
  const match = article.body_html.match(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*\balt=["']([^"']*)["']/i)
    || article.body_html.match(/<img\b[^>]*\balt=["']([^"']*)["'][^>]*\bsrc=["']([^"']+)["']/i);
  if (!match) return null;
  if (/^https?:/.test(match[1])) return { url: match[1], altText: match[2] || article.title };
  return { url: match[2], altText: match[1] || article.title };
}

function seoMetafields(article) {
  return [
    { namespace: "global", key: "title_tag", type: "single_line_text_field", value: article.meta_title },
    { namespace: "global", key: "description_tag", type: "single_line_text_field", value: article.meta_description },
  ];
}

async function rest(method, endpoint, body) {
  const response = await fetch(`https://${shop}.myshopify.com/admin/api/${version}/${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text.slice(0, 500) }; }
  if (!response.ok) throw new Error(`Shopify REST ${method} ${endpoint} failed (${response.status}): ${JSON.stringify(payload)}`);
  return payload;
}

async function graphql(query, variables) {
  const response = await fetch(`https://${shop}.myshopify.com/admin/api/${version}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) throw new Error(`Shopify GraphQL failed: ${JSON.stringify(payload.errors || payload)}`);
  return payload.data;
}

async function listArticles() {
  const result = await rest("GET", `blogs/${blogId}/articles.json?limit=250&published_status=any&fields=id,title,handle,published_at,admin_graphql_api_id`);
  return result.articles || [];
}

function articleInput(article, { isPublished, includeImage = false, publishDate } = {}) {
  const input = {
    blogId: blogGid,
    title: article.title,
    author: { name: "iBOLT Mounts" },
    handle: targetHandle(article),
    body: article.body_html,
    summary: `<p>${article.meta_description}</p>`,
    metafields: seoMetafields(article),
  };
  if (typeof isPublished === "boolean") input.isPublished = isPublished;
  if (publishDate) input.publishDate = publishDate;
  if (includeImage) {
    const image = firstImage(article);
    if (image) input.image = image;
  }
  return input;
}

async function createDraft(article) {
  const mutation = `mutation CreateArticle($article: ArticleCreateInput!) {
    articleCreate(article: $article) {
      article { id title handle isPublished publishedAt }
      userErrors { code field message }
    }
  }`;
  const data = await graphql(mutation, { article: articleInput(article, { isPublished: false, includeImage: true }) });
  if (data.articleCreate.userErrors.length) throw new Error(`Create ${article.handle}: ${JSON.stringify(data.articleCreate.userErrors)}`);
  return data.articleCreate.article;
}

async function updateArticle(gid, article, options = {}) {
  const mutation = `mutation UpdateArticle($id: ID!, $article: ArticleUpdateInput!) {
    articleUpdate(id: $id, article: $article) {
      article { id title handle isPublished publishedAt }
      userErrors { code field message }
    }
  }`;
  const input = articleInput(article, options);
  delete input.author;
  const data = await graphql(mutation, { id: gid, article: input });
  if (data.articleUpdate.userErrors.length) throw new Error(`Update ${article.handle}: ${JSON.stringify(data.articleUpdate.userErrors)}`);
  return data.articleUpdate.article;
}

function saveState(state) {
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function existingState() {
  return fs.existsSync(statePath)
    ? JSON.parse(fs.readFileSync(statePath, "utf8"))
    : { shop, blog_id: blogId, updated_at: null, items: {} };
}

async function preflight() {
  const live = await listArticles();
  const byHandle = new Map(live.map((article) => [article.handle, article]));
  const rows = [];
  for (const scheduled of schedule.items) {
    const article = articlesBySequence.get(scheduled.sequence);
    if (!article) throw new Error(`Schedule references missing sequence ${scheduled.sequence}`);
    const handle = targetHandle(article);
    const existing = byHandle.get(handle);
    rows.push({
      date: scheduled.date,
      sequence: scheduled.sequence,
      action: article.action,
      handle,
      existing_id: existing?.id || null,
      existing_status: existing ? (existing.published_at ? "published" : "draft") : "missing",
      valid: article.action === "NEW" ? !existing || !existing.published_at : Boolean(existing?.published_at),
    });
  }
  console.log(JSON.stringify({ shop, blogId, rows }, null, 2));
  if (rows.some((row) => !row.valid)) process.exitCode = 2;
}

async function uploadNewDrafts() {
  const live = await listArticles();
  const byHandle = new Map(live.map((article) => [article.handle, article]));
  const state = existingState();
  const results = [];
  for (const scheduled of schedule.items.filter((item) => item.action === "NEW")) {
    const article = articlesBySequence.get(scheduled.sequence);
    const handle = targetHandle(article);
    const existing = byHandle.get(handle);
    if (existing?.published_at) throw new Error(`Refusing to replace already-published article ${handle}.`);
    const result = existing
      ? await updateArticle(existing.admin_graphql_api_id, article, { isPublished: false })
      : await createDraft(article);
    state.items[String(scheduled.sequence)] = {
      sequence: scheduled.sequence,
      action: "NEW",
      scheduled_date: scheduled.date,
      article_gid: result.id,
      handle: result.handle,
      status: "draft_uploaded",
      published_at: result.publishedAt || null,
      admin_url: `https://admin.shopify.com/store/${shop}/articles/${result.id.split("/").at(-1)}`,
    };
    results.push(state.items[String(scheduled.sequence)]);
  }
  state.updated_at = new Date().toISOString();
  saveState(state);
  console.log(JSON.stringify({ uploaded: results.length, results }, null, 2));
}

async function publishDue(dateOverride) {
  const localDate = dateOverride || new Intl.DateTimeFormat("en-CA", { timeZone: schedule.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const due = schedule.items.filter((item) => item.date <= localDate);
  const live = await listArticles();
  const byHandle = new Map(live.map((article) => [article.handle, article]));
  const state = existingState();
  const completed = new Set(Object.values(state.items).filter((item) => item.status === "published" || item.status === "refreshed").map((item) => item.sequence));
  const next = due.find((item) => !completed.has(item.sequence));
  if (!next) {
    console.log(JSON.stringify({ localDate, action: "none", reason: "No unpublished scheduled item is due." }, null, 2));
    return;
  }
  const article = articlesBySequence.get(next.sequence);
  const handle = targetHandle(article);
  const existing = byHandle.get(handle);
  if (!existing) throw new Error(`Scheduled article ${handle} is missing from Shopify.`);
  if (article.action === "NEW" && existing.published_at) {
    state.items[String(next.sequence)] = { ...(state.items[String(next.sequence)] || {}), sequence: next.sequence, status: "published", published_at: existing.published_at };
    state.updated_at = new Date().toISOString();
    saveState(state);
    console.log(JSON.stringify({ localDate, action: "already_published", sequence: next.sequence, handle }, null, 2));
    return;
  }
  if (article.action === "REFRESH" && !existing.published_at) throw new Error(`Refusing to refresh unpublished existing article ${handle}.`);
  const result = await updateArticle(existing.admin_graphql_api_id, article, { isPublished: true });
  const status = article.action === "NEW" ? "published" : "refreshed";
  state.items[String(next.sequence)] = {
    ...(state.items[String(next.sequence)] || {}),
    sequence: next.sequence,
    action: article.action,
    scheduled_date: next.date,
    article_gid: result.id,
    handle: result.handle,
    status,
    published_at: result.publishedAt || existing.published_at || new Date().toISOString(),
    admin_url: `https://admin.shopify.com/store/${shop}/articles/${result.id.split("/").at(-1)}`,
    public_url: `https://iboltmounts.com/blogs/news/${result.handle}`,
  };
  state.updated_at = new Date().toISOString();
  saveState(state);
  console.log(JSON.stringify({ localDate, action: status, item: state.items[String(next.sequence)] }, null, 2));
}

const args = new Set(process.argv.slice(2));
if (args.has("--preflight")) await preflight();
else if (args.has("--upload-new-drafts")) await uploadNewDrafts();
else if (args.has("--publish-due")) {
  const dateArg = process.argv.find((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  await publishDue(dateArg);
} else {
  console.error("Use --preflight, --upload-new-drafts, or --publish-due [YYYY-MM-DD].");
  process.exitCode = 1;
}
