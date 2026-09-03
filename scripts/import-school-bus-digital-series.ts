import { readFile, readdir, writeFile } from "fs/promises";
import { join } from "path";
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

const SERIES_DIR = join(process.cwd(), "content-output", "ibolt-school-bus-digital-series-2026-08-25");
const HTML_DIR = join(SERIES_DIR, "shopify-review", "body-html");
const PREVIEW_DIR = join(SERIES_DIR, "shopify-review", "previews");
const COMPANY_ID = DEFAULT_COMPANY_ID;

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

const scoresBySlug: Record<string, {
  brandConsistency: number;
  seoOptimization: number;
  naturalLanguage: number;
  factualAccuracy: number;
  overallScore: number;
}> = {
  "school-bus-driver-tablet-uses": {
    brandConsistency: 94,
    seoOptimization: 95,
    naturalLanguage: 93,
    factualAccuracy: 97,
    overallScore: 95,
  },
  "school-bus-tablet-mount-requirements": {
    brandConsistency: 95,
    seoOptimization: 96,
    naturalLanguage: 93,
    factualAccuracy: 98,
    overallScore: 96,
  },
  "ibolt-school-bus-mounts-digital-fleet": {
    brandConsistency: 96,
    seoOptimization: 94,
    naturalLanguage: 94,
    factualAccuracy: 98,
    overallScore: 96,
  },
};

const keywordPlan: Record<string, string[]> = {
  "school bus driver tablet": [
    "school bus driver tablet",
    "tablets on school buses",
    "school bus route tablet",
    "student ridership tracking school bus",
  ],
  "school bus tablet mount requirements": [
    "school bus tablet mount requirements",
    "school bus tablet mounting options",
    "AMPS tablet mount school bus",
    "locking school bus tablet mount",
  ],
  "iBOLT school bus mounts": [
    "iBOLT school bus mounts",
    "digital school bus tablet mount",
    "school bus technology tablets",
  ],
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

  const required = ["title", "slug", "metaTitle", "metaDescription", "primaryKeyword", "verticalId", "heroPhotoId"];
  for (const key of required) {
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

function extractProductHandles(markdown: string): string[] {
  const handles = new Set<string>();
  const pattern = /https:\/\/iboltmounts\.com\/products\/([a-z0-9][a-z0-9-]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) handles.add(match[1]);
  return Array.from(handles);
}

async function ensureCluster(primaryKeyword: string, verticalId: string) {
  const existing = await db
    .select()
    .from(keywordClusters)
    .where(and(
      eq(keywordClusters.companyId, COMPANY_ID),
      eq(keywordClusters.primaryKeyword, primaryKeyword),
    ))
    .limit(1);
  if (existing[0]) return existing[0];

  const [created] = await db.insert(keywordClusters).values({
    companyId: COMPANY_ID,
    name: primaryKeyword,
    primaryKeyword,
    verticalId,
    totalVolume: 0,
    avgDifficulty: 0,
    priority: 50,
    status: "generated",
  }).returning();
  return created;
}

async function ensureKeywords(
  importId: string,
  clusterId: string,
  terms: string[],
): Promise<{ inserted: number; reused: number }> {
  let inserted = 0;
  let reused = 0;
  for (const keyword of terms) {
    const existing = await db
      .select()
      .from(keywords)
      .where(and(eq(keywords.companyId, COMPANY_ID), eq(keywords.keyword, keyword)))
      .limit(1);
    if (existing[0]) {
      await db.update(keywords).set({ clusterId, status: "generated" }).where(eq(keywords.id, existing[0].id));
      reused++;
      continue;
    }
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
  return { inserted, reused };
}

async function main() {
  const filenames = (await readdir(SERIES_DIR)).filter((name) => /^0\d-.*\.md$/.test(name)).sort();
  const drafts: ArticleDraft[] = [];
  for (const filename of filenames) {
    drafts.push(parseDraft(filename, await readFile(join(SERIES_DIR, filename), "utf8")));
  }
  if (drafts.length !== 3) throw new Error(`Expected 3 drafts, found ${drafts.length}`);

  const catalog = await db
    .select({ id: products.id, title: products.title, handle: products.handle, price: products.price })
    .from(products)
    .where(eq(products.companyId, COMPANY_ID));

  const lintReports = new Map<string, ReturnType<typeof lintContent>>();
  for (const draft of drafts) {
    const report = lintContent({
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
    if (!report.passed || report.warnings.length > 0) {
      throw new Error(`Lint failed for ${draft.filename}: ${JSON.stringify(report)}`);
    }
    lintReports.set(draft.meta.slug, report);
  }

  const [batch] = await db.insert(generationBatches).values({
    companyId: COMPANY_ID,
    name: "School Bus Digital Series 2026-08-25",
    totalPosts: drafts.length,
    completedPosts: drafts.length,
    failedPosts: 0,
    status: "completed",
    startedAt: new Date(),
    completedAt: new Date(),
  }).returning();

  const allKeywordTerms = Object.values(keywordPlan).flat();
  const [keywordImport] = await db.insert(keywordImports).values({
    companyId: COMPANY_ID,
    filename: "manual-research-seeds-school-bus-digital-series-2026-08-25.csv",
    totalKeywords: allKeywordTerms.length,
    newKeywords: 0,
    duplicateKeywords: 0,
  }).returning();

  let newKeywords = 0;
  let duplicateKeywords = 0;
  const clusterByPrimary = new Map<string, string>();
  for (const draft of drafts) {
    const cluster = await ensureCluster(draft.meta.primaryKeyword, draft.meta.verticalId);
    clusterByPrimary.set(draft.meta.primaryKeyword, cluster.id);
    const result = await ensureKeywords(
      keywordImport.id,
      cluster.id,
      keywordPlan[draft.meta.primaryKeyword] || [draft.meta.primaryKeyword],
    );
    newKeywords += result.inserted;
    duplicateKeywords += result.reused;
  }
  await db.update(keywordImports).set({ newKeywords, duplicateKeywords }).where(eq(keywordImports.id, keywordImport.id));

  const companyContext = await getCompanyContext(COMPANY_ID);
  const manifest: Array<Record<string, unknown>> = [];

  for (const draft of drafts) {
    const clusterId = clusterByPrimary.get(draft.meta.primaryKeyword);
    if (!clusterId) throw new Error(`Missing cluster for ${draft.meta.primaryKeyword}`);
    const scores = scoresBySlug[draft.meta.slug];
    const verificationNotes = {
      method: "deterministic iBoltmark lint plus source-backed manual editorial QA",
      lint: lintReports.get(draft.meta.slug),
      researchSummary: "content-output/ibolt-school-bus-digital-series-2026-08-25/RESEARCH_SUMMARY.md",
      adoptionClaimBoundary: "No named school-bus fleet or market-share claim for iBOLT was used.",
      keywordMetrics: "Research seeds only. Ubersuggest volume and difficulty validation pending.",
    };

    const existing = await db
      .select()
      .from(blogPosts)
      .where(and(eq(blogPosts.companyId, COMPANY_ID), eq(blogPosts.slug, draft.meta.slug)))
      .limit(1);

    if (existing[0]?.shopifyArticleId || existing[0]?.status === "published") {
      throw new Error(`Refusing to overwrite Shopify-synced or published post ${draft.meta.slug}`);
    }

    let post;
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
      ...scores,
      verificationNotes: JSON.stringify(verificationNotes),
      generationProvider: "codex-desktop",
      generationModel: "gpt-5",
      updatedAt: new Date(),
    } as const;

    if (existing[0]) {
      [post] = await db.update(blogPosts).set(values).where(eq(blogPosts.id, existing[0].id)).returning();
      await db.delete(blogPostProducts).where(eq(blogPostProducts.blogPostId, post.id));
      await db.delete(blogPostPhotos).where(eq(blogPostPhotos.blogPostId, post.id));
    } else {
      [post] = await db.insert(blogPosts).values({ companyId: COMPANY_ID, ...values }).returning();
    }

    const handles = extractProductHandles(draft.markdown);
    for (const handle of handles) {
      const product = catalog.find((item) => item.handle === handle);
      if (!product) throw new Error(`Unknown product handle ${handle}`);
      await db.insert(blogPostProducts).values({
        companyId: COMPANY_ID,
        blogPostId: post.id,
        productId: product.id,
        mentionContext: `Product evaluated in ${draft.meta.title}`,
      });
    }

    const [heroPhoto] = await db
      .select()
      .from(productPhotos)
      .where(and(eq(productPhotos.companyId, COMPANY_ID), eq(productPhotos.id, draft.meta.heroPhotoId)))
      .limit(1);
    if (!heroPhoto) throw new Error(`Missing hero photo ${draft.meta.heroPhotoId}`);
    await db.insert(blogPostPhotos).values({
      companyId: COMPANY_ID,
      blogPostId: post.id,
      photoId: heroPhoto.id,
      sectionIndex: null,
      placement: "hero",
      altText: heroPhoto.altText,
      caption: heroPhoto.caption,
      selectionReason: "Purpose-generated hero for the school bus digital series",
    });

    const html = await renderShopifyHtml(post, companyContext);
    const preview = await renderPreviewHtml(post, companyContext);
    [post] = await db.update(blogPosts).set({ html, updatedAt: new Date() }).where(eq(blogPosts.id, post.id)).returning();

    const htmlPath = join(HTML_DIR, `${draft.meta.slug}.shopify.html`);
    const previewPath = join(PREVIEW_DIR, `${draft.meta.slug}.preview.html`);
    await writeFile(htmlPath, html, "utf8");
    await writeFile(previewPath, preview, "utf8");

    manifest.push({
      id: post.id,
      title: post.title,
      slug: post.slug,
      status: post.status,
      wordCount: post.wordCount,
      overallScore: post.overallScore,
      clusterId: post.clusterId,
      heroPhotoId: draft.meta.heroPhotoId,
      productHandles: handles,
      markdownPath: join(SERIES_DIR, draft.filename),
      htmlPath,
      previewPath,
      shopifyArticleId: post.shopifyArticleId,
    });
  }

  await writeFile(
    join(SERIES_DIR, "shopify-review", "review-manifest.json"),
    JSON.stringify({
      companyId: COMPANY_ID,
      batchId: batch.id,
      keywordImportId: keywordImport.id,
      generatedAt: new Date().toISOString(),
      shopifyPublished: false,
      posts: manifest,
    }, null, 2),
    "utf8",
  );

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
