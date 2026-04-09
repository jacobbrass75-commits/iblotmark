// iBolt Blog Pipeline — 4-Phase Generation Engine
// Planner → Section Writer → Stitcher → Verifier
// Adapted from writingPipeline.ts for SEO blog generation.

import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { eq } from "drizzle-orm";
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
  BRAND_VOICE,
} from "./brandVoice";
import { anthropicLimiter } from "./apiCache";
import { formatContextForPrompt } from "./contextBanks";
import { buildSectionContext, compactContext, TOKEN_BUDGETS } from "./contextChunker";
import { selectPhotosForPost, savePhotoSelections, formatPhotoPlacementsForPrompt, type PhotoSelection } from "./photoSelector";
import { generateExcerpt } from "./blogExcerpt";

// --- Types ---

export interface BlogGenerationRequest {
  clusterId: string;
  batchId?: string;
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
  blogPost?: BlogPost;
  error?: string;
}

// --- Helpers ---

const MODEL = "claude-sonnet-4-20250514";

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  return new Anthropic({ apiKey });
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

async function getClusterData(clusterId: string): Promise<{
  cluster: KeywordCluster;
  clusterKeywords: Keyword[];
  vertical: IndustryVertical | null;
  relevantProducts: Product[];
}> {
  const [cluster] = await db.select().from(keywordClusters).where(eq(keywordClusters.id, clusterId)).limit(1);
  if (!cluster) throw new Error(`Cluster ${clusterId} not found`);

  const clusterKeywords = await db.select().from(keywords).where(eq(keywords.clusterId, clusterId));

  let vertical: IndustryVertical | null = null;
  if (cluster.verticalId) {
    const [v] = await db.select().from(industryVerticals).where(eq(industryVerticals.id, cluster.verticalId)).limit(1);
    vertical = v || null;
  }

  // Get products for this vertical
  let relevantProducts: Product[] = [];
  if (cluster.verticalId) {
    const pvRows = await db.select().from(productVerticals).where(eq(productVerticals.verticalId, cluster.verticalId));
    if (pvRows.length > 0) {
      const productIds = pvRows.map((pv) => pv.productId);
      const allProducts = await db.select().from(products);
      relevantProducts = allProducts.filter((p) => productIds.includes(p.id));
    }
  }

  // If no vertical-specific products, get all products
  if (relevantProducts.length === 0) {
    relevantProducts = await db.select().from(products).limit(20);
  }

  return { cluster, clusterKeywords, vertical, relevantProducts };
}

function formatProductsForPrompt(prods: Product[]): string {
  if (prods.length === 0) return "No products available yet. Write general content about mounting solutions.";

  return prods.map((p) => {
    const parts = [`- **${p.title}** (${p.handle})`];
    if (p.price) parts.push(`  Price: $${p.price}`);
    if (p.productType) parts.push(`  Type: ${p.productType}`);
    if (p.description) parts.push(`  ${p.description.slice(0, 200)}`);
    if (p.url) parts.push(`  URL: ${p.url}`);
    return parts.join("\n");
  }).join("\n\n");
}

// --- Phase 1: PLANNER ---

async function runPlanner(
  client: Anthropic,
  clusterKeywords: Keyword[],
  industryContext: string,
  productContext: string,
): Promise<BlogPlan> {
  const kwList = clusterKeywords
    .sort((a, b) => (b.volume || 0) - (a.volume || 0))
    .map((k) => `"${k.keyword}" (vol: ${k.volume}, diff: ${k.difficulty})`)
    .join(", ");

  const systemPrompt = buildPlannerPrompt(industryContext, productContext);

  await anthropicLimiter.acquire();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{
      role: "user",
      content: `Create a blog post outline targeting these keywords: ${kwList}\n\nPrimary keyword should be the highest-volume keyword. Distribute all keywords naturally across sections.`,
    }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const parsed = JSON.parse(extractJSON(text)) as BlogPlan;

  if (!parsed.title || !parsed.sections || !Array.isArray(parsed.sections)) {
    throw new Error("Invalid blog plan structure");
  }

  // Ensure reasonable word targets
  const totalTarget = parsed.sections.reduce((sum, s) => sum + (s.targetWords || 200), 0);
  if (totalTarget < BRAND_VOICE.targetWordCount.min) {
    const multiplier = BRAND_VOICE.targetWordCount.min / totalTarget;
    parsed.sections.forEach((s) => { s.targetWords = Math.round((s.targetWords || 200) * multiplier); });
  }

  return parsed;
}

// --- Phase 2: SECTION WRITER ---

async function writeSection(
  client: Anthropic,
  plan: BlogPlan,
  sectionIndex: number,
  industryContext: string,
  productDetails: string,
): Promise<string> {
  const section = plan.sections[sectionIndex];

  const systemPrompt = buildSectionWriterPrompt(
    section,
    industryContext,
    productDetails,
  );

  await anthropicLimiter.acquire();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{
      role: "user",
      content: `Write section ${sectionIndex + 1} of ${plan.sections.length}: "${section.title}"\n\nTarget: ~${section.targetWords} words\nBlog title: "${plan.title}"\nPrimary keyword: "${plan.primaryKeyword}"`,
    }],
  });

  return response.content[0].type === "text" ? response.content[0].text : "";
}

// --- Phase 3: STITCHER ---

async function runStitcher(
  client: Anthropic,
  plan: BlogPlan,
  sections: string[],
): Promise<string> {
  const systemPrompt = buildStitcherPrompt();

  const sectionBlock = sections
    .map((content, i) => `--- Section ${i + 1}: ${plan.sections[i]?.title || "Untitled"} ---\n\n${content}`)
    .join("\n\n");

  await anthropicLimiter.acquire();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{
      role: "user",
      content: `Stitch these ${sections.length} sections into a cohesive blog post.\n\nTitle: "${plan.title}"\nPrimary keyword: "${plan.primaryKeyword}"\nSecondary keywords: ${plan.secondaryKeywords.join(", ")}\n\n${sectionBlock}`,
    }],
  });

  return response.content[0].type === "text" ? response.content[0].text : "";
}

// --- Phase 4: VERIFIER ---

async function runVerifier(
  client: Anthropic,
  plan: BlogPlan,
  markdown: string,
): Promise<VerificationResult> {
  const systemPrompt = buildVerifierPrompt();

  await anthropicLimiter.acquire();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{
      role: "user",
      content: `Verify this blog post:\n\nTitle: "${plan.title}"\nMeta Title: "${plan.metaTitle}"\nMeta Description: "${plan.metaDescription}"\nPrimary Keyword: "${plan.primaryKeyword}"\nSecondary Keywords: ${plan.secondaryKeywords.join(", ")}\n\n---\n\n${markdown}`,
    }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const parsed = JSON.parse(extractJSON(text)) as VerificationResult;

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
  const client = getClient();

  // Load cluster data
  onEvent({ type: "status", phase: "init", message: "Loading cluster data..." });
  const { cluster, clusterKeywords, vertical, relevantProducts } = await getClusterData(request.clusterId);

  // Build context
  const industryContext = vertical
    ? await formatContextForPrompt(vertical.id)
    : "General device mounting context.";
  const productContext = formatProductsForPrompt(relevantProducts);

  // Phase 1: Plan
  onEvent({ type: "status", phase: "planner", message: `Planning blog post for "${cluster.primaryKeyword}"...` });

  let plan: BlogPlan;
  try {
    plan = await runPlanner(client, clusterKeywords, industryContext, productContext);
    onEvent({ type: "plan", phase: "planner", plan, message: `Plan created: "${plan.title}" with ${plan.sections.length} sections` });
  } catch (err: any) {
    onEvent({ type: "error", error: `Planner failed: ${err.message}` });
    throw err;
  }

  // Photo selection (after plan, before writing)
  let photoSelections: PhotoSelection[] = [];
  try {
    const productIds = relevantProducts.map((p) => p.id);
    photoSelections = await selectPhotosForPost(plan, vertical?.id || null, productIds, vertical?.slug || null);
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
          section.keywords || [],
          section.productMentions || [],
          vertical?.id || null,
          "sectionWriter",
        );
      } catch {
        // Fallback to full context if chunker fails
        sectionContext = compactContext(industryContext + "\n\n" + productContext, TOKEN_BUDGETS.sectionWriter);
      }

      const content = await writeSection(client, plan, i, sectionContext, productContext);
      sectionContents.push(content);
      onEvent({ type: "section", phase: "writer", sectionIndex: i, sectionTitle: section.title, sectionContent: content });
    } catch (err: any) {
      onEvent({ type: "error", error: `Section writer failed on "${section.title}": ${err.message}` });
      throw err;
    }
  }

  // Phase 3: Stitch (with photo placements)
  onEvent({ type: "status", phase: "stitcher", message: "Stitching sections into cohesive post..." });

  let markdown: string;
  try {
    // Inject photo placements into stitcher if we have photos
    const photoPrompt = formatPhotoPlacementsForPrompt(photoSelections);
    if (photoPrompt) {
      // Append photo instructions to the section block
      sectionContents.push(photoPrompt);
    }
    markdown = await runStitcher(client, plan, sectionContents);
    onEvent({ type: "stitched", phase: "stitcher", markdown, message: "Post stitched successfully" });
  } catch (err: any) {
    onEvent({ type: "error", error: `Stitcher failed: ${err.message}` });
    throw err;
  }

  // Phase 4: Verify
  onEvent({ type: "status", phase: "verifier", message: "Running quality verification..." });

  let verification: VerificationResult;
  try {
    verification = await runVerifier(client, plan, markdown);
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
      const feedbackPrompt = `Previous version scored ${verification.overallScore}/100.\nIssues: ${verification.issues.join("; ")}\nSuggestions: ${verification.suggestions.join("; ")}`;

      await anthropicLimiter.acquire();
      const restitchResponse = await client.messages.create({
        model: MODEL,
        max_tokens: 8192,
        system: buildStitcherPrompt(),
        messages: [
          {
            role: "user",
            content: `Improve this blog post based on the feedback below.\n\nTitle: "${plan.title}"\nPrimary keyword: "${plan.primaryKeyword}"\n\nFeedback:\n${feedbackPrompt}\n\nOriginal post:\n${markdown}`,
          },
        ],
      });

      markdown = restitchResponse.content[0].type === "text" ? restitchResponse.content[0].text : markdown;
      onEvent({ type: "stitched", phase: "stitcher", markdown, message: "Re-stitched with improvements" });

      // Re-verify
      verification = await runVerifier(client, plan, markdown);
      onEvent({ type: "verified", phase: "verifier", verification, message: `Re-verified: ${verification.overallScore}/100 (${verification.passesQualityGate ? "PASS" : "FAIL"})` });
    } catch {
      onEvent({ type: "status", phase: "stitcher", message: "Re-stitch failed, proceeding with original" });
    }
  }

  // Count words
  const wordCount = markdown.split(/\s+/).filter(Boolean).length;

  onEvent({ type: "status", phase: "excerpt", message: "Generating Shopify excerpt..." });
  const excerpt = await generateExcerpt({
    title: plan.title,
    metaTitle: plan.metaTitle,
    metaDescription: plan.metaDescription,
    markdown,
    primaryKeyword: plan.primaryKeyword,
    secondaryKeywords: plan.secondaryKeywords,
  });

  // Save to database
  onEvent({ type: "status", phase: "save", message: "Saving blog post..." });

  const [post] = await db.insert(blogPosts).values({
    title: plan.title,
    slug: plan.slug,
    metaTitle: plan.metaTitle,
    metaDescription: plan.metaDescription,
    excerpt,
    markdown,
    clusterId: request.clusterId,
    verticalId: vertical?.id || null,
    batchId: request.batchId || null,
    status: verification.passesQualityGate ? "review" : "draft",
    wordCount,
    brandConsistency: verification.brandConsistency,
    seoOptimization: verification.seoOptimization,
    naturalLanguage: verification.naturalLanguage,
    factualAccuracy: verification.factualAccuracy,
    overallScore: verification.overallScore,
    verificationNotes: JSON.stringify({ issues: verification.issues, suggestions: verification.suggestions }),
  }).returning();

  // Link mentioned products
  if (relevantProducts.length > 0) {
    for (const product of relevantProducts) {
      if (markdown.toLowerCase().includes(product.handle.toLowerCase()) ||
          markdown.toLowerCase().includes(product.title.toLowerCase())) {
        await db.insert(blogPostProducts).values({
          blogPostId: post.id,
          productId: product.id,
          mentionContext: `Referenced in blog post "${plan.title}"`,
        });
      }
    }
  }

  // Save photo selections
  if (photoSelections.length > 0) {
    await savePhotoSelections(post.id, photoSelections);
  }

  // Update cluster status
  await db.update(keywordClusters).set({ status: "generated" }).where(eq(keywordClusters.id, request.clusterId));

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
export async function getBlogPosts(status?: string): Promise<BlogPost[]> {
  if (status) {
    return db.select().from(blogPosts).where(eq(blogPosts.status, status));
  }
  return db.select().from(blogPosts);
}

/**
 * Get a single blog post by ID.
 */
export async function getBlogPost(id: string): Promise<BlogPost | undefined> {
  const [post] = await db.select().from(blogPosts).where(eq(blogPosts.id, id)).limit(1);
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
  excerpt: string;
  photosInjected: boolean;
  hasPhotos: boolean;
  photoCount: number;
}>): Promise<BlogPost> {
  const updateData: any = { ...updates, updatedAt: new Date() };
  if (updates.markdown) {
    updateData.wordCount = updates.markdown.split(/\s+/).filter(Boolean).length;
    if (updates.photosInjected === undefined) updateData.photosInjected = false;
    if (updates.hasPhotos === undefined) updateData.hasPhotos = false;
    if (updates.photoCount === undefined) updateData.photoCount = 0;
    if (updates.excerpt === undefined) updateData.excerpt = null;
  }
  const [post] = await db.update(blogPosts).set(updateData).where(eq(blogPosts.id, id)).returning();
  return post;
}
