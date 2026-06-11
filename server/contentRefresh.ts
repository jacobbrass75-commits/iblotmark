import { and, asc, eq, isNotNull, lt } from "drizzle-orm";
import { db } from "./db";
import { blogPosts, products, type BlogPost, type Product } from "@shared/schema";
import {
  buildProductFactsForVerifier,
  formatProductsForPrompt,
  generateText,
  getClusterData,
  productsForLint,
  runVerifier,
  type BlogPlan,
} from "./blogPipeline";
import { buildStitcherPrompt, type BrandVoiceInput } from "./brandVoice";
import { lintContent, type LintReport } from "./contentLinter";
import { getCompanyContext } from "./companyContext";
import { renderShopifyHtml } from "./htmlRenderer";
import { syncBlogPostToShopify } from "./shopifyPublisher";

export interface RefreshResult {
  postId: string;
  refreshed: boolean;
  skipped: boolean;
  reason?: string;
  previousScore: number;
  newScore?: number;
  lint?: LintReport;
  sync?: Awaited<ReturnType<typeof syncBlogPostToShopify>>;
}

function parseNotes(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return { previousNotes: value };
  }
}

function makeRefreshPlan(post: BlogPost, primaryKeyword: string, secondaryKeywords: string[]): BlogPlan {
  return {
    title: post.title,
    metaTitle: post.metaTitle || post.title,
    metaDescription: post.metaDescription || "",
    slug: post.slug,
    sections: [],
    primaryKeyword,
    secondaryKeywords,
    estimatedWordCount: post.wordCount || 0,
  };
}

async function loadProductsForPost(post: BlogPost, companyId: string): Promise<{
  relevantProducts: Product[];
  catalogProducts: Product[];
  primaryKeyword: string;
  secondaryKeywords: string[];
}> {
  const catalogProducts = await db.select().from(products).where(eq(products.companyId, companyId));
  if (!post.clusterId) {
    return {
      relevantProducts: catalogProducts,
      catalogProducts,
      primaryKeyword: post.title,
      secondaryKeywords: [],
    };
  }

  const clusterData = await getClusterData(post.clusterId, companyId);
  return {
    relevantProducts: clusterData.relevantProducts.length > 0 ? clusterData.relevantProducts : catalogProducts,
    catalogProducts,
    primaryKeyword: clusterData.cluster.primaryKeyword,
    secondaryKeywords: clusterData.clusterKeywords.map((keyword) => keyword.keyword),
  };
}

export async function selectContentRefreshCandidates(
  companyId: string,
  limit: number,
  refreshAgeDays: number,
): Promise<BlogPost[]> {
  const cutoff = new Date(Date.now() - Math.max(1, refreshAgeDays) * 24 * 60 * 60 * 1000);
  return db
    .select()
    .from(blogPosts)
    .where(and(
      eq(blogPosts.companyId, companyId),
      isNotNull(blogPosts.shopifyArticleId),
      lt(blogPosts.updatedAt, cutoff),
    ))
    .orderBy(asc(blogPosts.updatedAt))
    .limit(Math.max(1, limit));
}

export async function refreshPublishedPost(postId: string, companyId?: string): Promise<RefreshResult> {
  const companyContext = await getCompanyContext(companyId);
  const [post] = await db
    .select()
    .from(blogPosts)
    .where(and(eq(blogPosts.companyId, companyContext.company.id), eq(blogPosts.id, postId)))
    .limit(1);

  if (!post) {
    throw new Error("Blog post not found");
  }

  const previousScore = post.overallScore || 0;
  if (!post.shopifyArticleId) {
    return {
      postId,
      refreshed: false,
      skipped: true,
      reason: "Post is not synced to Shopify yet.",
      previousScore,
    };
  }
  if (!post.markdown?.trim()) {
    return {
      postId,
      refreshed: false,
      skipped: true,
      reason: "Post has no markdown content to refresh.",
      previousScore,
    };
  }

  const brandProfile = companyContext.brandProfile as BrandVoiceInput;
  const { relevantProducts, catalogProducts, primaryKeyword, secondaryKeywords } = await loadProductsForPost(post, companyContext.company.id);
  const productContext = formatProductsForPrompt(relevantProducts, brandProfile);
  const currentYear = new Date().getFullYear();

  const revisedMarkdown = await generateText(
    buildStitcherPrompt(brandProfile),
    [
      "Update this published post: refresh any dates/years to current, correct any product names/prices/links against the catalog below, improve clarity.",
      "Do not change the structure, headings, or core content. Return complete markdown.",
      "",
      `Current year: ${currentYear}`,
      `Title: ${post.title}`,
      `Primary keyword: ${primaryKeyword}`,
      "",
      "Catalog:",
      productContext,
      "",
      "Existing markdown:",
      post.markdown,
    ].join("\n"),
    8192,
    0.2,
    "content refresh",
  );

  const lint = lintContent({
    markdown: revisedMarkdown,
    title: post.title,
    metaTitle: post.metaTitle || post.title,
    metaDescription: post.metaDescription || "",
    primaryKeyword,
    products: productsForLint(catalogProducts),
  });

  const plan = makeRefreshPlan(post, primaryKeyword, secondaryKeywords);
  const verification = await runVerifier(
    plan,
    revisedMarkdown,
    buildProductFactsForVerifier(relevantProducts, brandProfile),
    brandProfile,
  );

  if (!lint.passed) {
    return {
      postId,
      refreshed: false,
      skipped: true,
      reason: "Refresh skipped because lint failed.",
      previousScore,
      newScore: verification.overallScore,
      lint,
    };
  }

  if (!verification.passesQualityGate || verification.overallScore < previousScore) {
    return {
      postId,
      refreshed: false,
      skipped: true,
      reason: "Refresh skipped because quality regressed or did not pass the gate.",
      previousScore,
      newScore: verification.overallScore,
      lint,
    };
  }

  const updatedPost: BlogPost = {
    ...post,
    markdown: revisedMarkdown,
    brandConsistency: verification.brandConsistency,
    seoOptimization: verification.seoOptimization,
    naturalLanguage: verification.naturalLanguage,
    factualAccuracy: verification.factualAccuracy,
    overallScore: verification.overallScore,
    verificationNotes: JSON.stringify({
      ...parseNotes(post.verificationNotes),
      refresh: {
        refreshedAt: new Date().toISOString(),
        previousScore,
        newScore: verification.overallScore,
        lint,
        verification,
      },
    }),
    updatedAt: new Date(),
  };
  const html = await renderShopifyHtml(updatedPost, companyContext);

  await db
    .update(blogPosts)
    .set({
      markdown: revisedMarkdown,
      html,
      brandConsistency: verification.brandConsistency,
      seoOptimization: verification.seoOptimization,
      naturalLanguage: verification.naturalLanguage,
      factualAccuracy: verification.factualAccuracy,
      overallScore: verification.overallScore,
      verificationNotes: updatedPost.verificationNotes,
      updatedAt: new Date(),
    })
    .where(and(eq(blogPosts.companyId, companyContext.company.id), eq(blogPosts.id, postId)));

  const sync = await syncBlogPostToShopify(postId, post.shopifyBlogId || undefined, companyContext.company.id);

  return {
    postId,
    refreshed: true,
    skipped: false,
    previousScore,
    newScore: verification.overallScore,
    lint,
    sync,
  };
}
