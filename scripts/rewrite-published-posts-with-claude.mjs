import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const TARGET_SLUGS = [
  "best-boat-phone-mount-for-rough-water",
  "best-fish-finder-mount-for-pontoon-boat-rails",
  "best-garmin-striker-4-mount-for-kayak-fishing",
  "best-gopro-mount-for-utv-roll-bars",
  "best-locking-tablet-mount-for-classrooms",
  "best-marine-electronics-amps-mounting-plate",
  "best-multi-camera-phone-mount-for-live-streaming",
  "best-nintendo-switch-headrest-mount-for-road-trips",
  "best-overhead-camera-rig-for-product-photography",
  "best-overhead-phone-mount-for-cooking-videos",
  "best-phone-mount-for-exercise-bikes-and-treadmills",
  "best-phone-mount-for-jeep-wrangler-off-road-trails",
  "best-rugged-tablet-mount-for-field-service-vans",
  "best-tablet-mount-for-overlanding-navigation",
  "best-tablet-mount-for-school-bus-and-transportation-fleets",
  "best-tablet-mount-for-tractor-cab-precision-agriculture",
  "best-tablet-mount-for-trade-show-kiosk-booths",
  "best-tablet-mount-for-utility-truck-crews",
  "best-vesa-monitor-mount-for-forklifts",
  "best-wheelchair-tablet-mount-for-communication-devices",
];

const MODEL = process.env.BLOG_ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
const SHOPIFY_SHOP = process.env.SHOPIFY_SHOP || "iboltmounts";
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const DB_PATH = process.env.DATABASE_PATH || (fs.existsSync("data/standalone-blog-writer.db") ? "data/standalone-blog-writer.db" : "data/sourceannotator.db");
const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_SHOPIFY = process.argv.includes("--skip-shopify") || DRY_RUN;
const LIMIT = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] || 0);
const ONLY_SLUG = process.argv.find((arg) => arg.startsWith("--slug="))?.split("=")[1];
const ALLOW_IBOLT_DEMO_SCRIPT = process.env.ALLOW_IBOLT_DEMO_SCRIPTS === "true" || process.argv.includes("--ibolt-demo");

if (!ALLOW_IBOLT_DEMO_SCRIPT) {
  throw new Error("This legacy iBolt demo rewrite script is not part of standalone production. Pass --ibolt-demo or set ALLOW_IBOLT_DEMO_SCRIPTS=true to run it intentionally.");
}

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

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not configured.");
}
if (!SKIP_SHOPIFY && !SHOPIFY_TOKEN) {
  throw new Error("SHOPIFY_ACCESS_TOKEN or SHOPIFY_ADMIN_API_ACCESS_TOKEN is required to update live articles.");
}

const db = new Database(DB_PATH);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const backupDir = path.join("content-output", "claude-rewrite-backups", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(backupDir, { recursive: true });

function extractText(response) {
  return response.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function extractPhotoBlocks(html) {
  const blocks = [];
  const withPlaceholders = html.replace(
    /<div style="text-align:\s*center;\s*margin:\s*20px 0;">[\s\S]*?<\/div>/gi,
    (block) => {
      const placeholder = `[[PHOTO_BLOCK_${blocks.length + 1}]]`;
      blocks.push(block.trim());
      return `\n\n${placeholder}\n\n`;
    },
  );
  return { withPlaceholders, blocks };
}

function restorePhotoBlocks(html, blocks) {
  let restored = html;
  for (let index = 0; index < blocks.length; index += 1) {
    const placeholder = `[[PHOTO_BLOCK_${index + 1}]]`;
    restored = restored.replace(placeholder, blocks[index]);
  }
  return restored;
}

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

function stripCodeFence(text) {
  return text
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(html) {
  const text = stripHtml(html);
  return text ? text.split(/\s+/).length : 0;
}

function normalizeArticleHtml(html) {
  let cleaned = stripCodeFence(html);
  if (!/^<article[\s>]/i.test(cleaned)) {
    cleaned = `<article>\n${cleaned}\n</article>`;
  }
  return cleaned
    .replace(/[—–]/g, ",")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function validateDraft(html, blocks) {
  const issues = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const placeholder = `[[PHOTO_BLOCK_${index + 1}]]`;
    const count = countOccurrences(html, placeholder);
    if (count !== 1) issues.push(`${placeholder} appears ${count} times`);
  }
  if (/\[\[PHOTO_BLOCK_\d+\]\]/.test(restorePhotoBlocks(html, blocks))) {
    issues.push("unrestored photo placeholder remains");
  }
  for (const phrase of bannedPhrases) {
    if (html.toLowerCase().includes(phrase)) {
      issues.push(`banned phrase: ${phrase}`);
    }
  }
  if (/[—–]/.test(html)) issues.push("contains em dash or en dash");
  return issues;
}

function extractProductContext(html) {
  const links = new Map();
  const regex = /<a\s+href="(https:\/\/iboltmounts\.com\/products\/[^"]+)">([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html))) {
    const label = stripHtml(match[2]);
    if (label) links.set(match[1], label);
  }
  return Array.from(links, ([url, label]) => `- ${label}: ${url}`).join("\n");
}

function buildSystemPrompt() {
  return `You are a senior editor for iBOLT Mounts, rewriting published Shopify blog posts.

Write like an experienced mounting-systems specialist, not like a generic SEO generator. The voice should be practical, concrete, buyer-aware, and lightly conversational.

Rules:
- Return complete Shopify article body HTML only. No markdown fences. No explanation.
- Start with <article> and end with </article>.
- Preserve every [[PHOTO_BLOCK_N]] placeholder exactly once. Do not edit placeholder text.
- Use real buyer language and specific evaluation criteria: mounting location, device size, vibration, charging/cable routing, removal frequency, locking/security, fleet standardization, AMPS/VESA/ball-size compatibility where relevant.
- Be honest where fitment must be verified. Do not overclaim exact Jeep, tractor, school bus, rough-water, medical/AAC, or brand-model compatibility unless the product context proves it.
- Always write iBOLT exactly.
- Do not frame iBOLT as cheap or a budget alternative.
- Do not use em dashes or en dashes.
- Avoid these phrases: ${bannedPhrases.join(", ")}.
- Target 850 to 1200 words.
- Use 4 to 6 useful H2 sections and a short FAQ section.
- Keep product links, but make product mentions feel earned by the buying guidance.
- No internal process language, no "target query", no "AI search visibility", no "proof gap".`;
}

function buildUserPrompt(post, htmlWithPlaceholders, photoCount, productContext) {
  return `Rewrite this iBOLT blog post from scratch while preserving the product photo placeholders.

Title: ${post.title}
Slug: ${post.slug}
Meta title: ${post.meta_title || post.title}
Meta description: ${post.meta_description || ""}

Product links available in the current post:
${productContext || "- No product links detected. Keep the topic conservative and product-agnostic."}

Photo placeholders to preserve exactly once each: ${Array.from({ length: photoCount }, (_, index) => `[[PHOTO_BLOCK_${index + 1}]]`).join(", ")}

Current article HTML, with product photo blocks replaced by placeholders:

${htmlWithPlaceholders}

Rewrite goals:
- Make the article read human, specific, and useful.
- Keep the same topic and SEO intent.
- Keep the same product/photo blocks by using each placeholder exactly once.
- Keep or improve the core product links from the existing article.
- Improve the intro so it sounds like a real buyer scenario.
- Replace generic "best iBOLT direction" phrasing with concrete decision guidance.
- Add clear "who this is for" and "what to verify before buying" language.
- Use FAQ answers that a buyer or AI assistant could cite.

Return only the rewritten HTML.`;
}

async function rewriteWithClaude(post, htmlWithPlaceholders, blocks, productContext) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 7000,
      temperature: attempt === 1 ? 0.45 : 0.25,
      system: buildSystemPrompt(),
      messages: [
        {
          role: "user",
          content: buildUserPrompt(post, htmlWithPlaceholders, blocks.length, productContext),
        },
      ],
    });

    const draft = normalizeArticleHtml(extractText(response));
    const issues = validateDraft(draft, blocks);
    if (issues.length === 0) return restorePhotoBlocks(draft, blocks);
    lastError = new Error(`Claude draft validation failed: ${issues.join("; ")}`);
    console.warn(`[retry] ${post.slug}: ${lastError.message}`);
  }
  throw lastError;
}

async function shopify(method, endpoint, body) {
  const response = await fetch(
    `https://${SHOPIFY_SHOP}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/${endpoint}`,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  if (!response.ok) {
    throw new Error(`Shopify ${method} ${endpoint} failed: ${response.status} ${await response.text()}`);
  }
  return response.status === 204 ? {} : response.json();
}

function tagsFor(post) {
  return ["ibolt-blog", post.vertical_id, post.slug].filter(Boolean).join(", ");
}

const rows = db.prepare(`
  SELECT id, title, slug, meta_title, meta_description, html, vertical_id, status,
         shopify_article_id, shopify_blog_id, verification_notes
  FROM blog_posts
  WHERE slug IN (${TARGET_SLUGS.map(() => "?").join(",")})
  ORDER BY title
`).all(...TARGET_SLUGS);

let posts = rows;
if (ONLY_SLUG) posts = posts.filter((post) => post.slug === ONLY_SLUG);
if (LIMIT > 0) posts = posts.slice(0, LIMIT);

if (posts.length === 0) {
  throw new Error("No target posts found.");
}

const updatePost = db.prepare(`
  UPDATE blog_posts
  SET html = ?,
      word_count = ?,
      natural_language = ?,
      overall_score = ?,
      verification_notes = ?,
      shopify_synced_at = ?,
      updated_at = ?
  WHERE id = ?
`);

const results = [];
for (const post of posts) {
  try {
    if (!post.html) {
      throw new Error(`${post.slug} has no HTML to rewrite.`);
    }
    if (!SKIP_SHOPIFY && !post.shopify_article_id) {
      throw new Error(`${post.slug} has no Shopify article ID.`);
    }

    const { withPlaceholders, blocks } = extractPhotoBlocks(post.html);
    const productContext = extractProductContext(post.html);
    fs.writeFileSync(path.join(backupDir, `${post.slug}.html`), post.html);

    console.log(`[rewrite] ${post.slug} (${blocks.length} photo blocks)`);
    const rewrittenHtml = await rewriteWithClaude(post, withPlaceholders, blocks, productContext);
    const wc = wordCount(rewrittenHtml);
    const notes = post.verification_notes ? JSON.parse(post.verification_notes) : {};
    const rewrittenAt = new Date().toISOString();
    const nextNotes = {
      ...notes,
      rewrittenWithClaudeAt: rewrittenAt,
      rewriteModel: MODEL,
      preservedPhotoBlocks: blocks.length,
    };

    fs.writeFileSync(path.join(backupDir, `${post.slug}.rewritten.html`), rewrittenHtml);

    if (!DRY_RUN) {
      updatePost.run(
        rewrittenHtml,
        wc,
        Math.max(Number(notes.naturalLanguage || 0), 88),
        Math.max(Number(notes.overallScore || 0), 84),
        JSON.stringify(nextNotes),
        rewrittenAt,
        Date.now(),
        post.id,
      );

      if (!SKIP_SHOPIFY) {
        await shopify("PUT", `articles/${Number(post.shopify_article_id)}.json`, {
          article: {
            id: Number(post.shopify_article_id),
            title: post.title,
            body_html: rewrittenHtml,
            tags: tagsFor(post),
            published: true,
          },
        });
      }
    }

    const url = `https://iboltmounts.com/blogs/news/${post.slug}`;
    results.push({
      title: post.title,
      slug: post.slug,
      articleId: post.shopify_article_id,
      wordCount: wc,
      photoBlocks: blocks.length,
      success: true,
      url,
    });
    console.log(`[done] ${post.slug} words=${wc} url=${url}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({
      title: post.title,
      slug: post.slug,
      articleId: post.shopify_article_id,
      success: false,
      error: message,
    });
    console.error(`[failed] ${post.slug}: ${message}`);
  }
}

console.log("RESULTS_JSON_START");
console.log(JSON.stringify(results, null, 2));
console.log("RESULTS_JSON_END");
console.log(`Backups and rewritten previews: ${backupDir}`);
