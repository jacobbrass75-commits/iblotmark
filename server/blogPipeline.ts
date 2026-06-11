// iBolt Blog Pipeline — 4-Phase Generation Engine
// Planner → Section Writer → Stitcher → Verifier
// Adapted from writingPipeline.ts for SEO blog generation.

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { db } from "./db";
import { and, eq } from "drizzle-orm";
import {
  blogPosts,
  blogPostProducts,
  keywordClusters,
  keywords,
  industryVerticals,
  products,
  productVerticals,
  type KeywordCluster,
  type Keyword,
  type IndustryVertical,
  type Product,
  type BlogPost,
} from "@shared/schema";
import {
  buildPlannerPrompt,
  buildSectionWriterPrompt,
  buildStitcherPrompt,
  buildVerifierPrompt,
  buildProductUrl,
  resolveBrandVoice,
  type BrandVoiceInput,
} from "./brandVoice";
import { anthropicLimiter } from "./apiCache";
import { formatContextForPrompt } from "./contextBanks";
import { buildSectionContext, compactContext, TOKEN_BUDGETS } from "./contextChunker";
import { selectPhotosForPost, savePhotoSelections, formatPhotoPlacementsForPrompt, type PhotoSelection } from "./photoSelector";
import { getCompanyContext } from "./companyContext";
import { lintContent, type LintReport } from "./contentLinter";

// --- Types ---

export interface BlogGenerationRequest {
  clusterId: string;
  batchId?: string;
  companyId?: string;
}

export interface BlogPlan {
  title: string;
  metaTitle: string;
  metaDescription: string;
  slug: string;
  sections: BlogPlanSection[];
  primaryKeyword: string;
  secondaryKeywords: string[];
  estimatedWordCount: number;
}

export interface BlogPlanSection {
  title: string;
  description: string;
  keywords: string[];
  productMentions: string[];
  targetWords: number;
}

export interface VerificationResult {
  brandConsistency: number;
  seoOptimization: number;
  naturalLanguage: number;
  factualAccuracy: number;
  overallScore: number;
  issues: string[];
  suggestions: string[];
  passesQualityGate: boolean;
}

export interface BlogSSEEvent {
  type: "status" | "plan" | "section" | "stitched" | "verified" | "complete" | "error";
  phase?: string;
  message?: string;
  plan?: BlogPlan;
  sectionIndex?: number;
  sectionTitle?: string;
  sectionContent?: string;
  markdown?: string;
  verification?: VerificationResult;
  lint?: LintReport;
  blogPost?: BlogPost;
  error?: string;
}

interface GenerationMetadata {
  provider: "anthropic" | "openai";
  model: string;
  phase: string;
  fallback: boolean;
}

type GenerationRecorder = (metadata: GenerationMetadata) => void;

// --- Helpers ---

const ANTHROPIC_MODEL = process.env.BLOG_ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
const OPENAI_MODEL = process.env.BLOG_OPENAI_MODEL || "gpt-4.1-mini";

let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

function extractAnthropicText(response: Anthropic.Messages.Message): string {
  return response.content
    .filter((item): item is Anthropic.TextBlock => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

async function generateText(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  temperature = 0.3,
  phase = "generation",
  recordGeneration?: GenerationRecorder,
): Promise<string> {
  const anthropic = getAnthropicClient();
  let lastError: Error | null = null;
  let anthropicFailed = false;

  if (anthropic) {
    try {
      await anthropicLimiter.acquire();
      const response = await anthropic.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });
      recordGeneration?.({
        provider: "anthropic",
        model: ANTHROPIC_MODEL,
        phase,
        fallback: false,
      });
      return extractAnthropicText(response);
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error));
      anthropicFailed = true;
    }
  }

  const openai = getOpenAIClient();
  if (openai) {
    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const text = response.choices[0]?.message?.content?.trim();
    if (!text) {
      throw new Error("OpenAI returned an empty response.");
    }
    recordGeneration?.({
      provider: "openai",
      model: OPENAI_MODEL,
      phase,
      fallback: anthropicFailed,
    });
    return text;
  }

  throw lastError || new Error("No blog-generation provider is configured.");
}

async function generateJson<T>(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  temperature = 0.2,
  phase = "generation",
  recordGeneration?: GenerationRecorder,
): Promise<T> {
  const text = await generateText(systemPrompt, userPrompt, maxTokens, temperature, phase, recordGeneration);
  return JSON.parse(extractJSON(text)) as T;
}

function extractJSON(text: string): string {
  // Strip markdown fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
  // Find the first { or [ and match to the end
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (objMatch) return objMatch[0];
  if (arrMatch) return arrMatch[0];
  return cleaned;
}

function buildProductImageGalleryMarkdown(relevantProducts: Product[], brandProfile?: BrandVoiceInput | null): string {
  const voice = resolveBrandVoice(brandProfile);
  const picks = relevantProducts
    .filter((product) => product.imageUrl && product.handle)
    .slice(0, 3);

  if (picks.length === 0) return "";

  const blocks = picks.map((product) => {
    const price = product.price ? ` - $${product.price}` : "";
    const productUrl = product.url || buildProductUrl(product.handle, brandProfile);
    return `<div style="text-align: center; margin: 20px 0;">
  <a href="${productUrl}">
    <img src="${product.imageUrl}" alt="${product.title} - ${voice.displayName}" style="max-width: 400px; width: 100%; height: auto; border-radius: 8px;" loading="lazy">
  </a>
  <p style="font-size: 14px; color: #666; margin-top: 8px;"><strong>${product.title}</strong>${price}</p>
</div>`;
  });

  return `## Product Options\n\n${blocks.join("\n\n")}`;
}

function injectProductImages(markdown: string, relevantProducts: Product[], brandProfile?: BrandVoiceInput | null): string {
  if (/<img\s/i.test(markdown)) {
    return markdown;
  }

  const gallery = buildProductImageGalleryMarkdown(relevantProducts, brandProfile);
  if (!gallery) {
    return markdown;
  }

  const faqMatch = markdown.match(/^## Frequently Asked Questions/m);
  if (!faqMatch || faqMatch.index === undefined) {
    return `${markdown.trim()}\n\n${gallery}\n`;
  }

  return `${markdown.slice(0, faqMatch.index).trimEnd()}\n\n${gallery}\n\n${markdown.slice(faqMatch.index).trimStart()}`;
}

async function getClusterData(clusterId: string, companyId: string): Promise<{
  cluster: KeywordCluster;
  clusterKeywords: Keyword[];
  vertical: IndustryVertical | null;
  relevantProducts: Product[];
}> {
  const [cluster] = await db
    .select()
    .from(keywordClusters)
    .where(and(eq(keywordClusters.companyId, companyId), eq(keywordClusters.id, clusterId)))
    .limit(1);
  if (!cluster) throw new Error(`Cluster ${clusterId} not found`);

  const clusterKeywords = await db.select().from(keywords).where(and(eq(keywords.companyId, companyId), eq(keywords.clusterId, clusterId)));

  let vertical: IndustryVertical | null = null;
  if (cluster.verticalId) {
    const [v] = await db
      .select()
      .from(industryVerticals)
      .where(and(eq(industryVerticals.companyId, companyId), eq(industryVerticals.id, cluster.verticalId)))
      .limit(1);
    vertical = v || null;
  }

  // Get products for this vertical
  let relevantProducts: Product[] = [];
  if (cluster.verticalId) {
    const pvRows = await db
      .select()
      .from(productVerticals)
      .where(and(eq(productVerticals.companyId, companyId), eq(productVerticals.verticalId, cluster.verticalId)));
    if (pvRows.length > 0) {
      const productIds = pvRows.map((pv) => pv.productId);
      const allProducts = await db.select().from(products).where(eq(products.companyId, companyId));
      relevantProducts = allProducts.filter((p) => productIds.includes(p.id));
    }
  }

  // If no vertical-specific products, rank all products by keyword overlap
  if (relevantProducts.length === 0) {
    const allProducts = await db.select().from(products).where(eq(products.companyId, companyId));
    const queryText = [
      cluster.primaryKeyword,
      cluster.name,
      ...clusterKeywords.map((item) => item.keyword),
    ]
      .join(" ")
      .toLowerCase();

    const tokens = Array.from(new Set(
      queryText
        .split(/[^a-z0-9]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 4),
    ));

    const scoreProduct = (product: Product) => {
      const haystack = [
        product.title,
        product.handle,
        product.description,
        product.productType,
        product.vendor,
        ...(Array.isArray(product.tags) ? product.tags : []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      let score = 0;
      for (const token of tokens) {
        if (haystack.includes(token)) score += 2;
      }
      if (product.imageUrl) score += 1;
      return score;
    };

    relevantProducts = allProducts
      .map((product) => ({ product, score: scoreProduct(product) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map((item) => item.product);
  }

  return { cluster, clusterKeywords, vertical, relevantProducts };
}

function formatProductsForPrompt(prods: Product[], brandProfile?: BrandVoiceInput | null): string {
  const voice = resolveBrandVoice(brandProfile);
  if (prods.length === 0) {
    return `No products are available yet. Write helpful category content for ${voice.displayName} using only verified brand context, customer needs, and non-fabricated examples.`;
  }

  return prods.map((p) => {
    const parts = [`- **${p.title}** (${p.handle})`];
    if (p.price) parts.push(`  Price: $${p.price}`);
    if (p.productType) parts.push(`  Type: ${p.productType}`);
    if (p.description) parts.push(`  ${p.description.slice(0, 200)}`);
    if (p.url) parts.push(`  URL: ${p.url}`);
    if (p.imageUrl) parts.push(`  Image URL: ${p.imageUrl}`);
    return parts.join("\n");
  }).join("\n\n");
}

function parseProductPrice(price: string | null | undefined): number | null {
  if (!price) return null;
  const parsed = Number.parseFloat(price);
  return Number.isFinite(parsed) ? parsed : null;
}

function productsForLint(prods: Product[]): Array<{ title: string; handle: string; price: number | null }> {
  return prods.map((product) => ({
    title: product.title,
    handle: product.handle,
    price: parseProductPrice(product.price),
  }));
}

function formatLintErrorsForPrompt(report: LintReport): string {
  return report.errors.map((issue, index) => {
    const excerpt = issue.excerpt ? `\n   Excerpt: ${issue.excerpt}` : "";
    return `${index + 1}. [${issue.rule}] ${issue.message}${excerpt}`;
  }).join("\n");
}

// --- Phase 1: PLANNER ---

async function runPlanner(
  clusterKeywords: Keyword[],
  industryContext: string,
  productContext: string,
  brandProfile?: BrandVoiceInput | null,
  recordGeneration?: GenerationRecorder,
): Promise<BlogPlan> {
  const kwList = clusterKeywords
    .sort((a, b) => (b.volume || 0) - (a.volume || 0))
    .map((k) => `"${k.keyword}" (vol: ${k.volume}, diff: ${k.difficulty})`)
    .join(", ");

  const systemPrompt = buildPlannerPrompt(industryContext, productContext, brandProfile);

  const parsed = await generateJson<BlogPlan>(
    systemPrompt,
    `Create a blog post outline targeting these keywords: ${kwList}\n\nPrimary keyword should be the highest-volume keyword. Distribute all keywords naturally across sections.`,
    4096,
    0.2,
    "planner",
    recordGeneration,
  );

  if (!parsed.title || !parsed.sections || !Array.isArray(parsed.sections)) {
    throw new Error("Invalid blog plan structure");
  }

  // Ensure reasonable word targets
  const totalTarget = parsed.sections.reduce((sum, s) => sum + (s.targetWords || 200), 0);
  const voice = resolveBrandVoice(brandProfile);
  if (totalTarget < voice.targetWordCount.min) {
    const multiplier = voice.targetWordCount.min / totalTarget;
    parsed.sections.forEach((s) => { s.targetWords = Math.round((s.targetWords || 200) * multiplier); });
  }

  return parsed;
}

// --- Phase 2: SECTION WRITER ---

async function writeSection(
  plan: BlogPlan,
  sectionIndex: number,
  industryContext: string,
  productDetails: string,
  brandProfile?: BrandVoiceInput | null,
  recordGeneration?: GenerationRecorder,
): Promise<string> {
  const section = plan.sections[sectionIndex];

  const systemPrompt = buildSectionWriterPrompt(
    section,
    industryContext,
    productDetails,
    brandProfile,
  );

  return generateText(
    systemPrompt,
    `Write section ${sectionIndex + 1} of ${plan.sections.length}: "${section.title}"\n\nTarget: ~${section.targetWords} words\nBlog title: "${plan.title}"\nPrimary keyword: "${plan.primaryKeyword}"`,
    2048,
    0.5,
    "section writer",
    recordGeneration,
  );
}

// --- Phase 3: STITCHER ---

async function runStitcher(
  plan: BlogPlan,
  sections: string[],
  brandProfile?: BrandVoiceInput | null,
  recordGeneration?: GenerationRecorder,
): Promise<string> {
  const systemPrompt = buildStitcherPrompt(brandProfile);

  const sectionBlock = sections
    .map((content, i) => `--- Section ${i + 1}: ${plan.sections[i]?.title || "Untitled"} ---\n\n${content}`)
    .join("\n\n");

  return generateText(
    systemPrompt,
    `Stitch these ${sections.length} sections into a cohesive blog post.\n\nTitle: "${plan.title}"\nPrimary keyword: "${plan.primaryKeyword}"\nSecondary keywords: ${plan.secondaryKeywords.join(", ")}\n\n${sectionBlock}`,
    8192,
    0.3,
    "stitcher",
    recordGeneration,
  );
}

// --- Phase 4: VERIFIER ---

async function runVerifier(
  plan: BlogPlan,
  markdown: string,
  brandProfile?: BrandVoiceInput | null,
  recordGeneration?: GenerationRecorder,
): Promise<VerificationResult> {
  const systemPrompt = buildVerifierPrompt(brandProfile);

  const parsed = await generateJson<VerificationResult>(
    systemPrompt,
    `Verify this blog post:\n\nTitle: "${plan.title}"\nMeta Title: "${plan.metaTitle}"\nMeta Description: "${plan.metaDescription}"\nPrimary Keyword: "${plan.primaryKeyword}"\nSecondary Keywords: ${plan.secondaryKeywords.join(", ")}\n\n---\n\n${markdown}`,
    2048,
    0.1,
    "verifier",
    recordGeneration,
  );

  // Calculate overall if not provided
  if (!parsed.overallScore) {
    parsed.overallScore = Math.round(
      (parsed.brandConsistency + parsed.seoOptimization + parsed.naturalLanguage + parsed.factualAccuracy) / 4
    );
  }
  parsed.passesQualityGate = parsed.overallScore >= 70;

  return parsed;
}

// --- Main Pipeline ---

/**
 * Run the full 4-phase blog generation pipeline.
 * Emits SSE events via the callback for real-time progress.
 */
export async function runBlogPipeline(
  request: BlogGenerationRequest,
  onEvent: (event: BlogSSEEvent) => void,
): Promise<BlogPost> {
  const companyContext = await getCompanyContext(request.companyId);
  const brandProfile = companyContext.brandProfile;
  const generationEvents: GenerationMetadata[] = [];
  const warnedFallbackPhases = new Set<string>();
  const recordGeneration: GenerationRecorder = (metadata) => {
    generationEvents.push(metadata);
    if (metadata.fallback && !warnedFallbackPhases.has(metadata.phase)) {
      warnedFallbackPhases.add(metadata.phase);
      onEvent({
        type: "status",
        phase: metadata.phase,
        message: `WARNING: provider fallback occurred during ${metadata.phase}`,
      });
    }
  };

  // Load cluster data
  onEvent({ type: "status", phase: "init", message: "Loading cluster data..." });
  const { cluster, clusterKeywords, vertical, relevantProducts } = await getClusterData(request.clusterId, companyContext.company.id);

  // Build context
  const industryContext = vertical
    ? await formatContextForPrompt(vertical.id, companyContext.company.id)
    : `${brandProfile.shortDescription || brandProfile.positioning || companyContext.company.primaryMarket || "General brand and customer context."}`;
  const productContext = formatProductsForPrompt(relevantProducts, brandProfile);
  const lintProducts = productsForLint(await db.select().from(products).where(eq(products.companyId, companyContext.company.id)));
  let plan: BlogPlan;
  let markdown = "";
  let lintReport: LintReport = { errors: [], warnings: [], passed: true };
  let lintCorrectionUsed = false;
  const runLintPass = async (allowCorrection: boolean): Promise<LintReport> => {
    onEvent({ type: "status", phase: "linter", message: "Running deterministic content linter..." });
    let report = lintContent({
      markdown,
      title: plan.title,
      metaTitle: plan.metaTitle,
      metaDescription: plan.metaDescription,
      primaryKeyword: plan.primaryKeyword,
      products: lintProducts,
    });

    onEvent({
      type: "status",
      phase: "linter",
      lint: report,
      message: report.passed
        ? `Lint passed with ${report.warnings.length} warnings.`
        : `Lint found ${report.errors.length} errors and ${report.warnings.length} warnings.`,
    });

    if (report.errors.length > 0 && allowCorrection) {
      lintCorrectionUsed = true;
      onEvent({ type: "status", phase: "linter", message: "Applying one corrective pass for lint errors..." });
      try {
        const correctedMarkdown = await generateText(
          buildStitcherPrompt(brandProfile),
          `Fix exactly the lint errors below without otherwise rewriting the post. Preserve the title, structure, product facts, links, images, and all correct prose. Return the complete corrected markdown only.\n\nLint errors:\n${formatLintErrorsForPrompt(report)}\n\nOriginal post:\n${markdown}`,
          8192,
          0.2,
          "linter",
          recordGeneration,
        );
        markdown = injectProductImages(correctedMarkdown, relevantProducts, brandProfile);
        report = lintContent({
          markdown,
          title: plan.title,
          metaTitle: plan.metaTitle,
          metaDescription: plan.metaDescription,
          primaryKeyword: plan.primaryKeyword,
          products: lintProducts,
        });
        onEvent({
          type: "status",
          phase: "linter",
          lint: report,
          message: report.passed
            ? `Lint passed after correction with ${report.warnings.length} warnings.`
            : `Lint still has ${report.errors.length} errors after correction.`,
        });
      } catch (error: any) {
        onEvent({ type: "status", phase: "linter", message: `Lint correction failed, keeping current draft: ${error.message}` });
      }
    }

    return report;
  };

  // Phase 1: Plan
  onEvent({ type: "status", phase: "planner", message: `Planning blog post for "${cluster.primaryKeyword}"...` });

  try {
    plan = await runPlanner(clusterKeywords, industryContext, productContext, brandProfile, recordGeneration);
    onEvent({ type: "plan", phase: "planner", plan, message: `Plan created: "${plan.title}" with ${plan.sections.length} sections` });
  } catch (err: any) {
    onEvent({ type: "error", error: `Planner failed: ${err.message}` });
    throw err;
  }

  // Photo selection (after plan, before writing)
  let photoSelections: PhotoSelection[] = [];
  try {
    const productIds = relevantProducts.map((p) => p.id);
    photoSelections = await selectPhotosForPost(
      plan,
      vertical?.id || null,
      productIds,
      vertical?.slug || null,
      companyContext.company.id,
      brandProfile.displayName,
    );
    if (photoSelections.length > 0) {
      onEvent({ type: "status", phase: "photos", message: `Selected ${photoSelections.length} photos for post` });
    }
  } catch {
    onEvent({ type: "status", phase: "photos", message: "Photo selection skipped (no analyzed photos)" });
  }

  // Phase 2: Write sections (with per-section context budgets)
  onEvent({ type: "status", phase: "writer", message: `Writing ${plan.sections.length} sections...` });

  const sectionContents: string[] = [];
  for (let i = 0; i < plan.sections.length; i++) {
    const section = plan.sections[i];
    onEvent({ type: "status", phase: "writer", message: `Writing section ${i + 1}/${plan.sections.length}: "${section.title}"` });

    try {
      // Build per-section context with token budget
      let sectionContext: string;
      try {
        sectionContext = await buildSectionContext(
          companyContext.company.id,
          section.keywords || [],
          section.productMentions || [],
          vertical?.id || null,
          "sectionWriter",
        );
      } catch {
        // Fallback to full context if chunker fails
        sectionContext = compactContext(industryContext + "\n\n" + productContext, TOKEN_BUDGETS.sectionWriter);
      }

      const content = await writeSection(plan, i, sectionContext, productContext, brandProfile, recordGeneration);
      sectionContents.push(content);
      onEvent({ type: "section", phase: "writer", sectionIndex: i, sectionTitle: section.title, sectionContent: content });
    } catch (err: any) {
      onEvent({ type: "error", error: `Section writer failed on "${section.title}": ${err.message}` });
      throw err;
    }
  }

  // Phase 3: Stitch (with photo placements)
  onEvent({ type: "status", phase: "stitcher", message: "Stitching sections into cohesive post..." });

  try {
    // Inject photo placements into stitcher if we have photos
    const photoPrompt = formatPhotoPlacementsForPrompt(photoSelections, companyContext.company.id);
    if (photoPrompt) {
      // Append photo instructions to the section block
      sectionContents.push(photoPrompt);
    }
    markdown = await runStitcher(plan, sectionContents, brandProfile, recordGeneration);
    markdown = injectProductImages(markdown, relevantProducts, brandProfile);
    onEvent({ type: "stitched", phase: "stitcher", markdown, message: "Post stitched successfully" });
    lintReport = await runLintPass(true);
  } catch (err: any) {
    onEvent({ type: "error", error: `Stitcher failed: ${err.message}` });
    throw err;
  }

  // Phase 4: Verify
  onEvent({ type: "status", phase: "verifier", message: "Running quality verification..." });

  let verification: VerificationResult;
  try {
    verification = await runVerifier(plan, markdown, brandProfile, recordGeneration);
    onEvent({ type: "verified", phase: "verifier", verification, message: `Score: ${verification.overallScore}/100 (${verification.passesQualityGate ? "PASS" : "FAIL"})` });
  } catch (err: any) {
    // Verification failure is non-fatal — save with no scores
    onEvent({ type: "status", phase: "verifier", message: `Verification failed (non-fatal): ${err.message}` });
    verification = {
      brandConsistency: 0,
      seoOptimization: 0,
      naturalLanguage: 0,
      factualAccuracy: 0,
      overallScore: 0,
      issues: ["Verification failed"],
      suggestions: [],
      passesQualityGate: false,
    };
  }

  // Always re-stitch with feedback if there are issues or suggestions to address
  const hasFixableIssues = verification.overallScore > 0 && (verification.issues.length > 0 || verification.suggestions.length > 0);
  if (hasFixableIssues) {
    onEvent({ type: "status", phase: "stitcher", message: `Score ${verification.overallScore}/100. Applying ${verification.issues.length} fixes and ${verification.suggestions.length} improvements...` });

    try {
      const originalMarkdown = markdown;
      const originalVerification = verification;
      const originalLintReport = lintReport;
      const feedbackPrompt = `Previous version scored ${verification.overallScore}/100.\nIssues: ${verification.issues.join("; ")}\nSuggestions: ${verification.suggestions.join("; ")}`;
      const revisedMarkdown = await generateText(
        buildStitcherPrompt(brandProfile),
        `Improve this blog post based on the feedback below.\n\nTitle: "${plan.title}"\nPrimary keyword: "${plan.primaryKeyword}"\n\nFeedback:\n${feedbackPrompt}\n\nOriginal post:\n${markdown}`,
        8192,
        0.3,
        "stitcher",
        recordGeneration,
      );
      markdown = injectProductImages(revisedMarkdown, relevantProducts, brandProfile);
      onEvent({ type: "stitched", phase: "stitcher", markdown, message: "Re-stitched with improvements" });
      lintReport = await runLintPass(!lintCorrectionUsed);

      // Re-verify
      const revisedVerification = await runVerifier(plan, markdown, brandProfile, recordGeneration);
      if (revisedVerification.overallScore < originalVerification.overallScore) {
        markdown = originalMarkdown;
        verification = originalVerification;
        lintReport = originalLintReport;
        onEvent({
          type: "status",
          phase: "stitcher",
          message: `Revision scored ${revisedVerification.overallScore}/100, below original ${originalVerification.overallScore}/100; discarded revision.`,
        });
      } else {
        verification = revisedVerification;
      }
      onEvent({ type: "verified", phase: "verifier", verification, message: `Re-verified: ${verification.overallScore}/100 (${verification.passesQualityGate ? "PASS" : "FAIL"})` });
    } catch {
      onEvent({ type: "status", phase: "stitcher", message: "Re-stitch failed, proceeding with original" });
    }
  }

  // Count words
  const wordCount = markdown.split(/\s+/).filter(Boolean).length;

  // Save to database
  onEvent({ type: "status", phase: "save", message: "Saving blog post..." });
  const providersUsed = Array.from(new Set(generationEvents.map((event) => event.provider)));
  const modelsUsed = Array.from(new Set(generationEvents.map((event) => event.model)));
  const hadFallback = generationEvents.some((event) => event.fallback);
  const generationProvider = hadFallback || providersUsed.length > 1
    ? "mixed"
    : providersUsed[0] || null;
  const generationModel = modelsUsed.join(", ") || null;

  const [post] = await db.insert(blogPosts).values({
    companyId: companyContext.company.id,
    title: plan.title,
    slug: plan.slug,
    metaTitle: plan.metaTitle,
    metaDescription: plan.metaDescription,
    markdown,
    clusterId: request.clusterId,
    verticalId: vertical?.id || null,
    batchId: request.batchId || null,
    status: verification.passesQualityGate && lintReport.passed ? "review" : "draft",
    wordCount,
    brandConsistency: verification.brandConsistency,
    seoOptimization: verification.seoOptimization,
    naturalLanguage: verification.naturalLanguage,
    factualAccuracy: verification.factualAccuracy,
    overallScore: verification.overallScore,
    verificationNotes: JSON.stringify({ issues: verification.issues, suggestions: verification.suggestions, lint: lintReport }),
    generationProvider,
    generationModel,
  }).returning();

  // Link mentioned products
  if (relevantProducts.length > 0) {
    for (const product of relevantProducts) {
      if (markdown.toLowerCase().includes(product.handle.toLowerCase()) ||
          markdown.toLowerCase().includes(product.title.toLowerCase())) {
        await db.insert(blogPostProducts).values({
          companyId: companyContext.company.id,
          blogPostId: post.id,
          productId: product.id,
          mentionContext: `Referenced in blog post "${plan.title}"`,
        });
      }
    }
  }

  // Save photo selections
  if (photoSelections.length > 0) {
    await savePhotoSelections(post.id, photoSelections, companyContext.company.id);
  }

  // Update cluster status
  await db
    .update(keywordClusters)
    .set({ status: "generated" })
    .where(and(eq(keywordClusters.companyId, companyContext.company.id), eq(keywordClusters.id, request.clusterId)));

  onEvent({
    type: "complete",
    phase: "done",
    message: `Blog post "${plan.title}" generated (${wordCount} words, score: ${verification.overallScore}/100)`,
    blogPost: post,
    markdown,
    verification,
  });

  return post;
}

/**
 * Get all blog posts with optional status filter.
 */
export async function getBlogPosts(status?: string, companyId?: string): Promise<BlogPost[]> {
  const conditions = [];
  if (companyId) conditions.push(eq(blogPosts.companyId, companyId));
  if (status) conditions.push(eq(blogPosts.status, status));
  if (conditions.length > 0) {
    return db.select().from(blogPosts).where(and(...conditions));
  }
  return db.select().from(blogPosts);
}

/**
 * Get a single blog post by ID.
 */
export async function getBlogPost(id: string, companyId?: string): Promise<BlogPost | undefined> {
  const conditions = [eq(blogPosts.id, id)];
  if (companyId) conditions.push(eq(blogPosts.companyId, companyId));
  const [post] = await db.select().from(blogPosts).where(and(...conditions)).limit(1);
  return post;
}

/**
 * Update a blog post (edit, approve, etc.)
 */
export async function updateBlogPost(id: string, updates: Partial<{
  title: string;
  markdown: string;
  html: string;
  status: string;
  metaTitle: string;
  metaDescription: string;
}>, companyId?: string): Promise<BlogPost | undefined> {
  const allowedStatuses = new Set(["draft", "review", "approved", "published"]);
  const updateData: any = { updatedAt: new Date() };

  for (const key of ["title", "markdown", "html", "metaTitle", "metaDescription"] as const) {
    if (updates[key] !== undefined) {
      if (typeof updates[key] !== "string") throw new Error(`${key} must be a string`);
      updateData[key] = updates[key];
    }
  }

  if (updates.status !== undefined) {
    if (typeof updates.status !== "string" || !allowedStatuses.has(updates.status)) {
      throw new Error("Invalid blog post status");
    }
    updateData.status = updates.status;
  }

  if (typeof updateData.markdown === "string") {
    updateData.wordCount = updateData.markdown.split(/\s+/).filter(Boolean).length;
  }
  const conditions = [eq(blogPosts.id, id)];
  if (companyId) conditions.push(eq(blogPosts.companyId, companyId));
  const [post] = await db.update(blogPosts).set(updateData).where(and(...conditions)).returning();
  return post;
}
