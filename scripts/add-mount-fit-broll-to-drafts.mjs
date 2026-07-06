#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SHOPIFY_SHOP = getEnv("SHOPIFY_SHOP", "iboltmounts").replace(/\.myshopify\.com$/i, "");
const SHOPIFY_TOKEN =
  getEnv("SHOPIFY_ACCESS_TOKEN") ||
  getEnv("SHOPIFY_ADMIN_API_ACCESS_TOKEN") ||
  getEnv("SHOPIFY_ADMIN_ACCESS_TOKEN");
const SHOPIFY_API_VERSION = getEnv("SHOPIFY_API_VERSION", "2026-04");
const SHOPIFY_NEWS_BLOG_ID = Number(getEnv("SHOPIFY_NEWS_BLOG_ID", "104843772196"));
const BASE_DIR = path.resolve("content-output/mount-fit-workflows-broll-2026-06-30");
const IMAGES_DIR = path.join(BASE_DIR, "images");
const DRY_RUN = process.argv.includes("--dry-run");

const REST_BASE = `https://${SHOPIFY_SHOP}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}`;

const DRAFTS = [
  {
    id: 635277312292,
    slug: "construction-truck-cab-mounts-by-cab-type",
    title: "Construction Truck Cab Mounts by Cab Type",
    filename: "construction-truck-cab-mounts-by-cab-type.png",
    alt: "Construction truck cab interior at a jobsite with work gear and open dashboard space",
    caption: "Cab layout matters because crews need navigation, checklists, and communication where they can see them without cluttering the truck.",
  },
  {
    id: 635277345060,
    slug: "phone-mounts-popular-work-truck-models",
    title: "Phone Mounts for Popular Work Trucks",
    filename: "phone-mounts-popular-work-truck-models.png",
    alt: "Fleet yard with generic commercial pickups and service vans ready for dispatch",
    caption: "Popular work trucks do not all give drivers the same dashboard, console, windshield, or fleet policy options.",
  },
  {
    id: 635277443364,
    slug: "no-drill-vs-drill-base-work-truck-fleets",
    title: "No-Drill vs Drill-Base Mounts for Work Truck Fleets",
    filename: "no-drill-vs-drill-base-work-truck-fleets.png",
    alt: "Clean work truck cab with tools, paperwork, and open mounting areas before a fleet install",
    caption: "The right fleet setup starts with the cab, the driver workflow, and whether a permanent base is allowed.",
  },
  {
    id: 635277541668,
    slug: "dump-truck-utility-truck-phone-mounts",
    title: "Dump Truck and Utility Truck Phone Mounts",
    filename: "dump-truck-utility-truck-phone-mounts.png",
    alt: "Dusty dump truck cab with gloves, clipboard, radio, and rugged tablet at an active worksite",
    caption: "Dump and utility trucks add dust, vibration, gloves, radios, and rough roads to every mounting decision.",
  },
  {
    id: 635277574436,
    slug: "off-road-phone-mount-problems-and-fixes",
    title: "Off-Road Phone Mount Problems and Fixes",
    filename: "off-road-phone-mount-problems-and-fixes.png",
    alt: "Generic off-road vehicle interior on a rocky trail with a loose phone near the console",
    caption: "Trail vibration, angle changes, dust, and cabin movement expose weak phone mount setups quickly.",
  },
  {
    id: 635277607204,
    slug: "jeep-overlanding-phone-mount-setups",
    title: "Jeep and Overlanding Phone Mount Setups",
    filename: "jeep-overlanding-phone-mount-setups.png",
    alt: "Generic overlanding vehicle interior at a campsite with navigation, radio, maps, and trail gear",
    caption: "Overlanding setups often need navigation, radio access, charging, and quick visibility in the same small cockpit.",
  },
  {
    id: 635277803812,
    slug: "restaurant-tablet-workflows-separate-tablets-pos-kds",
    title: "Restaurant Tablet Workflows",
    filename: "restaurant-tablet-workflows-separate-tablets-pos-kds.png",
    alt: "Quick service restaurant counter with multiple generic tablets and kitchen equipment in the background",
    caption: "Delivery tablets work better when staff can see, hear, charge, and reach each screen during a rush.",
  },
  {
    id: 635277934884,
    slug: "restaurant-tablet-mounts-by-station-counter-expo-kitchen",
    title: "Restaurant Tablet Mounts by Station",
    filename: "restaurant-tablet-mounts-by-station-counter-expo-kitchen.png",
    alt: "Restaurant workspace with front counter, expo area, pickup shelf, and generic tablet stations",
    caption: "A station-by-station tablet plan keeps order flow visible without giving up every flat surface in the restaurant.",
  },
];

function getEnv(key, fallback = "") {
  if (process.env[key]) return process.env[key];
  const envPath = path.resolve(".env");
  if (!existsSync(envPath)) return fallback;
  const match = readFileSync(envPath, "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!match) return fallback;
  return match[1].trim().replace(/^["']|["']$/g, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function adminUrl(articleId) {
  return `https://admin.shopify.com/store/${SHOPIFY_SHOP}/articles/${articleId}`;
}

async function shopifyRest(method, endpoint, body, attempt = 1) {
  const response = await fetch(`${REST_BASE}/${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_TOKEN,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if ((response.status === 429 || response.status >= 500) && attempt < 5) {
    const retryAfter = Number(response.headers.get("retry-after") || "1");
    await sleep(Math.max(1000, retryAfter * 1000));
    return shopifyRest(method, endpoint, body, attempt + 1);
  }
  if (!response.ok) {
    throw new Error(`Shopify REST ${method} ${endpoint} failed: ${response.status} ${text.slice(0, 1200)}`);
  }
  return text ? JSON.parse(text) : {};
}

async function uploadArticleImage({ articleId, filePath, alt }) {
  const attachment = readFileSync(filePath).toString("base64");
  await shopifyRest("PUT", `blogs/${SHOPIFY_NEWS_BLOG_ID}/articles/${articleId}.json`, {
    article: {
      id: articleId,
      published: false,
      image: {
        attachment,
        alt,
      },
    },
  });

  const after = await shopifyRest("GET", `blogs/${SHOPIFY_NEWS_BLOG_ID}/articles/${articleId}.json`);
  const image = after.article?.image || {};
  const imageUrl = image.src || image.url || "";
  if (!imageUrl) throw new Error(`Shopify did not return an article image URL for ${articleId}`);
  if (after.article?.published_at) throw new Error(`Article became published while uploading image: ${articleId}`);
  return {
    id: `article-image-${articleId}`,
    url: imageUrl,
    fileStatus: "READY",
  };
}

function removeExistingBroll(html, slug) {
  const marker = new RegExp(
    `\\s*<!-- ibolt-broll-start:${escapeRegExp(slug)} -->[\\s\\S]*?<!-- ibolt-broll-end:${escapeRegExp(slug)} -->\\s*`,
    "g",
  );
  return String(html || "").replace(marker, "\n");
}

function brollBlock({ slug, imageUrl, alt, caption }) {
  return `\n<!-- ibolt-broll-start:${slug} -->\n<figure class="ibolt-broll-image" style="margin: 32px 0;">\n  <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(alt)}" loading="lazy" style="width: 100%; height: auto; border-radius: 6px;" />\n  <figcaption style="font-size: 0.95rem; color: #5f6368; margin-top: 8px;">${escapeHtml(caption)}</figcaption>\n</figure>\n<!-- ibolt-broll-end:${slug} -->\n`;
}

function insertBroll(html, block) {
  const body = String(html || "");
  const firstParagraphEnd = body.search(/<\/p>/i);
  if (firstParagraphEnd !== -1) {
    const end = firstParagraphEnd + body.match(/<\/p>/i)[0].length;
    return `${body.slice(0, end)}${block}${body.slice(end)}`;
  }
  const firstH2 = body.search(/<h2[\s>]/i);
  if (firstH2 !== -1) return `${body.slice(0, firstH2)}${block}${body.slice(firstH2)}`;
  return `${block}${body}`;
}

async function processDraft(item) {
  const filePath = path.join(IMAGES_DIR, item.filename);
  if (!existsSync(filePath)) throw new Error(`Missing image: ${filePath}`);

  const before = await shopifyRest("GET", `blogs/${SHOPIFY_NEWS_BLOG_ID}/articles/${item.id}.json`);
  const article = before.article;
  if (!article) throw new Error(`Article not found: ${item.id}`);
  if (article.published_at) {
    throw new Error(`Refusing to update published article ${item.id}: ${article.title}`);
  }

  const upload = DRY_RUN
    ? { id: "dry-run", url: `https://cdn.shopify.com/s/files/1/0000/0000/files/${item.filename}`, fileStatus: "READY" }
    : await uploadArticleImage({
        articleId: item.id,
        filePath,
        alt: item.alt,
      });

  const cleanHtml = removeExistingBroll(article.body_html, item.slug);
  const nextHtml = insertBroll(
    cleanHtml,
    brollBlock({
      slug: item.slug,
      imageUrl: upload.url,
      alt: item.alt,
      caption: item.caption,
    }),
  );

  if (!DRY_RUN) {
    await shopifyRest("PUT", `blogs/${SHOPIFY_NEWS_BLOG_ID}/articles/${item.id}.json`, {
      article: {
        id: item.id,
        body_html: nextHtml,
        published: false,
      },
    });
  }

  const after = DRY_RUN
    ? { article: { ...article, body_html: nextHtml, published_at: null, image: { src: upload.url } } }
    : await shopifyRest("GET", `blogs/${SHOPIFY_NEWS_BLOG_ID}/articles/${item.id}.json`);
  const verified = after.article;
  const body = verified.body_html || "";
  const imageSrc = verified.image?.src || verified.image?.url || "";

  return {
    id: item.id,
    title: verified.title || item.title,
    slug: item.slug,
    handle: verified.handle,
    adminUrl: adminUrl(item.id),
    filePath,
    shopifyFileId: upload.id,
    imageUrl: upload.url,
    featuredImage: imageSrc,
    published_at: verified.published_at || null,
    checks: {
      isDraft: !verified.published_at,
      hasMarker: body.includes(`ibolt-broll-start:${item.slug}`),
      hasBodyImage: body.includes(upload.url),
      hasFeaturedImage: Boolean(imageSrc),
    },
  };
}

function reportMarkdown(results) {
  const rows = results
    .map((item) => {
      const status = item.published_at ? "published" : "draft";
      const checks = Object.entries(item.checks)
        .map(([key, value]) => `${key}: ${value ? "pass" : "fail"}`)
        .join(", ");
      return `| ${item.title} | ${status} | [Open in Shopify](${item.adminUrl}) | [CDN image](${item.imageUrl}) | ${checks} |`;
    })
    .join("\n");

  return `# Mount Fit Workflow B-Roll Draft Updates

Generated: ${new Date().toISOString()}
Shop: ${SHOPIFY_SHOP}
Blog ID: ${SHOPIFY_NEWS_BLOG_ID}
Mode: ${DRY_RUN ? "dry run" : "Shopify draft update"}

| Article | Status | Shopify | Image | Checks |
|---|---:|---|---|---|
${rows}
`;
}

async function main() {
  if (!SHOPIFY_TOKEN && !DRY_RUN) {
    throw new Error("SHOPIFY_ACCESS_TOKEN or SHOPIFY_ADMIN_API_ACCESS_TOKEN is required.");
  }

  await mkdir(BASE_DIR, { recursive: true });

  const results = [];
  for (const item of DRAFTS) {
    const result = await processDraft(item);
    results.push(result);
    console.log(`${result.checks.isDraft ? "draft" : "published"} ${result.id} ${result.title}`);
  }

  const failures = results.flatMap((item) =>
    Object.entries(item.checks)
      .filter(([, ok]) => !ok)
      .map(([key]) => `${item.title}: ${key}`),
  );
  if (failures.length) {
    throw new Error(`Verification failed: ${failures.join("; ")}`);
  }

  await writeFile(path.join(BASE_DIR, "manifest.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
  await writeFile(path.join(BASE_DIR, "REPORT.md"), reportMarkdown(results));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
