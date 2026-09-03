import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

const SHOP = (process.env.SHOPIFY_SHOP || "iboltmounts").replace(/\.myshopify\.com$/i, "");
const TOKEN =
  process.env.SHOPIFY_ACCESS_TOKEN ||
  process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ||
  "";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const MANIFEST_PATH =
  process.env.BROLL_COVER_MANIFEST ||
  "content-output/shopify-cover-image-refresh-2026-07-06/photo-bank-review/broll-cover-match-manifest.json";
const OUT_PATH =
  process.env.BROLL_COVER_REPORT ||
  "content-output/shopify-cover-image-refresh-2026-07-06/photo-bank-review/shopify-broll-cover-apply-report.json";
const APPLY = process.argv.includes("--apply");

interface MatchRow {
  blogId: number;
  articleId: number;
  title: string;
  handle: string;
  publicUrl: string;
  adminUrl: string;
  recommendedBrollPath: string | null;
  recommendedBrollName: string | null;
  works: boolean;
}

if (!TOKEN) throw new Error("SHOPIFY_ACCESS_TOKEN is required.");
if (!existsSync(MANIFEST_PATH)) throw new Error(`Missing manifest: ${MANIFEST_PATH}`);

async function shopifyREST(method: string, endpoint: string, body?: unknown): Promise<any> {
  const response = await fetch(`https://${SHOP}.myshopify.com/admin/api/${API_VERSION}/${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`Shopify ${method} ${endpoint} failed: ${response.status} ${text.slice(0, 1000)}`);
  return text ? JSON.parse(text) : {};
}

function imageAlt(row: MatchRow) {
  return `${row.title} - iBOLT mounting setup in use`;
}

const rows = (JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as MatchRow[])
  .filter((row) => row.works && row.recommendedBrollPath && existsSync(row.recommendedBrollPath));

const results: any[] = [];

for (const row of rows) {
  const before = await shopifyREST("GET", `blogs/${row.blogId}/articles/${row.articleId}.json`);
  const article = before.article;
  if (!article?.published_at) {
    results.push({
      ...row,
      skipped: true,
      reason: "Article is not currently published.",
      previousImage: article?.image || null,
    });
    continue;
  }

  const attachment = readFileSync(row.recommendedBrollPath as string).toString("base64");
  if (APPLY) {
    await shopifyREST("PUT", `blogs/${row.blogId}/articles/${row.articleId}.json`, {
      article: {
        id: row.articleId,
        image: {
          attachment,
          alt: imageAlt(row),
        },
      },
    });
  }

  const after = APPLY
    ? await shopifyREST("GET", `blogs/${row.blogId}/articles/${row.articleId}.json`)
    : { article };

  results.push({
    ...row,
    applied: APPLY,
    previousImage: article.image || null,
    nextImage: APPLY ? after.article?.image || null : { localPath: row.recommendedBrollPath, alt: imageAlt(row) },
  });
}

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(
  OUT_PATH,
  JSON.stringify(
    {
      updatedAt: new Date().toISOString(),
      shop: SHOP,
      mode: APPLY ? "apply" : "dry-run",
      manifestPath: MANIFEST_PATH,
      eligible: rows.length,
      results,
    },
    null,
    2,
  ),
);

console.log(`${APPLY ? "Applied" : "Dry run for"} ${rows.length} b-roll cover replacement(s).`);
console.log(`Wrote ${OUT_PATH}`);
