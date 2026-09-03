import "dotenv/config";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { and, eq } from "drizzle-orm";
import {
  blogPostPhotos,
  blogPostProducts,
  blogPosts,
  generationBatches,
  keywordClusters,
  keywordImports,
  keywords,
  productPhotos,
  products,
} from "@shared/schema";
import { db } from "../server/db";
import { lintContent } from "../server/contentLinter";
import { getCompanyContext } from "../server/companyContext";
import { renderPreviewHtml, renderShopifyHtml } from "../server/htmlRenderer";
import { DEFAULT_COMPANY_ID } from "../server/companyDefaults";

const COMPANY_ID = DEFAULT_COMPANY_ID;
const SERIES_DIR = join(process.cwd(), "content-output", "ibolt-locking-tablet-security-series-2026-08-26");
const HTML_DIR = join(SERIES_DIR, "shopify-review", "body-html");
const PREVIEW_DIR = join(SERIES_DIR, "shopify-review", "previews");
const VERIFIER_PATH = join(SERIES_DIR, "shopify-review", "verifier-report.json");

interface ArticleMeta {
  title: string;
  slug: string;
  metaTitle: string;
  metaDescription: string;
  primaryKeyword: string;
  verticalId: string;
  heroPhotoId: string;
}

interface ArticleDraft {
  filename: string;
  meta: ArticleMeta;
  markdown: string;
}

interface VerifierEntry {
  slug: string;
  lint: ReturnType<typeof lintContent>;
  verification: {
    brandConsistency: number;
    seoOptimization: number;
    naturalLanguage: number;
    factualAccuracy: number;
    overallScore: number;
    issues: string[];
    suggestions: string[];
    passesQualityGate: boolean;
  };
  generation: Array<{ provider?: string; model?: string; phase?: string; fallback?: boolean }>;
}

const articleProducts: Record<string, string[]> = {
  "locking-pos-mounts-prevent-tablet-theft": ["IBRT-34719", "IBRT-34717"],
  "secure-tablets-retail-kiosks": ["IBRT-34717", "IBRT-34719"],
  "locking-eld-mounts-shared-fleet-tablets": ["IBBZ-33993", "IBBZ-33779", "IBBZ-33971"],
  "locking-forklift-tablet-mount-device-security": ["IBFL-34591", "IBFL-34530"],
  "secure-tablets-industrial-workstations": ["IBBZ-33779", "IBBZ-33993", "IBBZ-33934"],
};

const keywordPlan: Record<string, string[]> = {
  "locking POS tablet mounts": [
    "locking POS tablet mounts",
    "restaurant tablet theft prevention",
    "secure POS tablet stand",
    "keyed tablet holder restaurant",
  ],
  "secure tablet mounts for retail kiosks": [
    "secure tablet mounts for retail kiosks",
    "retail kiosk tablet security",
    "locking customer check-in tablet",
    "fixed tablet stand retail counter",
  ],
  "locking ELD tablet mounts": [
    "locking ELD tablet mounts",
    "shared fleet tablet security",
    "keyed ELD tablet holder",
    "tamper-resistant truck tablet mount",
  ],
  "locking forklift tablet mounts": [
    "locking forklift tablet mounts",
    "warehouse tablet theft deterrence",
    "forklift tablet key control",
    "secure forklift pillar tablet mount",
  ],
  "locking tablet mounts for industrial workstations": [
    "locking tablet mounts for industrial workstations",
    "secure workbench tablet mount",
    "shared tablet device custody",
    "tamper-resistant tablet mount for cart",
  ],
};

const heroAssets: Record<string, {
  id: string;
  filename: string;
  productSku: string;
  altText: string;
  caption: string;
  qualityScore: number;
  verticalRelevance: string[];
  qaNotes: string;
}> = {
  "locking-pos-mounts-prevent-tablet-theft": {
    id: "eee40db6-910d-44a6-94e5-463653196bb8",
    filename: "restaurant-pos-locking-tablet-hero.png",
    productSku: "IBRT-34719",
    altText: "Locking iBOLT style POS tablet stand on a restaurant counter with a manager-controlled key",
    caption: "Restaurant POS locking-tablet editorial B-roll based on iBOLT IBRT-34719.",
    qualityScore: 0.95,
    verticalRelevance: ["restaurants-food-delivery", "retail-kiosk-public-security"],
    qaNotes: "PASS: product-informed weighted L-base, compact arm, credible counter placement, no theft scene.",
  },
  "secure-tablets-retail-kiosks": {
    id: "6d4a17d0-cab9-4ef7-a32d-0c36de25c13a",
    filename: "retail-kiosk-locking-tablet-hero.png",
    productSku: "IBRT-34717",
    altText: "Key-controlled locking tablet stand fixed to a retail kiosk counter",
    caption: "Retail kiosk locking-tablet editorial B-roll based on iBOLT IBRT-34717.",
    qualityScore: 0.94,
    verticalRelevance: ["retail-kiosk-public-security"],
    qaNotes: "PASS: metal holder, fixed square base, controlled key interaction, no unsafe attachment.",
  },
  "locking-eld-mounts-shared-fleet-tablets": {
    id: "f020ed46-08f5-4cea-a0ee-3e13ec5b5273",
    filename: "shared-fleet-locking-tablet-hero.png",
    productSku: "IBBZ-33993",
    altText: "Compact locking iBOLT style ELD tablet mount installed below the windshield in a parked fleet van",
    caption: "Shared-fleet locking-tablet editorial B-roll based on iBOLT IBBZ-33993.",
    qualityScore: 0.94,
    verticalRelevance: ["trucking-fleet"],
    qaNotes: "PASS after revision: tablet below windshield, controls clear, short AMPS assembly, single key interaction.",
  },
  "locking-forklift-tablet-mount-device-security": {
    id: "7e609a3a-dea6-4bc9-af87-168e8c0feaf8",
    filename: "forklift-locking-tablet-hero.png",
    productSku: "IBFL-34591",
    altText: "Supervisor using the side lock on an iBOLT style forklift tablet mount before a warehouse shift",
    caption: "Forklift locking-tablet editorial B-roll based on iBOLT IBFL-34591.",
    qualityScore: 0.93,
    verticalRelevance: ["forklifts-warehousing"],
    qaNotes: "PASS after revision: one key at the real side cylinder, pillar plates visible, parked vehicle, controls clear.",
  },
  "secure-tablets-industrial-workstations": {
    id: "3c6419e3-e678-4692-b6c5-e89f5802992d",
    filename: "industrial-workstation-locking-tablet-hero.png",
    productSku: "IBBZ-33779",
    altText: "Key-controlled locking iBOLT style tablet mount fixed to an industrial quality workstation",
    caption: "Industrial workstation locking-tablet editorial B-roll based on iBOLT IBBZ-33779.",
    qualityScore: 0.95,
    verticalRelevance: ["construction-field-service", "multi-device-workstations"],
    qaNotes: "PASS after revision: compact AMPS geometry, fixed bench base, one key, no paper text or tall pole.",
  },
};

function parseDraft(filename: string, raw: string): ArticleDraft {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error(`${filename} is missing frontmatter`);
  const values: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const splitAt = line.indexOf(":");
    if (splitAt < 0) continue;
    values[line.slice(0, splitAt).trim()] = line.slice(splitAt + 1).trim();
  }
  for (const key of ["title", "slug", "metaTitle", "metaDescription", "primaryKeyword", "verticalId", "heroPhotoId"]) {
    if (!values[key]) throw new Error(`${filename} is missing ${key}`);
  }
  return {
    filename,
    meta: values as unknown as ArticleMeta,
    markdown: raw.slice(match[0].length).trim(),
  };
}

function countWords(markdown: string): number {
  const text = markdown
    .replace(/<[^>]+>/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_>|]/g, " ");
  return (text.match(/\b[A-Za-z0-9][A-Za-z0-9'-]*\b/g) || []).length;
}

async function ensureCluster(primaryKeyword: string, verticalId: string) {
  const existing = await db.select().from(keywordClusters).where(and(
    eq(keywordClusters.companyId, COMPANY_ID),
    eq(keywordClusters.primaryKeyword, primaryKeyword),
  )).limit(1);
  if (existing[0]) return existing[0];
  const [created] = await db.insert(keywordClusters).values({
    companyId: COMPANY_ID,
    name: primaryKeyword,
    primaryKeyword,
    verticalId,
    totalVolume: 0,
    avgDifficulty: 0,
    priority: 55,
    status: "generated",
  }).returning();
  return created;
}

async function ensureKeywords(importId: string, clusterId: string, terms: string[]) {
  let inserted = 0;
  let reused = 0;
  for (const keyword of terms) {
    const existing = await db.select().from(keywords).where(and(
      eq(keywords.companyId, COMPANY_ID),
      eq(keywords.keyword, keyword),
    )).limit(1);
    if (existing[0]) {
      await db.update(keywords).set({ clusterId, status: "generated" }).where(eq(keywords.id, existing[0].id));
      reused++;
    } else {
      await db.insert(keywords).values({
        companyId: COMPANY_ID,
        keyword,
        volume: 0,
        difficulty: 0,
        cpc: 0,
        opportunityScore: 0,
        status: "generated",
        clusterId,
        importId,
      });
      inserted++;
    }
  }
  return { inserted, reused };
}

async function main() {
  const verifier = JSON.parse(await readFile(VERIFIER_PATH, "utf8")) as { passed: boolean; results: VerifierEntry[] };
  if (!verifier.passed || verifier.results.length !== 5) throw new Error("A passing five-article verifier report is required before import.");
  const verifierBySlug = new Map(verifier.results.map((entry) => [entry.slug, entry]));

  const filenames = (await readdir(SERIES_DIR)).filter((name) => /^0[1-5]-.*\.md$/.test(name)).sort();
  if (filenames.length !== 5) throw new Error(`Expected 5 drafts, found ${filenames.length}`);
  const drafts = await Promise.all(filenames.map(async (filename) => parseDraft(filename, await readFile(join(SERIES_DIR, filename), "utf8"))));

  const catalog = await db.select().from(products).where(eq(products.companyId, COMPANY_ID));
  const productBySku = new Map(catalog.filter((product) => product.sku).map((product) => [product.sku!, product]));
  for (const skus of Object.values(articleProducts)) {
    for (const sku of skus) if (!productBySku.has(sku)) throw new Error(`Missing catalog product ${sku}`);
  }

  for (const draft of drafts) {
    const verification = verifierBySlug.get(draft.meta.slug);
    if (!verification?.verification.passesQualityGate) throw new Error(`Missing passing verification for ${draft.meta.slug}`);
    const lint = lintContent({
      markdown: draft.markdown,
      title: draft.meta.title,
      metaTitle: draft.meta.metaTitle,
      metaDescription: draft.meta.metaDescription,
      primaryKeyword: draft.meta.primaryKeyword,
      products: catalog.map((product) => ({
        title: product.title,
        handle: product.handle,
        price: product.price ? Number(product.price) : null,
      })),
    });
    if (!lint.passed || lint.warnings.length > 0) throw new Error(`Lint failed for ${draft.filename}: ${JSON.stringify(lint)}`);
    const words = countWords(draft.markdown);
    if (words < 800 || words > 1400) throw new Error(`${draft.filename} has ${words} words; expected 800 to 1400.`);
  }

  for (const draft of drafts) {
    const asset = heroAssets[draft.meta.slug];
    if (!asset || asset.id !== draft.meta.heroPhotoId) throw new Error(`Hero metadata mismatch for ${draft.meta.slug}`);
    const product = productBySku.get(asset.productSku)!;
    const filePath = join(SERIES_DIR, "assets", asset.filename);
    const file = await stat(filePath);
    const existing = await db.select().from(productPhotos).where(and(
      eq(productPhotos.companyId, COMPANY_ID),
      eq(productPhotos.id, asset.id),
    )).limit(1);
    const values = {
      productId: product.id,
      filename: asset.filename,
      originalFilename: asset.filename,
      mimeType: "image/png",
      fileSize: file.size,
      filePath,
      thumbnailPath: null,
      width: 1536,
      height: 1024,
      assetStatus: "approved",
      rightsStatus: "owned",
      usageRestrictions: "Editorial B-roll. Official product photos in the article remain definitive for product details.",
      useCases: ["blog hero", "editorial b-roll", "Shopify article"],
      altText: asset.altText,
      caption: asset.caption,
      notes: asset.qaNotes,
      sourceType: "manual",
      sourceUrl: null,
      angleType: "in-use",
      contextType: "lifestyle",
      settingDescription: asset.caption,
      qualityScore: asset.qualityScore,
      isHero: true,
      verticalRelevance: asset.verticalRelevance,
      aiAnalysis: JSON.stringify({ verifier: asset.qaNotes, score: Math.round(asset.qualityScore * 100) }),
      analyzedAt: new Date(),
    } as const;
    if (existing[0]) {
      await db.update(productPhotos).set(values).where(eq(productPhotos.id, asset.id));
    } else {
      await db.insert(productPhotos).values({ id: asset.id, companyId: COMPANY_ID, ...values });
    }
  }

  const [batch] = await db.insert(generationBatches).values({
    companyId: COMPANY_ID,
    name: "Locking Tablet Security Series 2026-08-26",
    totalPosts: drafts.length,
    completedPosts: drafts.length,
    failedPosts: 0,
    status: "completed",
    startedAt: new Date(),
    completedAt: new Date(),
  }).returning();

  const keywordTerms = Object.values(keywordPlan).flat();
  const [keywordImport] = await db.insert(keywordImports).values({
    companyId: COMPANY_ID,
    filename: "manual-locking-tablet-security-series-2026-08-26.csv",
    totalKeywords: keywordTerms.length,
    newKeywords: 0,
    duplicateKeywords: 0,
  }).returning();

  let newKeywords = 0;
  let duplicateKeywords = 0;
  const clusterByPrimary = new Map<string, string>();
  for (const draft of drafts) {
    const cluster = await ensureCluster(draft.meta.primaryKeyword, draft.meta.verticalId);
    clusterByPrimary.set(draft.meta.primaryKeyword, cluster.id);
    const result = await ensureKeywords(keywordImport.id, cluster.id, keywordPlan[draft.meta.primaryKeyword] || [draft.meta.primaryKeyword]);
    newKeywords += result.inserted;
    duplicateKeywords += result.reused;
  }
  await db.update(keywordImports).set({ newKeywords, duplicateKeywords }).where(eq(keywordImports.id, keywordImport.id));

  await mkdir(HTML_DIR, { recursive: true });
  await mkdir(PREVIEW_DIR, { recursive: true });
  const companyContext = await getCompanyContext(COMPANY_ID);
  const manifest: Array<Record<string, unknown>> = [];

  for (const draft of drafts) {
    const verification = verifierBySlug.get(draft.meta.slug)!;
    const clusterId = clusterByPrimary.get(draft.meta.primaryKeyword)!;
    const existing = await db.select().from(blogPosts).where(and(
      eq(blogPosts.companyId, COMPANY_ID),
      eq(blogPosts.slug, draft.meta.slug),
    )).limit(1);
    if (existing[0]?.shopifyArticleId || existing[0]?.status === "published") {
      throw new Error(`Refusing to overwrite Shopify-synced or published post ${draft.meta.slug}`);
    }

    const verifierGeneration = verification.generation[0] || {};
    const values = {
      title: draft.meta.title,
      slug: draft.meta.slug,
      metaTitle: draft.meta.metaTitle,
      metaDescription: draft.meta.metaDescription,
      markdown: draft.markdown,
      clusterId,
      verticalId: draft.meta.verticalId,
      batchId: batch.id,
      status: "review",
      wordCount: countWords(draft.markdown),
      brandConsistency: verification.verification.brandConsistency,
      seoOptimization: verification.verification.seoOptimization,
      naturalLanguage: verification.verification.naturalLanguage,
      factualAccuracy: verification.verification.factualAccuracy,
      overallScore: verification.verification.overallScore,
      verificationNotes: JSON.stringify({
        method: "iBoltmark deterministic lint plus AI verifier plus visual B-roll verifier",
        deterministicLint: verification.lint,
        aiVerifier: verification.verification,
        aiVerifierProvider: verifierGeneration.provider,
        aiVerifierModel: verifierGeneration.model,
        researchSummary: join(SERIES_DIR, "RESEARCH_SUMMARY.md"),
        imageManifest: join(SERIES_DIR, "IMAGE_MANIFEST.md"),
        claimBoundary: "Deter unauthorized removal; never claim theft-proof or guaranteed prevention.",
      }),
      generationProvider: `codex-desktop+${verifierGeneration.provider || "anthropic"}`,
      generationModel: `gpt-5+${verifierGeneration.model || "claude-sonnet-4-6"}`,
      updatedAt: new Date(),
    } as const;

    let post;
    if (existing[0]) {
      [post] = await db.update(blogPosts).set(values).where(eq(blogPosts.id, existing[0].id)).returning();
      await db.delete(blogPostProducts).where(eq(blogPostProducts.blogPostId, post.id));
      await db.delete(blogPostPhotos).where(eq(blogPostPhotos.blogPostId, post.id));
    } else {
      [post] = await db.insert(blogPosts).values({ companyId: COMPANY_ID, ...values }).returning();
    }

    for (const sku of articleProducts[draft.meta.slug]) {
      const product = productBySku.get(sku)!;
      await db.insert(blogPostProducts).values({
        companyId: COMPANY_ID,
        blogPostId: post.id,
        productId: product.id,
        mentionContext: `${sku} evaluated in ${draft.meta.title}`,
      });
    }
    const hero = heroAssets[draft.meta.slug];
    await db.insert(blogPostPhotos).values({
      companyId: COMPANY_ID,
      blogPostId: post.id,
      photoId: hero.id,
      sectionIndex: null,
      placement: "hero",
      altText: hero.altText,
      caption: hero.caption,
      selectionReason: "Purpose-generated and visually verified product-informed hero for this security scenario.",
    });

    const html = await renderShopifyHtml(post, companyContext);
    const preview = await renderPreviewHtml(post, companyContext);
    [post] = await db.update(blogPosts).set({ html, updatedAt: new Date() }).where(eq(blogPosts.id, post.id)).returning();
    const htmlPath = join(HTML_DIR, `${post.slug}.shopify.html`);
    const previewPath = join(PREVIEW_DIR, `${post.slug}.preview.html`);
    await writeFile(htmlPath, html, "utf8");
    await writeFile(previewPath, preview, "utf8");

    manifest.push({
      id: post.id,
      title: post.title,
      slug: post.slug,
      status: post.status,
      wordCount: post.wordCount,
      scores: {
        brandConsistency: post.brandConsistency,
        seoOptimization: post.seoOptimization,
        naturalLanguage: post.naturalLanguage,
        factualAccuracy: post.factualAccuracy,
        overall: post.overallScore,
      },
      productSkus: articleProducts[draft.meta.slug],
      heroPhotoId: hero.id,
      heroAsset: join(SERIES_DIR, "assets", hero.filename),
      markdownPath: join(SERIES_DIR, draft.filename),
      htmlPath,
      previewPath,
      shopifyArticleId: post.shopifyArticleId,
    });
  }

  const manifestPath = join(SERIES_DIR, "shopify-review", "review-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify({
    companyId: COMPANY_ID,
    batchId: batch.id,
    keywordImportId: keywordImport.id,
    generatedAt: new Date().toISOString(),
    shopifyPublished: false,
    posts: manifest,
  }, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    batchId: batch.id,
    keywordImportId: keywordImport.id,
    newKeywords,
    duplicateKeywords,
    posts: manifest,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
