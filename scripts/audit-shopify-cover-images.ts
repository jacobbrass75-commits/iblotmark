import "dotenv/config";
import { createHash } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { basename, dirname, extname, join } from "path";
import sharp from "sharp";

const SHOP = (process.env.SHOPIFY_SHOP || "iboltmounts").replace(/\.myshopify\.com$/i, "");
const TOKEN =
  process.env.SHOPIFY_ACCESS_TOKEN ||
  process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ||
  "";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const STORE_ORIGIN = process.env.IBOLT_STORE_ORIGIN || `https://${SHOP}.com`;
const OUT_DIR = process.env.COVER_AUDIT_OUT_DIR || "content-output/shopify-cover-image-refresh-2026-07-06";
const WHITE_THRESHOLD = Number(process.env.COVER_WHITE_THRESHOLD || "0.6");
const EDGE_WHITE_THRESHOLD = Number(process.env.COVER_EDGE_WHITE_THRESHOLD || "0.75");
const MAX_ARTICLES = Number(process.env.COVER_AUDIT_MAX_ARTICLES || "0");

interface ShopifyBlog {
  id: number;
  handle: string;
  title: string;
}

interface ShopifyArticle {
  id: number;
  title: string;
  handle: string;
  published_at?: string | null;
  image?: {
    src?: string;
    url?: string;
    alt?: string;
  } | null;
}

interface ImageScore {
  width: number;
  height: number;
  whiteRatio: number;
  edgeWhiteRatio: number;
  lowSaturationRatio: number;
  isPlainProductCandidate: boolean;
}

if (!TOKEN) throw new Error("SHOPIFY_ACCESS_TOKEN is required.");

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shopifyREST(method: string, endpoint: string, body?: unknown): Promise<{ data: any; link: string }> {
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

function nextPageUrl(linkHeader: string): string | null {
  if (!linkHeader) return null;
  const part = linkHeader
    .split(",")
    .map((item) => item.trim())
    .find((item) => /rel="next"/.test(item));
  return part?.match(/<([^>]+)>/)?.[1] || null;
}

async function paginate<T>(endpoint: string, key: string): Promise<T[]> {
  const rows: T[] = [];
  let next: string | null = endpoint;
  while (next) {
    const { data, link } = await shopifyREST("GET", next);
    rows.push(...(data[key] || []));
    next = nextPageUrl(link);
    await sleep(150);
  }
  return rows;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function inferVertical(title: string, handle: string) {
  const text = `${title} ${handle}`.toLowerCase();
  if (/fish|boat|marine|kayak|sonar|depth|water/.test(text)) return "fishing and boating";
  if (/forklift|warehouse|scanner|inventory|pallet/.test(text)) return "forklifts and warehousing";
  if (/truck|fleet|eld|semi|dump|utility|construction|delivery driver|work truck/.test(text)) return "trucking and fleet operations";
  if (/jeep|off-road|offroad|overlanding|trail/.test(text)) return "off-road and overlanding";
  if (/restaurant|kitchen|pos|delivery tablet|doordash|uber eats|expo|counter/.test(text)) return "restaurants and food delivery";
  if (/school|classroom|student|education|teacher/.test(text)) return "schools and classrooms";
  if (/stream|creator|content|camera|recording|overhead/.test(text)) return "content creation and streaming";
  if (/farm|tractor|agricultur/.test(text)) return "agriculture and farming";
  if (/road trip|travel|rv|van/.test(text)) return "road trips and travel";
  if (/bike|bicycle|cycling|mountain/.test(text)) return "mountain biking and cycling";
  if (/kitchen|home|countertop/.test(text)) return "kitchen and home";
  return "commercial mounting setups";
}

function sceneFor(vertical: string) {
  if (vertical === "fishing and boating") return "inside a real fishing boat cockpit near a console, lake light, rods and tackle in the background";
  if (vertical === "forklifts and warehousing") return "in a working warehouse aisle near a forklift, pallet racks, scanner workflow, industrial lighting";
  if (vertical === "trucking and fleet operations") return "inside a commercial truck cab or service vehicle, dashboard workflow, clipboard, radio, worksite or fleet yard visible";
  if (vertical === "off-road and overlanding") return "inside an off-road vehicle cockpit on a trail, dust, maps, radio, rugged dashboard surfaces";
  if (vertical === "restaurants and food delivery") return "in a quick-service restaurant counter or kitchen expo station, order tablets, pickup shelf, stainless surfaces";
  if (vertical === "schools and classrooms") return "in a classroom or school cart setup, desks, charging station, teaching materials";
  if (vertical === "content creation and streaming") return "on a creator desk or overhead filming rig, camera lights, phone recording station";
  if (vertical === "agriculture and farming") return "inside a tractor or farm utility vehicle cab, field visible through the glass, dusty controls";
  if (vertical === "road trips and travel") return "inside a travel vehicle cockpit with navigation, bags, dashboard, open road through windshield";
  if (vertical === "mountain biking and cycling") return "at a trailhead workbench or bike cockpit setup, gear and rugged outdoor light";
  if (vertical === "kitchen and home") return "on a practical kitchen counter or home work surface, natural light, everyday tools";
  return "in the real environment implied by the blog topic, with practical work surfaces and natural lighting";
}

function buildPrompt(article: ShopifyArticle, vertical: string) {
  return [
    "Use case: compositing",
    "Asset type: Shopify blog cover image",
    `Primary request: Transform the current plain product cover into a realistic environment image for the blog "${article.title}".`,
    "Input images: Image 1 is the edit target and product reference; preserve the mount/product design, silhouette, material, and visible hardware as much as possible.",
    `Scene/backdrop: ${sceneFor(vertical)}.`,
    "Subject: the existing iBOLT-style mount/product from the cover, placed naturally in the environment where a buyer would use it.",
    "Style/medium: photorealistic commercial editorial product photography, not a rendering.",
    "Composition/framing: 16:9 landscape blog hero, product clearly visible, contextual background visible, no oversized badge or text.",
    "Lighting/mood: natural practical lighting, realistic shadows, moderate depth of field, credible everyday texture.",
    "Constraints: change the white/studio background into the environment; keep the product believable and undistorted; no logos added; no words, captions, watermarks, badges, or UI labels.",
    "Avoid: purple tags, stock-photo gloss, impossible mounting angles, fake brand labels, clutter that hides the product.",
  ].join("\n");
}

async function downloadImage(url: string, outPath: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Image download failed: ${response.status} ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buffer);
  return buffer;
}

async function scoreImage(buffer: Buffer): Promise<ImageScore> {
  const image = sharp(buffer).rotate().resize({ width: 320, withoutEnlargement: true }).removeAlpha();
  const meta = await image.metadata();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  let white = 0;
  let edgeWhite = 0;
  let edgeTotal = 0;
  let lowSat = 0;
  const total = info.width * info.height;
  const channels = info.channels;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const i = (y * info.width + x) * channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const isWhite = r > 235 && g > 235 && b > 235;
      if (isWhite) white += 1;
      if (max - min < 18) lowSat += 1;
      if (x < 20 || y < 20 || x >= info.width - 20 || y >= info.height - 20) {
        edgeTotal += 1;
        if (isWhite) edgeWhite += 1;
      }
    }
  }

  const whiteRatio = white / total;
  const edgeWhiteRatio = edgeWhite / Math.max(1, edgeTotal);
  const lowSaturationRatio = lowSat / total;

  return {
    width: meta.width || info.width,
    height: meta.height || info.height,
    whiteRatio,
    edgeWhiteRatio,
    lowSaturationRatio,
    isPlainProductCandidate:
      whiteRatio >= WHITE_THRESHOLD &&
      edgeWhiteRatio >= EDGE_WHITE_THRESHOLD &&
      lowSaturationRatio >= 0.7,
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const blogs = await paginate<ShopifyBlog>("blogs.json?limit=250&fields=id,handle,title", "blogs");
  const rows: any[] = [];

  for (const blog of blogs) {
    const articles = await paginate<ShopifyArticle>(
      `blogs/${blog.id}/articles.json?limit=250&fields=id,title,handle,published_at,image`,
      "articles",
    );
    for (const article of articles) {
      if (MAX_ARTICLES > 0 && rows.length >= MAX_ARTICLES) break;
      const imageUrl = article.image?.src || article.image?.url || "";
      if (!article.published_at || !imageUrl) continue;

      const hash = createHash("sha1").update(`${blog.id}:${article.id}:${imageUrl}`).digest("hex").slice(0, 10);
      const sourceExt = extname(new URL(imageUrl).pathname) || ".jpg";
      const imagePath = join(OUT_DIR, "source-images", `${slugify(article.handle || article.title)}-${hash}${sourceExt}`);
      const buffer = await downloadImage(imageUrl, imagePath);
      const score = await scoreImage(buffer);
      const vertical = inferVertical(article.title, article.handle);

      rows.push({
        blogId: blog.id,
        blogTitle: blog.title,
        blogHandle: blog.handle,
        articleId: article.id,
        title: article.title,
        handle: article.handle,
        adminUrl: `https://admin.shopify.com/store/${SHOP}/articles/${article.id}`,
        publicUrl: `${STORE_ORIGIN}/blogs/${blog.handle}/${article.handle}`,
        currentImageUrl: imageUrl,
        currentImageAlt: article.image?.alt || "",
        sourceImagePath: imagePath,
        vertical,
        prompt: buildPrompt(article, vertical),
        ...score,
      });
      await sleep(60);
    }
  }

  const candidates = rows.filter((row) => row.isPlainProductCandidate);
  const manifest = {
    updatedAt: new Date().toISOString(),
    shop: SHOP,
    thresholds: {
      whiteRatio: WHITE_THRESHOLD,
      edgeWhiteRatio: EDGE_WHITE_THRESHOLD,
      lowSaturationRatio: 0.7,
    },
    scannedPublishedWithImages: rows.length,
    candidateCount: candidates.length,
    rows,
    candidates,
  };

  writeFileSync(join(OUT_DIR, "cover-image-audit.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(
    join(OUT_DIR, "candidate-prompts.md"),
    candidates
      .map((row, index) => {
        return [
          `## ${index + 1}. ${row.title}`,
          "",
          `- Article: ${row.publicUrl}`,
          `- Admin: ${row.adminUrl}`,
          `- Source image: ${row.sourceImagePath}`,
          `- White ratio: ${row.whiteRatio.toFixed(3)}; edge white: ${row.edgeWhiteRatio.toFixed(3)}`,
          "",
          "```text",
          row.prompt,
          "```",
        ].join("\n");
      })
      .join("\n\n"),
  );

  writeFileSync(
    join(OUT_DIR, "candidate-summary.csv"),
    [
      "title,publicUrl,adminUrl,sourceImagePath,vertical,whiteRatio,edgeWhiteRatio,lowSaturationRatio",
      ...candidates.map((row) =>
        [
          row.title,
          row.publicUrl,
          row.adminUrl,
          row.sourceImagePath,
          row.vertical,
          row.whiteRatio.toFixed(4),
          row.edgeWhiteRatio.toFixed(4),
          row.lowSaturationRatio.toFixed(4),
        ]
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(","),
      ),
    ].join("\n"),
  );

  console.log(`Scanned ${rows.length} published article cover image(s).`);
  console.log(`Flagged ${candidates.length} plain product/white-background candidate(s).`);
  console.log(`Wrote ${join(OUT_DIR, "cover-image-audit.json")}`);
  console.log(`Wrote ${join(OUT_DIR, "candidate-prompts.md")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
