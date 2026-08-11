import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const SHOP = (process.env.SHOPIFY_SHOP || "iboltmounts").replace(/\.myshopify\.com$/i, "");
const TOKEN =
  process.env.SHOPIFY_ACCESS_TOKEN ||
  process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ||
  "";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const AUTHOR = process.argv.find((arg) => arg.startsWith("--author="))?.split("=")[1] || "Katie Hobbs";
const MODEL = process.env.BLOG_ANTHROPIC_MODEL || "claude-sonnet-5";
const LIMIT = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] || "0");
const ONLY_HANDLE = process.argv.find((arg) => arg.startsWith("--handle="))?.split("=")[1] || "";
const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");
const OUTPUT_DIR =
  process.env.AUTHOR_REWRITE_OUTPUT_DIR ||
  path.join("content-output", "kattie-hobs-rewrite-2026-07-06");
const DB_PATH = process.env.DATABASE_PATH || "data/standalone-blog-writer.db";

if (!TOKEN) throw new Error("SHOPIFY_ACCESS_TOKEN is required.");
if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required.");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const db = fs.existsSync(DB_PATH) ? new Database(DB_PATH) : null;

const bannedPhrases = [
  "game-changer",
  "revolutionize",
  "seamless",
  "cutting-edge",
  "next-level",
  "groundbreaking",
  "innovative solution",
  "state-of-the-art",
  "paradigm shift",
  "synergy",
  "leverage",
  "empower",
  "robust",
  "holistic",
  "streamline",
  "best-in-class",
  "world-class",
  "look no further",
  "budget option",
  "affordable alternative",
  "cheaper than RAM",
  "cost-effective alternative",
  "economical choice",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shopifyREST(method, endpoint, body) {
  const url = /^https?:\/\//i.test(endpoint)
    ? endpoint
    : `https://${SHOP}.myshopify.com/admin/api/${API_VERSION}/${endpoint}`;
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Shopify ${method} ${endpoint} failed: ${response.status} ${text.slice(0, 1000)}`);
  return { data: text ? JSON.parse(text) : {}, link: response.headers.get("link") || "" };
}

function nextPageUrl(linkHeader) {
  if (!linkHeader) return null;
  const part = linkHeader
    .split(",")
    .map((item) => item.trim())
    .find((item) => /rel="next"/.test(item));
  return part?.match(/<([^>]+)>/)?.[1] || null;
}

async function paginate(endpoint, key) {
  const rows = [];
  let next = endpoint;
  while (next) {
    const { data, link } = await shopifyREST("GET", next);
    rows.push(...(data[key] || []));
    next = nextPageUrl(link);
    await sleep(150);
  }
  return rows;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(html) {
  const text = stripHtml(html);
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

function extractProtectedBlocks(html) {
  const blocks = [];
  const withProtected = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<figure\b[\s\S]*?<\/figure>/gi, (block) => {
      const placeholder = `[[PROTECTED_MEDIA_BLOCK_${blocks.length + 1}]]`;
      blocks.push(block.trim());
      return `\n\n${placeholder}\n\n`;
    })
    .replace(/<p\b[^>]*>\s*(?:<a\b[^>]*>\s*)?<img\b[\s\S]*?(?:<\/a>\s*)?<\/p>/gi, (block) => {
      const placeholder = `[[PROTECTED_MEDIA_BLOCK_${blocks.length + 1}]]`;
      blocks.push(block.trim());
      return `\n\n${placeholder}\n\n`;
    })
    .replace(/<div\b[^>]*>\s*(?:<a\b[^>]*>\s*)?<img\b[\s\S]*?(?:<\/a>\s*)?(?:<p\b[\s\S]*?<\/p>\s*)?<\/div>/gi, (block) => {
      const placeholder = `[[PROTECTED_MEDIA_BLOCK_${blocks.length + 1}]]`;
      blocks.push(block.trim());
      return `\n\n${placeholder}\n\n`;
    })
    .replace(/<img\b[^>]*>/gi, (block) => {
      const placeholder = `[[PROTECTED_MEDIA_BLOCK_${blocks.length + 1}]]`;
      blocks.push(block.trim());
      return `\n\n${placeholder}\n\n`;
    });
  return { withProtected, blocks };
}

function restoreProtectedBlocks(html, blocks) {
  let restored = String(html || "");
  for (let index = 0; index < blocks.length; index += 1) {
    restored = restored.replace(`[[PROTECTED_MEDIA_BLOCK_${index + 1}]]`, blocks[index]);
  }
  return restored;
}

function extractLinks(html) {
  const links = [];
  const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html || ""))) {
    const href = match[1];
    const label = stripHtml(match[2]);
    if (/iboltmounts\.com/i.test(href) || /^\/products\//i.test(href)) {
      links.push({ href, label });
    }
  }
  return links.slice(0, 18);
}

function inferTopic(title, handle) {
  const text = `${title} ${handle}`.toLowerCase();
  if (/fish|boat|marine|kayak|pontoon|garmin/.test(text)) return "marine electronics and boat mounting";
  if (/forklift|warehouse|scanner|material/.test(text)) return "forklift, warehouse, and material handling mounting";
  if (/truck|fleet|eld|driver|road/.test(text)) return "fleet, truck, ELD, and driver mounting";
  if (/restaurant|tablet|pos|delivery|kitchen/.test(text)) return "restaurant tablet and POS mounting";
  if (/stream|camera|youtube|creator|livestream|unboxing/.test(text)) return "content creation and camera mounting";
  if (/school|student|classroom|paperless|back-to-school/.test(text)) return "school and education tablet mounting";
  if (/farm|tractor/.test(text)) return "farm equipment and tablet mounting";
  if (/bike|jeep|off-road|outdoor|recreation/.test(text)) return "outdoor, off-road, and recreation mounting";
  return "professional device mounting";
}

function normalizeOutput(html) {
  let cleaned = String(html || "")
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/[—–]/g, ",")
    .replace(/\biBolt\b/g, "iBOLT")
    .replace(/\bIBOLT\b/g, "iBOLT")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  cleaned = cleaned
    .replace(/\bleverage\b/gi, "use")
    .replace(/\bgame-changer\b/gi, "major improvement")
    .replace(/\bseamless\b/gi, "straightforward")
    .replace(/\brobust\b/gi, "durable")
    .replace(/\bstreamline\b/gi, "simplify");
  if (!/^<article[\s>]/i.test(cleaned)) cleaned = `<article>\n${cleaned}\n</article>`;
  if (!/<\/article>\s*$/i.test(cleaned) && /<article[\s>]/i.test(cleaned)) {
    cleaned = `${cleaned}\n</article>`;
  }
  return cleaned;
}

function validateHtml(html, blocks) {
  const issues = [];
  const lower = html.toLowerCase();
  for (const phrase of bannedPhrases) {
    if (lower.includes(phrase)) issues.push(`banned phrase: ${phrase}`);
  }
  if (/[—–]/.test(html)) issues.push("contains em dash or en dash");
  if (!/^<article[\s>]/i.test(html.trim())) issues.push("does not start with article tag");
  if (!/<\/article>\s*$/i.test(html.trim())) issues.push("does not end with article tag");
  for (let index = 0; index < blocks.length; index += 1) {
    const placeholder = `[[PROTECTED_MEDIA_BLOCK_${index + 1}]]`;
    const count = html.split(placeholder).length - 1;
    if (count !== 1) issues.push(`${placeholder} appears ${count} times`);
  }
  const restored = restoreProtectedBlocks(html, blocks);
  if (/\[\[PROTECTED_MEDIA_BLOCK_\d+\]\]/.test(restored)) issues.push("unrestored protected media placeholder remains");
  const wc = wordCount(restored);
  if (wc < 600 && !FORCE) issues.push(`word count too low: ${wc}`);
  return issues;
}

function systemPrompt() {
  return `You are the iBOLT Mounts senior blog editor rewriting older Shopify articles.

Voice:
- Practical, credible, buyer-aware, and specific.
- Write like someone who understands vehicle, warehouse, restaurant, school, boat, and creator mounting workflows.
- Education first, sales second.

Rules:
- Return complete Shopify article body HTML only. No markdown fences. No explanation.
- Start with <article> and end with </article>.
- Preserve every [[PROTECTED_MEDIA_BLOCK_N]] placeholder exactly once. Do not edit placeholder text.
- Keep the same search intent and topic. Do not change the title.
- Use concrete decision guidance: mounting surface, vibration, device size, charging, cable routing, removal frequency, security, AMPS/VESA/ball sizes, and compatibility where relevant.
- Be honest where fitment must be verified. Do not invent exact vehicle, tablet, GPS, or product compatibility unless the source proves it.
- Always write iBOLT exactly.
- Do not frame iBOLT as cheap, budget, or a cheaper alternative.
- Do not use em dashes or en dashes.
- Avoid these phrases: ${bannedPhrases.join(", ")}.
- Target 800 to 1200 words when the topic supports it.
- Use 4 to 6 useful H2 sections.
- Add a concise FAQ section with 4 to 6 buyer questions near the end.
- Keep useful existing iBOLT product links and product URLs where they still fit.
- No internal process language, no AI-search language, no keyword stuffing.`;
}

function userPrompt(article, htmlWithProtected, blocks, links) {
  const topic = inferTopic(article.title, article.handle);
  const linkContext = links.length
    ? links.map((link) => `- ${link.label || "iBOLT link"}: ${link.href}`).join("\n")
    : "- No iBOLT product links detected. Keep product claims conservative.";

  return `Rewrite this Shopify blog article.

Title: ${article.title}
Handle: ${article.handle}
Topic lane: ${topic}
Author on Shopify: ${article.author || ""}
Current word count: ${wordCount(article.body_html)}
Protected media placeholders: ${blocks.map((_, index) => `[[PROTECTED_MEDIA_BLOCK_${index + 1}]]`).join(", ") || "none"}

Useful existing iBOLT links:
${linkContext}

Rewrite goals:
- Make the article substantially better, clearer, and more current.
- Keep the topic and buyer intent.
- Preserve the protected media placeholders exactly once each.
- Keep good product links, but remove generic filler around them.
- Add practical "what to verify before buying" guidance.
- Make the FAQ answer-ready.
- Avoid changing the publishing meaning of the post.

Existing article HTML with media replaced by placeholders:

${htmlWithProtected}`;
}

async function rewriteArticle(article, htmlWithProtected, blocks, links) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const request = {
      model: MODEL,
      max_tokens: 8192,
      system: systemPrompt(),
      messages: [
        {
          role: "user",
          content: userPrompt(article, htmlWithProtected, blocks, links),
        },
      ],
    };
    if (!/^claude-(?:sonnet|fable)-5\b/.test(MODEL)) {
      request.temperature = attempt === 1 ? 0.42 : 0.22;
    }
    const response = await anthropic.messages.create({
      ...request,
    });
    const text = response.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    const draft = normalizeOutput(text);
    const issues = validateHtml(draft, blocks);
    if (issues.length === 0) return restoreProtectedBlocks(draft, blocks);
    lastError = new Error(issues.join("; "));
    console.warn(`[retry] ${article.handle}: ${lastError.message}`);
  }
  throw lastError;
}

async function loadAuthorArticles() {
  const blogs = await paginate("blogs.json?limit=250&fields=id,title,handle", "blogs");
  const rows = [];
  for (const blog of blogs) {
    const articles = await paginate(
      `blogs/${blog.id}/articles.json?limit=250&fields=id,title,handle,body_html,summary_html,published_at,author,updated_at,created_at,image,tags`,
      "articles",
    );
    rows.push(
      ...articles
        .filter((article) => String(article.author || "").toLowerCase() === AUTHOR.toLowerCase())
        .map((article) => ({
          ...article,
          blog_id: blog.id,
          blog_title: blog.title,
          blog_handle: blog.handle,
          public_url: `https://${SHOP}.com/blogs/${blog.handle}/${article.handle}`,
          admin_url: `https://admin.shopify.com/store/${SHOP}/articles/${article.id}`,
        })),
    );
  }
  rows.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  let filtered = rows;
  if (ONLY_HANDLE) filtered = filtered.filter((article) => article.handle === ONLY_HANDLE);
  if (LIMIT > 0) filtered = filtered.slice(0, LIMIT);
  return filtered;
}

function updateLocalDb(article, html, notes) {
  if (!db) return { updated: false, reason: "database not found" };
  const existing = db
    .prepare("SELECT id, verification_notes FROM blog_posts WHERE shopify_article_id = ?")
    .get(Number(article.id));
  if (!existing) return { updated: false, reason: "no local blog_posts row" };

  let parsedNotes = {};
  try {
    parsedNotes = existing.verification_notes ? JSON.parse(existing.verification_notes) : {};
  } catch {
    parsedNotes = { previousNotes: existing.verification_notes };
  }

  db.prepare(`
    UPDATE blog_posts
    SET html = ?,
        word_count = ?,
        verification_notes = ?,
        shopify_synced_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    html,
    wordCount(html),
    JSON.stringify({ ...parsedNotes, authorRewrite: notes }),
    notes.rewrittenAt,
    Date.now(),
    existing.id,
  );
  return { updated: true, blogPostId: existing.id };
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const previewDir = path.join(OUTPUT_DIR, "rewritten-html");
  const backupDir = path.join(OUTPUT_DIR, "backups");
  fs.mkdirSync(previewDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });

  const articles = await loadAuthorArticles();
  const manifest = {
    updatedAt: new Date().toISOString(),
    shop: SHOP,
    author: AUTHOR,
    mode: APPLY ? "apply" : "preview",
    model: MODEL,
    selectedCount: articles.length,
    articles: articles.map((article) => ({
      blogId: article.blog_id,
      articleId: article.id,
      title: article.title,
      handle: article.handle,
      published: Boolean(article.published_at),
      publicUrl: article.public_url,
      adminUrl: article.admin_url,
      currentWordCount: wordCount(article.body_html),
    })),
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, "selected-author-articles.json"), JSON.stringify(manifest, null, 2));

  const results = [];
  for (const article of articles) {
    const filename = `${String(article.id)}-${slugify(article.handle || article.title)}`;
    const beforePath = path.join(backupDir, `${filename}.before.json`);
    const rewrittenPath = path.join(previewDir, `${filename}.rewritten.html`);
    fs.writeFileSync(beforePath, JSON.stringify(article, null, 2));

    try {
      if (!article.body_html?.trim()) throw new Error("article has no body_html");
      console.log(`[rewrite] ${article.id} ${article.handle}`);
      const { withProtected, blocks } = extractProtectedBlocks(article.body_html);
      const links = extractLinks(article.body_html);
      const rewrittenHtml = await rewriteArticle(article, withProtected, blocks, links);
      fs.writeFileSync(rewrittenPath, rewrittenHtml);
      const rewrittenAt = new Date().toISOString();

      let shopifyApplied = false;
      if (APPLY) {
        await shopifyREST("PUT", `blogs/${article.blog_id}/articles/${article.id}.json`, {
          article: {
            id: article.id,
            body_html: rewrittenHtml,
          },
        });
        shopifyApplied = true;
      }

      const dbUpdate = APPLY
        ? updateLocalDb(article, rewrittenHtml, {
          rewrittenAt,
          model: MODEL,
          author: AUTHOR,
          shopifyArticleId: article.id,
          originalWordCount: wordCount(article.body_html),
          rewrittenWordCount: wordCount(rewrittenHtml),
        })
        : { updated: false, reason: "preview mode" };

      results.push({
        articleId: article.id,
        blogId: article.blog_id,
        title: article.title,
        handle: article.handle,
        published: Boolean(article.published_at),
        publicUrl: article.public_url,
        adminUrl: article.admin_url,
        success: true,
        applied: shopifyApplied,
        originalWordCount: wordCount(article.body_html),
        rewrittenWordCount: wordCount(rewrittenHtml),
        protectedMediaBlocks: blocks.length,
        backupPath: beforePath,
        rewrittenPath,
        dbUpdate,
      });
      console.log(`[done] ${article.handle} words=${wordCount(rewrittenHtml)} applied=${shopifyApplied}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        articleId: article.id,
        blogId: article.blog_id,
        title: article.title,
        handle: article.handle,
        published: Boolean(article.published_at),
        publicUrl: article.public_url,
        adminUrl: article.admin_url,
        success: false,
        applied: false,
        error: message,
        backupPath: beforePath,
      });
      console.error(`[failed] ${article.handle}: ${message}`);
    }
  }

  const report = {
    updatedAt: new Date().toISOString(),
    shop: SHOP,
    author: AUTHOR,
    mode: APPLY ? "apply" : "preview",
    model: MODEL,
    total: results.length,
    succeeded: results.filter((row) => row.success).length,
    failed: results.filter((row) => !row.success).length,
    applied: results.filter((row) => row.applied).length,
    results,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, APPLY ? "apply-report.json" : "preview-report.json"), JSON.stringify(report, null, 2));
  console.log("RESULTS_JSON_START");
  console.log(JSON.stringify({
    mode: report.mode,
    total: report.total,
    succeeded: report.succeeded,
    failed: report.failed,
    applied: report.applied,
    reportPath: path.join(OUTPUT_DIR, APPLY ? "apply-report.json" : "preview-report.json"),
  }, null, 2));
  console.log("RESULTS_JSON_END");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
